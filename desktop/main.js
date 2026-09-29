/* ==========================================================================
   AMAYA ERP for Windows — main process
   --------------------------------------------------------------------------
   Three jobs:

     1. Host the ERP app in a native window (Chromium, so the single-file build
        behaves exactly as it does in a browser).
     2. Run the attendance server in-process — the same bridge/bridge.js the
        standalone version uses, not a reimplementation, so there is one set of
        protocol and parsing rules to maintain.
     3. Own machine setup: which address to host on, which terminals to read,
        the remote live link, and whether to start with Windows.

   Settings live in a JSON file under the user's app data, not in the install
   directory, so an upgrade never discards them.
   ========================================================================== */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const IS_PACKAGED = app.isPackaged;
const DESKTOP_DIR = __dirname;
const ASSETS = path.join(DESKTOP_DIR, 'assets');
const WINDOWS_DIR = path.join(DESKTOP_DIR, 'windows');

/* In a build, stage.js has copied the app and the bridge into desktop/.
   Running from source, they are one level up. `asar` is disabled in the build
   config, so plain filesystem paths work in both cases — including spawning
   find-devices.js, which an archive would break. */
const RES_DIR = IS_PACKAGED ? DESKTOP_DIR : path.join(DESKTOP_DIR, '..');
const BRIDGE_DIR = IS_PACKAGED ? path.join(DESKTOP_DIR, 'bridge') : path.join(RES_DIR, 'bridge');
const APP_HTML = IS_PACKAGED ? path.join(DESKTOP_DIR, 'app', 'index.html') : path.join(RES_DIR, 'index.html');

const DEFAULT_PORT = 8787;

/* ------------------------------------------------------------------ store */
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = null;

function defaultSettings() {
  return {
    port: DEFAULT_PORT,
    /* 0.0.0.0 makes the app reachable from other machines on the network. */
    bind: '0.0.0.0',
    lanOnly: true,
    startWithWindows: false,
    startMinimised: false,
    closeToTray: true,
    devices: [],
    shift: { start: '09:00', end: '18:00', graceMinutes: 10, earlyLeaveGraceMinutes: 15, halfDayHours: 4, weekendDays: [5, 6] },
    setupDone: false,
    tokens: {}
  };
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const base = defaultSettings();
      return {
        ...base, ...raw,
        shift: { ...base.shift, ...(raw.shift || {}) },
        devices: Array.isArray(raw.devices) ? raw.devices : [],
        tokens: { ...base.tokens, ...(raw.tokens || {}) }
      };
    }
  } catch (e) {
    /* A corrupt settings file must not stop the app from starting. */
    console.error('[settings] could not be read, using defaults:', e.message);
    try { fs.renameSync(settingsPath, settingsPath + '.corrupt-' + Date.now()); } catch (_) {}
  }
  return defaultSettings();
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[settings] could not be written:', e.message);
    return false;
  }
}

/* --------------------------------------------------------------- windows */
let mainWindow = null;
let tray = null;
let quitting = false;
/** The embedded server, or null when not running. */
let host = null;

function createMainWindow() {
  const bounds = settings.windowBounds || {};
  const win = new BrowserWindow(Object.assign({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1210',
    title: 'AMAYA ERP',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true
  }, bounds, { title: 'AMAYA ERP' }));

  win.loadFile(APP_HTML);

  win.once('ready-to-show', () => {
    if (!settings.startMinimised) win.show();
  });

  /* Closing the window keeps the app running so attendance keeps syncing;
     the tray icon remains. Only an explicit Quit really exits. */
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      win.hide();
      if (tray) tray.displayBalloon?.({
        title: 'AMAYA ERP',
        content: 'Still running in the notification area. Right-click the icon to open or quit.'
      });
    } else {
      persistBounds(win);
    }
  });

  win.on('resize', () => persistBounds(win));
  win.on('move', () => persistBounds(win));

  /* Keep the app fully self-contained: nothing navigates out to the web. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const here = win.webContents.getURL();
    if (url !== here) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  return win;
}

function persistBounds(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try { settings.windowBounds = win.getNormalBounds(); saveSettings(); } catch (_) {}
}

/* ------------------------------------------------------------------ host */
/**
 * The embedded attendance/app server.
 *
 * bridge.js is loaded with STOCKFLOW_BRIDGE_ROOT pointed at the install so its
 * data and defaults resolve there, and it is required rather than spawned so
 * there is a single instance of the polling timer.
 */
function loadBridge() {
  process.env.STOCKFLOW_BRIDGE_ROOT = BRIDGE_DIR;
  /* Tells the bridge it is hosted, so its console hints point at the setup
     window rather than at a config file the desktop app does not read. */
  process.env.STOCKFLOW_EMBEDDED = '1';
  delete process.env.STOCKFLOW_BRIDGE_DATA;
  /* Cached module identity must follow the new root. */
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(BRIDGE_DIR)) delete require.cache[k];
  }
  return require(path.join(BRIDGE_DIR, 'bridge.js'));
}

function hostConfig() {
  return {
    port: Number(settings.port) || DEFAULT_PORT,
    host: settings.lanOnly ? '0.0.0.0' : '127.0.0.1',
    appFile: APP_HTML,
    pollIntervalMs: Number(settings.pollIntervalMs) || 15000,
    keepDays: Number(settings.keepDays) || 120,
    shift: settings.shift,
    devices: settings.devices,
    /* Persist the generated tokens so the app and the live link survive restarts. */
    apiToken: settings.tokens.apiToken || '',
    liveToken: settings.tokens.liveToken || '',
    corsOrigin: '*'
  };
}

async function startHost() {
  if (host) return { ok: true, already: true };
  const bridge = loadBridge();

  /* The module resolves its config at require time, so re-point the fields the
     server actually reads before listening. */
  Object.assign(bridge.CFG, hostConfig(), {
    appPath: APP_HTML,
    devices: (settings.devices || []).map((d, i) => ({
      id: d.id || `DEV-${String(i + 1).padStart(2, '0')}`,
      model: d.model || '',
      host: d.host || '',
      port: Number(d.port) || 80,
      path: d.path || '',
      sn: d.sn || '',
      site: d.site || 'Main House',
      enabled: d.enabled !== false
    }))
  });
  if (!bridge.CFG.apiToken) bridge.CFG.apiToken = bridge.CFG.apiToken || require('node:crypto').randomBytes(24).toString('base64url');
  if (!bridge.CFG.liveToken) bridge.CFG.liveToken = require('node:crypto').randomBytes(16).toString('base64url');
  settings.tokens = { apiToken: bridge.CFG.apiToken, liveToken: bridge.CFG.liveToken };
  saveSettings();

  try {
    await bridge.startServer();
    host = bridge;
    updateTray();
    return { ok: true, port: bridge.CFG.port };
  } catch (e) {
    const msg = friendlyPortError(e, bridge.CFG.port);
    return { ok: false, error: msg };
  }
}

function friendlyPortError(e, port) {
  if (e && e.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Another copy of AMAYA ERP, or a leftover ` +
           `node bridge.js, is probably using it. Change the port in Settings, or close the other program.`;
  }
  if (e && e.code === 'EACCES') {
    return `Windows refused port ${port}. Ports below 1024 need Administrator rights — try 8787 or higher.`;
  }
  return (e && e.message) || String(e);
}

async function stopHost() {
  if (!host) return;
  const bridge = host;
  host = null;
  try { await bridge.stop(); } catch (e) { console.error('[host] stop failed:', e.message); }
  updateTray();
}

/** Restart the host so a settings change takes effect without a full restart. */
async function restartHost() {
  await stopHost();
  return startHost();
}

/* ----------------------------------------------------------------- links */
/** The address other machines on this network should use. */
function preferredAddress() {
  const bound = settings.bind || '0.0.0.0';
  if (bound && bound !== '0.0.0.0' && bound !== '::') return bound;

  const ifs = require('node:os').networkInterfaces();
  let first = '';
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      /* Prefer a real adapter over virtual ones (VPN, Hyper-V, WSL). */
      if (/wi-?fi|wireless|ethernet|以太网|无线/i.test(name)) return i.address;
      if (!first) first = i.address;
    }
  }
  return first || 'localhost';
}

function urls() {
  const port = Number(settings.port) || DEFAULT_PORT;
  const addr = preferredAddress();
  const live = settings.tokens.liveToken || '';
  return {
    address: addr,
    port,
    app: `http://${addr}:${port}/`,
    status: `http://${addr}:${port}/status`,
    live: live ? `http://${addr}:${port}/live?token=${encodeURIComponent(live)}` : '',
    localhost: `http://127.0.0.1:${port}/`
  };
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname);
    const req = http.get({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, timeout: 4000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('unexpected response from the local server')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('local server did not respond')); });
    req.on('error', reject);
  });
}

async function hostStatus() {
  if (!host) return { running: false, addresses: urls() };
  try {
    const h = await getJson(`http://127.0.0.1:${settings.port}/health`);
    return {
      running: true,
      uptimeSec: h.uptimeSec,
      lastRun: h.lastRun,
      devices: h.devices || [],
      punches: h.punches,
      addresses: urls()
    };
  } catch (e) {
    return { running: false, error: e.message, addresses: urls() };
  }
}

/* ------------------------------------------------------------------ tray */
function buildTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('AMAYA ERP');
  tray.on('click', () => toggleWindow());
  refreshTrayMenu();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { mainWindow = createMainWindow(); mainWindow.show(); return; }
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function updateTray() { if (tray) refreshTrayMenu(); }

function refreshTrayMenu() {
  if (!tray) return;
  const u = urls();
  const running = !!host;
  const online = lastStatus.devices.filter(d => d.online).length;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: running ? 'Attendance server is running' : 'Attendance server is stopped', enabled: false },
    running
      ? { label: `  ${online}/${lastStatus.devices.length} terminal(s) online`, enabled: false }
      : { label: '  no terminals connected', enabled: false },
    { type: 'separator' },
    { label: 'Open AMAYA ERP', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Open the app in my browser', click: () => shell.openExternal(u.localhost) },
    { label: 'Copy the remote live link', enabled: !!u.live, click: () => { clipboardWrite(u.live); flash('Live link copied'); } },
    { label: 'Open the remote live view', enabled: !!u.live, click: () => shell.openExternal(u.live) },
    { type: 'separator' },
    { label: 'Setup and settings…', click: () => openSetup('settings') },
    { label: 'Server status page', click: () => shell.openExternal(u.status) },
    { type: 'separator' },
    { label: running ? 'Stop the attendance server' : 'Start the attendance server',
      click: async () => { running ? await stopHost() : await startHost(); } },
    { type: 'separator' },
    { label: 'Quit AMAYA ERP', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip(running
    ? `AMAYA ERP — ${u.app}`
    : 'AMAYA ERP — attendance server stopped');
}

/* Cache of the last known device status, so the tray menu is accurate without
   a request on every render. Named distinctly from the hostStatus() reader. */
const lastStatus = { devices: [] };
setInterval(() => {
  if (!host) return;
  getJson(`http://127.0.0.1:${settings.port}/health`)
    .then(h => {
      const before = JSON.stringify(lastStatus.devices);
      lastStatus.devices = h.devices || [];
      if (JSON.stringify(lastStatus.devices) !== before) updateTray();
    })
    .catch(() => {});
}, 15000).unref?.();

/* -------------------------------------------------------------- clipboard */
function clipboardWrite(text) {
  const { clipboard } = require('electron');
  clipboard.writeText(String(text || ''));
}

/* ---------------------------------------------------------------- windows */
function openSetup(page) {
  const existing = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Setup'));
  if (existing) { existing.focus(); return existing; }

  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    show: false,
    title: 'AMAYA ERP — Setup',
    parent: mainWindow || undefined,
    backgroundColor: '#12150f',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(DESKTOP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(WINDOWS_DIR, 'setup.html'), { query: { page: page || 'setup' } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {});
  return win;
}

/* -------------------------------------------------------------------- IPC */
ipcMain.handle('sf:get-settings', () => ({
  settings: publicSettings(),
  urls: urls(),
  status: lastStatus.devices,
  running: !!host,
  settingsPath,
  appPath: APP_HTML,
  version: app.getVersion()
}));

ipcMain.handle('sf:save-settings', async (_e, patch) => {
  if (patch && typeof patch === 'object') {
    const { devices, shift, tokens, windowBounds, ...rest } = patch;
    Object.assign(settings, rest);
    if (devices) settings.devices = devices;
    if (shift) settings.shift = { ...settings.shift, ...shift };
  }
  saveSettings();
  await applyAutostart(settings.startWithWindows);

  /* The server reads its config once at startup, so any change to the port,
     binding, terminal list or shift times needs a restart to take effect. */
  const r = await restartHost();
  if (!r.ok) return { ok: false, error: r.error };
  updateTray();
  return { ok: true, settings: publicSettings(), urls: urls() };
});

ipcMain.handle('sf:start-host', async () => {
  const r = await startHost();
  updateTray();
  return r;
});

ipcMain.handle('sf:stop-host', async () => {
  await stopHost();
  return { ok: true };
});

ipcMain.handle('sf:restart-host', async () => {
  const r = await restartHost();
  updateTray();
  return r;
});

ipcMain.handle('sf:status', async () => {
  const s = await hostStatus();
  lastStatus.devices = s.devices || [];
  updateTray();
  return s;
});

ipcMain.handle('sf:diagnose', async () => {
  const bridge = loadBridge();
  Object.assign(bridge.CFG, hostConfig());
  const lines = await bridge.diagnose();
  return lines.join('\n');
});

ipcMain.handle('sf:scan-devices', async () => {
  const script = path.join(BRIDGE_DIR, 'find-devices.js');
  if (!fs.existsSync(script)) return { ok: false, error: 'find-devices.js is missing from this build.' };
  return new Promise((resolve) => {
    execCapture(process.execPath, [script], 120000, (err, stdout, stderr) => {
      resolve({ ok: !err || stdout.length > 0, output: (stdout || '') + (stderr || '') });
    });
  });
});

ipcMain.handle('sf:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(String(url || ''))) shell.openExternal(url);
  return true;
});

ipcMain.handle('sf:copy', (_e, text) => { clipboardWrite(text); return true; });

/**
 * Start a quick public tunnel so the app can be reached from outside the
 * office. Both tools print a public URL on stdout shortly after starting; we
 * watch for it. The child is kept so it can be stopped on quit.
 */
let tunnelProc = null;
ipcMain.handle('sf:start-tunnel', async (_e, kind) => {
  if (kind !== 'cf' && kind !== 'ng') return { ok: false, error: 'Unknown tunnel type.' };
  if (tunnelProc) { tunnelProc.kill(); tunnelProc = null; }

  const exe = kind === 'cf' ? 'cloudflared' : 'ngrok';
  const args = kind === 'cf'
    ? ['tunnel', '--url', `http://127.0.0.1:${settings.port}`, '--no-autoupdate']
    : ['http', String(settings.port), '--log', 'stdout'];

  const which = await findOnPath(exe);
  if (!which) {
    return {
      ok: false,
      error: kind === 'cf'
        ? 'cloudflared is not installed.'
        : 'ngrok is not installed, or its authtoken is not set.'
    };
  }

  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(which, args, { windowsHide: true });
    tunnelProc = child;

    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => {
      if (!settled) finish({ ok: !!out.match(/https?:\/\/\S+/), url: (out.match(/https?:\/\/[^\s]+/) || [])[0] || '', output: out || '(no output before timeout)' });
    }, 25000);

    const onData = (d) => {
      out += d.toString();
      /* cloudflared prints e.g. https://xyz.trycloudflare.com
         ngrok prints it in a JSON line with "url". */
      const m = out.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)|("url"\s*:\s*"(https?:\/\/[^"]+)")/i);
      const url = (m && (m[1] || m[3])) || '';
      if (url) {
        clearTimeout(timer);
        out += '\n\n' + (kind === 'cf'
          ? 'Anyone with this address can reach AMAYA while the tunnel is running.\nStop it by quitting AMAYA ERP.'
          : 'Anyone with this address can reach AMAYA while the tunnel is running.');
        finish({ ok: true, url, output: out });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      tunnelProc = null;
      finish({ ok: false, error: `${exe} stopped (exit ${code}).\n${out.slice(-600)}` });
    });
  });
});

/** Look up an executable on PATH, so we can report "not installed" clearly. */
function findOnPath(exe) {
  const pathVar = process.env.PATH || '';
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';');
  for (const dir of pathVar.split(';')) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, exe + ext.toLowerCase());
      try { if (fs.existsSync(full)) return full; } catch (_) {}
    }
  }
  return null;
}

ipcMain.handle('sf:reveal-data', () => {
  shell.showItemInFolder(settingsPath);
  return true;
});

ipcMain.handle('sf:complete-setup', async () => {
  settings.setupDone = true;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('sf:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close();
  return true;
});

ipcMain.handle('sf:app-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  settingsPath,
  appPath: APP_HTML,
  dataPath: BRIDGE_DIR,
  userData: app.getPath('userData'),
  node: process.versions.electron,
  chrome: process.versions.chrome
}));

/** Everything the settings window is allowed to see. Never hand out tokens twice. */
function publicSettings() {
  const { tokens, ...rest } = settings;
  return rest;
}

function execCapture(file, args, timeoutMs, cb) {
  const child = spawn(file, args, { windowsHide: true });
  let out = '';
  let err = '';
  const t = setTimeout(() => child.kill(), timeoutMs);
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('close', code => { clearTimeout(t); cb(code === 0 ? null : new Error(err || 'exited ' + code), out, err); });
  child.on('error', e => { clearTimeout(t); cb(e, out, err); });
}

/* -------------------------------------------------------------- autostart */
async function applyAutostart(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      /* Start hidden when launched by Windows, so it does not interrupt. */
      args: enabled ? ['--hidden'] : []
    });
  } catch (e) {
    console.error('[autostart]', e.message);
  }
}

/* ------------------------------------------------------------------- boot */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    await applyAutostart(settings.startWithWindows);

    /* A leftover node bridge.js on the same port is the most likely reason a
       fresh install appears to fail, so say so plainly in the log. */
    if (!fs.existsSync(APP_HTML)) {
      dialog.showErrorBox('AMAYA ERP is incomplete',
        `The application file was not found at:\n${APP_HTML}\n\nPlease reinstall.`);
      app.quit();
      return;
    }

    const r = await startHost();
    if (!r.ok) console.error('[host] did not start:', r.error);

    buildTray();

    const hidden = process.argv.includes('--hidden') || settings.startMinimised;
    mainWindow = createMainWindow();
    if (hidden) mainWindow.once('ready-to-show', () => {});

    if (!settings.setupDone) openSetup('setup');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        mainWindow.show();
      }
    });
  });

  app.on('window-all-closed', () => {
    /* Stay resident: attendance keeps syncing while the window is closed. */
    if (quitting) app.quit();
  });

  app.on('before-quit', async (e) => {
    if (host) {
      e.preventDefault();
      await stopHost();
      quitting = true;
      app.quit();
    }
  });

  app.on('will-quit', () => { persistBounds(mainWindow); });
}

process.on('uncaughtException', (e) => {
  console.error('[fatal]', e && e.message, e && e.stack);
  if (app.isReady()) {
    dialog.showErrorBox('AMAYA ERP hit a problem',
      `${(e && e.message) || 'Unknown error'}\n\nThe app will keep running. If it does not recover, ` +
      `reopen it from the Start menu.`);
  }
});

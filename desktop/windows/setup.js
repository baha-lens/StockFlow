/* ==========================================================================
   AMAYA ERP — setup and settings window.

   Three steps: this machine, the terminals, and remote access. The same window
   serves as Settings later, so there is one place to come back to.
   ========================================================================== */

'use strict';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let cfg = null;         /* the saved settings */
let dirty = false;
let step = 1;
let busy = false;

/* ------------------------------------------------------------------ toast */
let toastTimer = null;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}
function flash(msg, kind) { toast(msg, kind); }

/* -------------------------------------------------------------------- nav */
function go(n) {
  step = Math.max(1, Math.min(3, n));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'pg' + step));
  $$('#steps span').forEach(s => {
    const i = Number(s.dataset.step);
    s.classList.toggle('on', i === step);
    s.classList.toggle('done', i < step);
  });
  $('btnBack').disabled = step === 1;
  $('btnNext').hidden = step === 3;
  $('btnDone').hidden = step !== 3;
  $('barSub').textContent = cfg && cfg.settings.setupDone
    ? ['Machine', 'Terminals', 'Remote access'][step - 1]
    : `Setup · step ${step} of 3`;
  $('view').scrollTop = 0;
}

/* ------------------------------------------------------------------- load */
async function load() {
  const r = await window.sf.getSettings();
  cfg = r;
  const s = r.settings;

  $('lanOnly').checked = s.lanOnly !== false;
  $('port').value = s.port || 8787;
  $('startWin').checked = !!s.startWithWindows;
  $('startMin').checked = !!s.startMinimised !== false;
  $('closeTray').checked = s.closeToTray !== false;

  const sh = s.shift || {};
  $('shStart').value = sh.start || '09:00';
  $('shEnd').value = sh.end || '18:00';
  $('shGrace').value = sh.graceMinutes ?? 10;
  $('shHalf').value = sh.halfDayHours ?? 4;
  $('shEarly').value = sh.earlyLeaveGraceMinutes ?? 15;
  $('shWeek').value = (sh.weekendDays || []).join(',');

  renderDevices();
  renderLinks();
  await showAppInfo();
  await refreshStatus();

  /* Deep link: ?page=settings opens straight on the step the user asked for. */
  const q = new URLSearchParams(location.search).get('page');
  if (q === 'settings') { $('btnDone').hidden = false; $('btnNext').hidden = true; $('barSub').textContent = 'Settings'; }
}

function markDirty() {
  if (dirty) return;
  dirty = true;
  $('dirty').textContent = 'Unsaved changes';
}

/* Collect the form into a patch object. */
function collect() {
  return {
    port: Math.max(1024, Number($('port').value) || 8787),
    lanOnly: $('lanOnly').checked,
    startWithWindows: $('startWin').checked,
    startMinimised: $('startMin').checked,
    closeToTray: $('closeTray').checked,
    shift: {
      start: $('shStart').value || '09:00',
      end: $('shEnd').value || '18:00',
      graceMinutes: Number($('shGrace').value) || 0,
      halfDayHours: Number($('shHalf').value) || 4,
      earlyLeaveGraceMinutes: Number($('shEarly').value) || 0,
      weekendDays: $('shWeek').value ? $('shWeek').value.split(',').map(Number) : []
    }
  };
}

async function showAppInfo() {
  const i = await window.sf.appInfo();
  $('appInfo').textContent = `v${i.version} · Electron ${i.node}`;
}

/* ------------------------------------------------------------------ save */
async function save(quiet) {
  if (busy) return null;
  busy = true;
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await window.sf.saveSettings(collect());
    if (!r.ok) {
      showHostMsg(r.error, 'bad');
      flash(r.error || 'Could not save', 'bad');
      return null;
    }
    cfg = r;
    dirty = false;
    $('dirty').textContent = ' ';
    renderLinks();
    $('addr').value = r.urls.address;
    await refreshStatus();
    if (!quiet) flash('Settings saved', 'good');
    return r;
  } catch (e) {
    showHostMsg(e.message, 'bad');
    flash(e.message, 'bad');
    return null;
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function showHostMsg(msg, kind) {
  const el = $('hostMsg');
  el.innerHTML = msg
    ? `<div class="console err" style="max-height:120px">${escapeHtml(msg)}</div>`
    : '';
}

/* ---------------------------------------------------------------- status */
async function refreshStatus() {
  let s;
  try { s = await window.sf.status(); }
  catch (e) { s = { running: false, error: e.message }; }

  const running = !!s.running;
  const devs = s.devices || [];
  const online = devs.filter(d => d.online).length;

  setStat('stRunning', running ? 'Running' : 'Stopped', running ? 'ok' : 'bad');
  setStat('stTerm', devs.length ? `${online}/${devs.length}` : 'None yet', online ? 'ok' : (devs.length ? 'bad' : ''));
  setStat('stPunch', s.punches != null ? String(s.punches) : '—', '');
  setStat('stUp', running ? fmtUptime(s.uptimeSec) : '—', running ? 'ok' : '');

  $('addr').value = (s.addresses && s.addresses.address) || 'localhost';
  showHostMsg(running ? '' : (s.error || 'The attendance server is not running.'), running ? '' : 'bad');
  const t = $('btnToggleHost');
  if (t) t.textContent = running ? 'Stop server' : 'Start server';

  /* Device rows carry live status when we have it. */
  renderDevices(devs);
  return s;
}

function setStat(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.parentElement.className = 'rt' + (kind ? ' ' + kind : '');
}

function fmtUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/* --------------------------------------------------------------- devices */
function renderDevices(live) {
  const list = (cfg && cfg.settings.devices) || [];
  const host = $('devList');

  if (!list.length) {
    host.innerHTML = `<div class="empty">No terminals yet.<br>Run a scan above, or add one by hand.<br>
      <button class="btn sm" id="btnAdd2" style="margin-top:12px">＋ Add a terminal</button></div>`;
    const b = $('btnAdd2');
    if (b) b.onclick = () => addDevice();
    return;
  }

  const statusOf = (id) => (live || []).find(d => d.id === id) || null;

  host.innerHTML = list.map((d, i) => {
    const st = statusOf(d.id);
    const pill = st
      ? (st.online ? '<span class="pill on">Online</span>' : `<span class="pill off">${escapeHtml(st.lastError || 'Offline')}</span>`)
      : '<span class="pill">Not checked</span>';
    return `<div class="dev" data-i="${i}">
      <div class="top">
        <input class="inp" data-f="id" value="${escapeHtml(d.id || '')}" placeholder="Name" style="max-width:190px">
        ${pill}
        <span class="grow"></span>
        <label class="sw" style="align-items:center">
          <input type="checkbox" data-f="enabled" ${d.enabled !== false ? 'checked' : ''}><span></span>
          <div><b style="font-size:12px">Read from this terminal</b></div>
        </label>
      </div>
      <div class="fields">
        <label class="fld"><span>Model</span><input class="inp" data-f="model" value="${escapeHtml(d.model || '')}" placeholder="ZK K40"></label>
        <label class="fld"><span>IP address</span><input class="inp" data-f="host" value="${escapeHtml(d.host || '')}" placeholder="192.168.0.201"></label>
        <label class="fld"><span>Port</span><input class="inp" data-f="port" type="number" min="1" max="65535" value="${d.port || 80}"></label>
        <label class="fld"><span>Serial (optional)</span><input class="inp" data-f="sn" value="${escapeHtml(d.sn || '')}" placeholder="detected automatically"></label>
        <label class="fld" style="grid-column:1/-1"><span>Facility label</span><input class="inp" data-f="site" value="${escapeHtml(d.site || '')}" placeholder="Main House"></label>
      </div>
      <div class="foot">
        <button class="btn sm danger" data-act="del">Remove</button>
        ${st && st.lastOk ? `<span class="tiny">Last read ${escapeHtml(rel(st.lastOk))}${st.latencyMs != null ? ' · ' + st.latencyMs + ' ms' : ''}</span>` : ''}
        ${st && st.parseWarning ? `<span class="tiny" style="color:var(--red)">${escapeHtml(st.parseWarning)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  $$('.dev').forEach(row => {
    const i = Number(row.dataset.i);
    $$('[data-f]', row).forEach(inp => {
      inp.oninput = () => {
        const f = inp.dataset.f;
        cfg.settings.devices[i][f] = f === 'port' ? (Number(inp.value) || 80)
          : f === 'enabled' ? inp.checked : inp.value;
        markDirty();
        /* Renaming a terminal should not blank the table it is rendered from. */
        if (f === 'id') { inp.style.width = '190px'; }
      };
    });
    row.querySelector('[data-act=del]').onclick = () => {
      const name = cfg.settings.devices[i].id || 'this terminal';
      if (!confirm(`Remove ${name}? Its attendance history is kept.`)) return;
      cfg.settings.devices.splice(i, 1);
      renderDevices();
      markDirty();
      flash('Removed — save to apply');
    };
  });
}

function addDevice(preset) {
  const n = (cfg.settings.devices || []).length + 1;
  cfg.settings.devices.push(Object.assign({
    id: 'ZK' + n, model: '', host: '', port: 80, sn: '', site: '', enabled: true
  }, preset || {}));
  renderDevices();
  markDirty();
  const rows = $$('.dev');
  const last = rows[rows.length - 1];
  if (last) {
    last.scrollIntoView({ block: 'nearest' });
    const hostInp = last.querySelector('[data-f=host]');
    if (hostInp) { hostInp.focus(); hostInp.select(); }
  }
}

/* ------------------------------------------------------------------ scan */
async function scan() {
  const out = $('scanOut');
  out.hidden = false;
  out.classList.remove('err');
  out.textContent = 'Scanning this network for ZKTeco terminals…\n\nThis probes each address on your subnet. It takes about a minute.\n';
  const btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  try {
    const r = await window.sf.scanDevices();
    out.textContent = r.output || '(no output)';
    if (/FOUND \d+ terminal/i.test(r.output)) flash('Terminals found — review below', 'good');
  } catch (e) {
    out.classList.add('err');
    out.textContent = 'Scan failed: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan now';
  }
}

/* ------------------------------------------------------------- diagnostics */
async function diagnose() {
  const out = $('diagOut');
  out.hidden = false;
  out.classList.remove('err');
  out.textContent = 'Contacting terminals…';
  const btn = $('btnDiag');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    if (dirty) { const r = await save(true); if (!r) { out.textContent = 'Save your terminal details first.'; return; } }
    else await save(true);
    const text = await window.sf.diagnose();
    out.textContent = text;
    if (!/record\(s\) parsed/.test(text)) {
      out.classList.add('err');
    } else if (!/[1-9]\d* record\(s\) parsed/.test(text)) {
      out.classList.add('err');
      out.textContent += '\n\nNo records were parsed. If the raw lines above contain data,\n' +
        'send that output — the parser needs adjusting for that firmware.';
    } else {
      flash('Terminals are responding', 'good');
    }
  } catch (e) {
    out.classList.add('err');
    out.textContent = 'Test failed: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test terminals';
  }
}

/* ----------------------------------------------------------------- links */
function renderLinks() {
  const u = (cfg && cfg.urls) || {};
  const host = $('linkList');
  const rows = [
    ['AMAYA ERP — this machine', u.app, 'btnCopyApp', 'btnOpenApp'],
    ['AMAYA ERP — on this computer only', u.localhost, null, null],
    ['Live attendance — shareable, no login', u.live, 'btnCopyLive', 'btnOpenLive'],
    ['Server status', u.status, null, null]
  ].filter(r => r[1]);

  host.innerHTML = rows.map(([label, url, copyId, openId]) => `<div class="lk">
    <small>${escapeHtml(label)}</small>
    <b class="mono">${escapeHtml(url)}</b>
    <div class="row">
      ${copyId ? `<button class="btn sm" id="${copyId}">Copy link</button>` : ''}
      ${openId ? `<button class="btn sm" id="${openId}">Open ↗</button>` : ''}
    </div>
  </div>`).join('');

  const bind = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  bind('btnCopyApp', () => { window.sf.copy(u.app); flash('App link copied', 'good'); });
  bind('btnCopyLive', () => { window.sf.copy(u.live); flash('Live link copied', 'good'); });
  bind('btnOpenApp', () => window.sf.openExternal(u.app));
  bind('btnOpenLive', () => window.sf.openExternal(u.live));
}

/* --------------------------------------------------------------- tunnels */
let tunnel = null;
async function startTunnel(kind) {
  const exe = kind === 'cf' ? 'cloudflared' : 'ngrok';
  const out = $('tunOut');
  out.hidden = false;
  out.classList.remove('err');

  const cmd = kind === 'cf' ? 'tunnel --url http://localhost:' + cfg.settings.port : 'http ' + cfg.settings.port;
  out.textContent = `Starting ${exe}…\n${exe} ${cmd}\n\nWaiting for a public address…`;

  const r = await window.sf.startTunnel
    ? await window.sf.startTunnel(kind)
    : { ok: false, error: 'Not available in this build.' };

  if (!r.ok) {
    out.classList.add('err');
    out.textContent += `\n\n${r.error}\n\n` + (kind === 'cf'
      ? 'Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ then run this again.'
      : 'Install ngrok and run `ngrok config add-authtoken <your token>` first.');
    return;
  }
  if (r.url) {
    $(kind === 'cf' ? 'tunCf' : 'tunNg').value = r.url;
    out.textContent += `\n\nPublic address: ${r.url}`;
    flash('Tunnel started', 'good');
  }
}

/* ----------------------------------------------------------------- utils */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rel(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/* ------------------------------------------------------------------ wire */
document.addEventListener('DOMContentLoaded', async () => {
  ['port', 'lanOnly', 'startWin', 'startMin', 'closeTray', 'shStart', 'shEnd', 'shGrace', 'shHalf', 'shEarly', 'shWeek']
    .forEach(id => {
      const el = $(id);
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
    });
  $('lanOnly').addEventListener('change', async () => {
    /* The port and binding both need the server restarted, so do it now
       rather than leaving the window showing an address that is not live. */
    const r = await save(true);
    if (r) flash(r.urls.lanOnly ? `Reachable at ${r.urls.app}` : 'Now limited to this computer', 'good');
  });

  $('btnNext').onclick = async () => { if (dirty) await save(true); go(step + 1); };
  $('btnBack').onclick = () => go(step - 1);
  $('btnSave').onclick = () => save();
  $('btnAdd').onclick = () => { addDevice(); go(2); };
  $('btnScan').onclick = scan;
  $('btnDiag').onclick = diagnose;
  $('btnRefresh2').onclick = refreshStatus;
  $('btnStatusPage').onclick = () => window.sf.openExternal(cfg.urls.status);
  $('btnToggleHost').onclick = async () => {
    const btn = $('btnToggleHost');
    btn.disabled = true;
    const r = cfg.running ? await window.sf.stopHost() : await window.sf.startHost();
    btn.disabled = false;
    if (r && r.ok === false) { flash(r.error, 'bad'); showHostMsg(r.error, 'bad'); }
    else { cfg.running = !cfg.running; flash(cfg.running ? 'Server started' : 'Server stopped', cfg.running ? 'good' : 'warn'); }
    await refreshStatus();
    renderLinks();
  };
  $('btnReveal').onclick = () => window.sf.revealData();
  $('btnTunCf').onclick = () => startTunnel('cf');
  $('btnTunNg').onclick = () => startTunnel('ng');

  $('btnRestart').onclick = async () => {
    const btn = $('btnRestart');
    btn.disabled = true; btn.textContent = 'Restarting…';
    const r = await window.sf.restartHost();
    btn.disabled = false; btn.textContent = 'Restart server';
    await refreshStatus();
    if (r.ok) { renderLinks(); flash('Server restarted', 'good'); }
    else { showHostMsg(r.error, 'bad'); flash(r.error, 'bad'); }
  };

  $('btnDone').onclick = async () => {
    if (dirty) { const r = await save(true); if (!r) return; }
    await window.sf.completeSetup();
    flash('All set', 'good');
    setTimeout(() => window.sf.close(), 500);
  };

  $$('#steps span').forEach(s => { s.onclick = () => go(Number(s.dataset.step)); });

  /* Ctrl+S saves, matching every other tool on Windows. */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Escape') window.sf.close();
  });

  /* Warn before losing unsaved edits. */
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  await load();
  go(new URLSearchParams(location.search).get('page') === 'settings' ? 3 : 1);

  /* Keep the status readouts fresh without being noisy about it. */
  setInterval(() => { if (!busy && !dirty && step === 1) refreshStatus(); }, 6000);
});


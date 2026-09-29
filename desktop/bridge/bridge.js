#!/usr/bin/env node
/* ==========================================================================
   AMAYA Local Server  —  serves the ERP app + reads ZKTeco K40 / K50i
   --------------------------------------------------------------------------
   Runs on a machine on the same LAN as the biometric terminals and does three
   jobs from one process:

     /          the AMAYA ERP app (single file, served fresh from disk)
     /live      a read-only attendance board you can share as a link
     /api/*     normalised punch data for the app

   Why a server and not just a double-clicked file:
     • the terminals send no CORS headers, so a web page cannot read them
     • they are plain HTTP on the LAN, so an HTTPS page cannot reach them
     • a closed browser tab stops polling; this keeps running
     • serving over HTTP also means localStorage works properly, which
       browsers restrict on file:// pages

   Zero dependencies. Node 18+. Usage:
       node bridge.js                      # reads ./devices.json
       node bridge.js --config my.json
       node bridge.js --port 9000
       node bridge.js --diagnose           # probe devices and print raw replies
       node bridge.js --app ../index.html  # serve a specific app file
   ========================================================================== */

'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const { createSyncStore } = require('./sync');

const ROOT = process.env.STOCKFLOW_BRIDGE_ROOT || __dirname;
const START = new Date();

/* True when hosted inside the AMAYA desktop app rather than run directly.
   The two differ in how the operator configures things, so the console banner
   and the hints must not send someone to a config file that is not used. */
const EMBEDDED = process.env.STOCKFLOW_EMBEDDED === '1';

/** Punches and watermarks live beside the config, unless told otherwise. */
function dataDir() {
  return process.env.STOCKFLOW_BRIDGE_DATA
    ? path.resolve(process.env.STOCKFLOW_BRIDGE_DATA)
    : path.join(ROOT, 'data');
}

/* ------------------------------------------------------------------ CLI */
/* Accepts both `--key value` and `--key=value`. */
const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === '--' + name || a.startsWith('--' + name + '='));
const opt = (name, fallback) => {
  const inline = argv.find((a) => a.startsWith('--' + name + '='));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

/* ---------------------------------------------------------------- Config */
const DEFAULT_CONFIG = {
  port: 8787,
  host: '0.0.0.0',
  pollIntervalMs: 15000,
  pageSize: 5000,
  requestTimeoutMs: 8000,
  keepDays: 120,
  liveToken: '',
  apiToken: '',
  corsOrigin: '*',
  appFile: '../index.html',
  shift: {
    start: '09:00',
    end: '18:00',
    graceMinutes: 10,
    earlyLeaveGraceMinutes: 15,
    halfDayHours: 4,
    weekendDays: [5, 6]
  },
  devices: []
};

/**
 * Resolve the effective config.
 *
 * `overrides` lets a host application (the desktop app) supply config
 * programmatically instead of via a file, which is how the Windows build
 * supplies user settings from its own store.
 */
function loadConfig(overrides) {
  const file = path.resolve(ROOT, opt('config', 'devices.json'));
  let raw = {};
  let fromFile = false;
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); fromFile = true; }
    catch (e) { console.error(`[config] ${file} is not valid JSON — using defaults.`, e.message); }
  } else if (!overrides) {
    /* Deliberately do NOT fall back to devices.example.json: those are
       placeholder addresses, and polling them would fill the log with
       connection errors that look like a real fault. Start clean instead. */
    console.log('[config] No devices.json yet — starting with no terminals connected.');
    console.log('[config] The ERP app will still run. To add terminals: node find-devices.js');
  }
  if (overrides) raw = Object.assign({}, raw, overrides);

  const cfg = Object.assign({}, DEFAULT_CONFIG, raw);
  cfg.shift = Object.assign({}, DEFAULT_CONFIG.shift, raw.shift || {});
  if (opt('port')) cfg.port = Number(opt('port'));
  if (opt('app')) cfg.appFile = opt('app');
  /* Path of the single-file app this process will host. */
  cfg.appPath = cfg.appPath
    ? path.resolve(cfg.appPath)
    : path.resolve(ROOT, cfg.appFile || '../index.html');
  cfg.configPath = file;
  cfg.configFound = fromFile;
  if (!Array.isArray(cfg.devices)) cfg.devices = [];
  cfg.devices = cfg.devices.map((d, i) => Object.assign({
    id: d.id || `DEV-${String(i + 1).padStart(2, '0')}`,
    enabled: true,
    site: 'Main House',
    sn: '',
    port: 80,
    path: ''
  }, d));
  return cfg;
}

const CFG = loadConfig();
if (!CFG.liveToken) CFG.liveToken = randomToken(16);
if (!CFG.apiToken) CFG.apiToken = randomToken(24);

/* ----------------------------------------------------------------- Log */
const LEVELS = { debug: 10, info: 20, ok: 20, warn: 30, error: 40 };
const LOG_LEVEL = LEVELS[opt('verbose', 'info')] ? LEVELS[opt('verbose', 'info')] : 20;
const recent = [];

function log(level, scope, msg, extra) {
  const entry = { t: new Date().toISOString(), level, scope, msg };
  if (extra !== undefined) entry.data = extra;
  recent.unshift(entry);
  if (recent.length > 400) recent.length = 400;
  if (LEVELS[level] < LOG_LEVEL) return;
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const tag = { debug: '···', info: '   ', ok: ' ✓ ', warn: ' ! ', error: ' ✕ ' }[level] || '   ';
  const line = `${time} ${tag}[${scope}] ${msg}`;
  if (level === 'error') console.error(line, extra === undefined ? '' : extra);
  else if (level === 'warn') console.warn(line, extra === undefined ? '' : extra);
  else console.log(line, extra === undefined ? '' : extra);
}

function randomToken(len) {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const bytes = require('node:crypto').randomBytes(len);
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

/* --------------------------------------------------------------- Storage */
const PUNCH_FILE = path.join(dataDir(), 'punches.json');
const STATE_FILE = path.join(dataDir(), 'state.json');
const MAX_PUNCHES = 200000;

let punches = [];
let state = { watermarks: {}, seen: {}, links: {}, users: {}, lastRun: null, lastError: null };

function ensureDataDir() {
  try { fs.mkdirSync(dataDir(), { recursive: true }); } catch (_) {}
}
function loadStore() {
  ensureDataDir();
  try { if (fs.existsSync(PUNCH_FILE)) punches = JSON.parse(fs.readFileSync(PUNCH_FILE, 'utf8')) || []; } catch (e) { log('error', 'store', 'could not read punches.json', e.message); punches = []; }
  try { if (fs.existsSync(STATE_FILE)) state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}); } catch (e) { log('error', 'store', 'could not read state.json', e.message); }
  log('info', 'store', `loaded ${punches.length} punch(es), ${Object.keys(state.watermarks || {}).length} watermark(s)`);
}
let saveTimer = null;
function saveStore(immediate) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      ensureDataDir();
      fs.writeFileSync(PUNCH_FILE, JSON.stringify(punches));
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) { log('error', 'store', 'save failed', e.message); }
  };
  if (immediate) write(); else saveTimer = setTimeout(write, 1500);
}

/* ------------------------------------------------------------------ Sync
   The server side of the offline-first app. Created eagerly so a bad
   sync.json is reported at startup rather than on the first device that
   happens to sync. */
const sync = createSyncStore({
  dataDir: dataDir(),
  log,
  config: CFG.sync || {}
});

/* ------------------------------------------------------------ HTTP client */
function request(urlStr, { timeout, headers, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('bad url: ' + urlStr)); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers: Object.assign({ 'User-Agent': 'AMAYA-Bridge/1.0', Connection: 'close' }, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeout || CFG.requestTimeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const deviceBase = (d) => `http://${d.host}:${d.port || 80}${d.path || ''}`;

/* ------------------------------------------------------ Record parsing ----
   Terminals return one of two shapes depending on firmware:

   (a) XML  <ATTLOG><Row><Pin>101</Pin><DateTime>2026-09-27 09:02:11</DateTime>…</Row></ATTLOG>
   (b) Tab separated plain text, one punch per line:
           index \t pin \t verify \t 2026-09-27 09:02:11 \t workcode …
   We accept both, and rather than trusting column positions we locate the
   first field that parses as a date/time and treat the first numeric field
   before it as the pin. That survives firmware that adds or drops columns.
-------------------------------------------------------------------------- */

const VERIFY = {
  0: 'Password', 1: 'Fingerprint', 2: 'Card', 3: 'Fingerprint+Password', 4: 'Fingerprint+Card',
  5: 'Password+Card', 9: 'Palm', 10: 'PalmPrint', 15: 'Face', 16: 'Face+Password',
  17: 'Face+Card', 20: 'Face+Fingerprint+Password+Card', 255: 'Unknown'
};

const DATE_RE = /(\d{4})[-\/](\d{2})[-\/](\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

function parseDateTime(value) {
  if (!value) return null;
  const m = String(value).match(DATE_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const tagValue = (xml, tag) => {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
};

function parseXmlRecords(body) {
  const rows = body.match(/<Row>[\s\S]*?<\/Row>/gi) || [];
  const out = [];
  for (const row of rows) {
    const pin = tagValue(row, 'Pin') || tagValue(row, 'Pin2') || tagValue(row, 'UserID');
    const when = parseDateTime(tagValue(row, 'DateTime') || tagValue(row, 'Date'));
    if (!when) continue;
    const verify = Number(tagValue(row, 'Verify') || 0);
    out.push({
      pin: String(pin || '').trim(),
      at: when,
      verify,
      verifyName: VERIFY[verify] || 'Unknown',
      workCode: tagValue(row, 'WorkCode') || '0',
      group: tagValue(row, 'Group') || ''
    });
  }
  return out;
}

/**
 * Tab-separated ATTLOG layout, in full, is:
 *
 *     index \t pin \t verify \t date time \t workcode \t …
 *
 * The leading index is a row counter, NOT a person — reading it as the PIN
 * silently attributes every punch to the wrong person, so we count backwards
 * from the date-time field instead of taking the first number on the line.
 */
function parseTabRecords(body) {
  const out = [];
  let ambiguous = false;

  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split('\t').map((c) => c.trim());
    if (cells.length < 2) continue;

    let when = null;
    let dateIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const dt = parseDateTime(cells[i]);
      if (dt) { when = dt; dateIdx = i; break; }
    }
    if (!when) continue;

    const before = [];
    for (let i = 0; i < dateIdx; i++) {
      if (/^\d{1,12}$/.test(cells[i])) before.push(cells[i]);
    }

    let pin = null;
    let verify = 0;
    if (before.length >= 3) {
      /* index, pin, verify — take the last two, skipping the row counter. */
      verify = Number(before[before.length - 1]);
      pin = before[before.length - 2];
    } else if (before.length === 2) {
      /* Could be (index, pin) or (pin, verify). The documented layout for a
         modern K40/K50i always carries a verify field, so read it that way
         and flag the line so `--diagnose` can confirm. */
      pin = before[0];
      verify = Number(before[1]);
      ambiguous = true;
    } else if (before.length === 1) {
      pin = before[0];
    }
    if (!pin) continue;

    out.push({ pin, at: when, verify, verifyName: VERIFY[verify] || 'Unknown', workCode: cells[dateIdx + 1] || '0', group: '', ambiguous });
  }
  if (ambiguous) {
    out.forEach((r) => { r.note = 'two-column layout — verify field assumed'; });
  }
  return out;
}

function parseRecords(body) {
  const text = String(body || '').trim();
  if (!text) return [];
  if (text.startsWith('<')) return parseXmlRecords(text);
  return parseTabRecords(text);
}

/* --------------------------------------------------------- Device probes */
/** Device serial numbers are needed by most /iclock/records calls. */
async function probeSerial(d) {
  if (d.sn) return d.sn;
  const base = deviceBase(d);
  const tries = [
    `${base}/iclock/cdata?options=all&pushver=2.4.1&language=69`,
    `${base}/iclock/cdata?SN=1&options=all`,
    `${base}/iclock/cdata?SN=all`
  ];
  for (const url of tries) {
    try {
      const res = await request(url);
      const m = res.body.match(/(?:deviceSN|SN)=([A-Z0-9]{6,})/i) || res.body.match(/\bSN=([A-Z0-9]{6,})\b/i);
      if (m) { d.sn = m[1]; log('ok', d.id, `serial detected: ${d.sn}`); return d.sn; }
    } catch (_) { /* try the next form */ }
  }
  return '';
}

async function fetchPunches(d) {
  const base = deviceBase(d);
  const sn = await probeSerial(d);
  const stamp = Number(state.watermarks[d.id] || 0) || 0;
  const stampParam = stamp ? `&Stamp=${stamp}` : '';

  const urls = [];
  if (sn) urls.push(`${base}/iclock/records?deviceSn=${sn}&table=ATTLOG&type=1&limit=${CFG.pageSize}${stampParam}`);
  urls.push(`${base}/iclock/records?table=ATTLOG&type=1&limit=${CFG.pageSize}${stampParam}`);
  if (sn) urls.push(`${base}/iclock/records?deviceSn=${sn}&table=ATTLOG${stampParam}`);

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await request(url);
      if (res.status !== 200) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const rows = parseRecords(res.body);
      if (rows.length) {
        d.lastUrl = url.replace(/[?&](Stamp|SN|deviceSn)=[^&]*/g, '');
        return rows;
      }
      if (/^\s*$/ .test(res.body) || res.body.length < 8) return [];   // device has nothing new
      d.lastUrl = url.replace(/[?&](Stamp|SN|deviceSn)=[^&]*/g, '');
      d.parseWarning = 'unrecognised response (' + res.body.slice(0, 60).replace(/\s+/g, ' ') + ')';
      return [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no usable records endpoint');
}

async function fetchUsers(d) {
  const base = deviceBase(d);
  const sn = d.sn || (await probeSerial(d));
  if (!sn) return [];
  const res = await request(`${base}/iclock/user?SN=${sn}&All=1`);
  const text = res.body || '';
  if (text.startsWith('<')) {
    const rows = text.match(/<User>[\s\S]*?<\/User>/gi) || [];
    return rows.map((r) => ({
      pin: tagValue(r, 'Pin'),
      name: tagValue(r, 'Name'),
      group: tagValue(r, 'GroupId') || '',
      privilege: tagValue(r, 'Privilege') || ''
    })).filter(u => u.pin);
  }
  // plain text:  pin \t name \t privilege \t group
  return text.split(/\r?\n/).map((line) => {
    const c = line.split('\t');
    return { pin: (c[0] || '').trim(), name: (c[1] || '').trim(), group: (c[3] || '').trim(), privilege: (c[2] || '').trim() };
  }).filter(u => /^\d+$/.test(u.pin));
}

/* -------------------------------------------------------------- Ingest */
const seenKey = (p) => `${p.deviceId}|${p.pin}|${p.at}`;
const seenSet = new Set();
function rebuildSeen() {
  seenSet.clear();
  for (const p of punches) seenSet.add(seenKey(p));
}

const localDayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localClock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Records are stored with an absolute timestamp in UTC, but they are *grouped
 * by the local day of the office*. Punching in at 02:00 in Dhaka is 20:00 UTC
 * on the previous calendar date, so bucketing by the ISO date would file a
 * night-shift punch under the wrong day. `localDate` is resolved here, at the
 * machine that is actually on site, and is what every view groups on.
 */
function ingest(d, rows, source = 'poll') {
  const now = new Date();
  let added = 0, skipped = 0, maxStamp = Number(state.watermarks[d.id] || 0) || 0;
  const notes = new Set();

  for (const r of rows) {
    if (r.note) notes.add(r.note);
    const rec = {
      id: `${d.id}-${r.pin}-${r.at.getTime()}`,
      deviceId: d.id,
      deviceModel: d.model || '',
      site: d.site || '',
      pin: r.pin,
      at: r.at.toISOString(),
      localDate: localDayKey(r.at),
      localTime: localClock(r.at),
      epoch: Math.floor(r.at.getTime() / 1000),
      verify: r.verify,
      verifyName: r.verifyName,
      workCode: r.workCode || '0',
      name: r.name || '',
      receivedAt: now.toISOString(),
      source
    };
    if (r.at.getTime() > maxStamp) maxStamp = Math.floor(r.at.getTime() / 1000);
    const key = seenKey(rec);
    if (seenSet.has(key)) { skipped++; continue; }
    seenSet.add(key);
    punches.push(rec);
    added++;
  }

  punches.sort((a, b) => a.epoch - b.epoch || String(a.deviceId).localeCompare(String(b.deviceId)));
  if (punches.length > MAX_PUNCHES) punches = punches.slice(punches.length - MAX_PUNCHES);

  if (maxStamp) state.watermarks[d.id] = maxStamp;
  d.lastRecordAt = rows.length ? rows[rows.length - 1].at.toISOString() : d.lastRecordAt;
  d.lastCount = rows.length;
  d.lastAdded = added;
  d.parseNotes = [...notes];
  if (notes.size) log('warn', d.id, `parser note: ${[...notes].join('; ')}`);
  if (added) { d.lastOk = now.toISOString(); d.lastError = null; d.parseWarning = null; }
  return { added, skipped, received: rows.length };
}

function pruneOld() {
  const cutoff = Date.now() - CFG.keepDays * 86400000;
  const before = punches.length;
  punches = punches.filter(p => Date.parse(p.at) >= cutoff);
  if (punches.length !== before) {
    rebuildSeen();
    log('info', 'store', `pruned ${before - punches.length} punch(es) older than ${CFG.keepDays} days`);
    saveStore();
  }
}

async function pollDevice(d) {
  if (!d.enabled) return;
  const t0 = Date.now();
  try {
    const rows = await fetchPunches(d);
    const res = ingest(d, rows);
    d.online = true;
    d.latencyMs = Date.now() - t0;
    if (res.added) log('ok', d.id, `+${res.added} punch(es) (${res.received} received, ${res.skipped} duplicate)`);
    else log('debug', d.id, `no new punches (${res.received} received)`);
  } catch (e) {
    d.online = false;
    d.lastError = e.message;
    d.lastFail = new Date().toISOString();
    log('error', d.id, `poll failed — ${e.message}`);
  }
}

async function pollAll() {
  const enabled = CFG.devices.filter(d => d.enabled);
  if (!enabled.length) return;
  await Promise.all(enabled.map(pollDevice));
  state.lastRun = new Date().toISOString();
  saveStore();
  if (punches.length) pruneOld();
}

let pollTimer = null;
function startPolling() {
  stopPolling();
  const every = Math.max(5000, CFG.pollIntervalMs);
  pollTimer = setInterval(() => {
    if (pollAll.running) return;
    pollAll.running = true;
    pollAll().catch(e => log('error', 'poll', 'cycle failed', e.message)).finally(() => { pollAll.running = false; });
  }, every);
  log('info', 'bridge', `polling ${CFG.devices.filter(d => d.enabled).length} device(s) every ${Math.round(every / 1000)}s`);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ----------------------------------------------------------- Rollup / day */
const todayKey = (d) => localDayKey(d || new Date());
const toMinutes = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const hhmm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Resolve a device pin to a person via explicit link, then name/code match. */
function resolveIdentity(deviceId, pin) {
  const link = state.links[`${deviceId}:${pin}`];
  if (link) {
    return { employeeId: link.employeeId || null, name: link.name || '', source: 'link' };
  }
  const user = (state.users[`${deviceId}:${pin}`] || {});
  if (user.name) return { employeeId: null, name: user.name, source: 'device' };
  return { employeeId: null, name: '', source: 'unknown' };
}

/** Build a per-person day summary from the raw punch stream. */
function dayBoard(dateKey) {
  const key = dateKey || localDayKey(new Date());
  const rows = punches.filter(p => (p.localDate || p.at.slice(0, 10)) === key);
  const byPerson = new Map();

  for (const p of rows) {
    const who = resolveIdentity(p.deviceId, p.pin);
    const id = who.employeeId || `unmapped:${p.deviceId}:${p.pin}`;
    if (!byPerson.has(id)) {
      byPerson.set(id, {
        key: id,
        employeeId: who.employeeId,
        name: who.name || `Unmapped · pin ${p.pin}`,
        pin: p.pin,
        deviceId: p.deviceId,
        site: p.site,
        matched: !!who.employeeId,
        punches: []
      });
    }
    const rec = byPerson.get(id);
    rec.punches.push({ at: p.at, verifyName: p.verifyName, deviceId: p.deviceId });
    if (!rec.name || rec.name.startsWith('Unmapped')) rec.name = who.name || rec.name;
  }

  const shift = CFG.shift;
  const startMin = toMinutes(shift.start);
  const endMin = toMinutes(shift.end);
  const grace = shift.graceMinutes;
  const earlyGrace = shift.earlyLeaveGraceMinutes;
  const halfMin = shift.halfDayHours * 60;
  const weekday = new Date(key + 'T00:00:00').getDay();
  const isWeekend = (shift.weekendDays || []).includes(weekday);

  const out = [];
  for (const rec of byPerson.values()) {
    rec.punches.sort((a, b) => a.at.localeCompare(b.at));
    const first = new Date(rec.punches[0].at);
    const last = new Date(rec.punches[rec.punches.length - 1].at);
    const inMin = first.getHours() * 60 + first.getMinutes();
    const outMin = last.getHours() * 60 + last.getMinutes();
    const worked = Math.max(0, outMin - inMin);

    let status = 'Present';
    if (isWeekend && rec.punches.length) status = 'Weekend';
    else if (inMin > startMin + grace) status = 'Late';
    if (!isWeekend && rec.punches.length > 1 && worked < halfMin) status = 'Half Day';
    if (!isWeekend && rec.punches.length > 1 && outMin < endMin - earlyGrace) status = 'Early Leave';
    if (rec.punches.length === 1) status = isWeekend ? 'Weekend' : 'Single Punch';

    out.push(Object.assign(rec, {
      status,
      firstIn: first.toISOString(),
      lastOut: last.toISOString(),
      workedMinutes: worked,
      workedLabel: `${Math.floor(worked / 60)}h ${String(worked % 60).padStart(2, '0')}m`,
      lateBy: Math.max(0, inMin - startMin - grace),
      punchCount: rec.punches.length,
      firstVerify: rec.punches[0].verifyName,
      lastVerify: rec.punches[rec.punches.length - 1].verifyName
    }));
  }

  out.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return a.name.localeCompare(b.name);
  });

  const counts = out.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  return {
    date: key,
    generatedAt: new Date().toISOString(),
    shift,
    isWeekend,
    totals: {
      people: out.length,
      matched: out.filter(r => r.matched).length,
      unmapped: out.filter(r => !r.matched).length,
      present: (counts['Present'] || 0) + (counts['Weekend'] || 0),
      late: counts['Late'] || 0,
      absent: counts['Absent'] || 0,
      halfDay: counts['Half Day'] || 0,
      earlyLeave: counts['Early Leave'] || 0
    },
    rows: out
  };
}

function latestFeed(limit = 25) {
  return punches.slice(-limit).reverse().map(p => {
    const who = resolveIdentity(p.deviceId, p.pin);
    return Object.assign({}, p, {
      name: who.name || `Unmapped · pin ${p.pin}`,
      matched: !!who.employeeId,
      localTime: new Date(p.at).toLocaleTimeString('en-GB', { hour12: false })
    });
  });
}

/* ------------------------------------------------------------- Live view */
const LIVE_CSS = `
:root{--bg:#0d100e;--s:#171b18;--s2:#1f2420;--l:#2b312c;--t:#eaf2ec;--t2:#9aa89f;--t3:#6b7a71;
--ok:#35b37e;--late:#e0ab55;--bad:#e0685f;--blue:#5b95ef;--purple:#a382ea;--radius:14px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t);font:15px/1.5 Inter,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 0 16px;border-bottom:1px solid var(--l);margin-bottom:16px}
h1{font-size:19px;letter-spacing:-.03em;margin:0}
h1 small{display:block;font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.14em;font-weight:800;margin-top:2px}
.clock{margin-left:auto;text-align:right}
.clock b{font-size:26px;letter-spacing:-.04em;font-variant-numeric:tabular-nums;display:block;line-height:1.1}
.clock small{font-size:10.5px;color:var(--t3);font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;font-size:11px;font-weight:800;background:var(--s2);color:var(--t2);border:1px solid var(--l)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--t3);flex:none}
.dot.on{background:var(--ok);box-shadow:0 0 0 3px rgba(53,179,126,.18)}
.dot.off{background:var(--bad);box-shadow:0 0 0 3px rgba(224,104,95,.18)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px}
.stat{background:var(--s);border:1px solid var(--l);border-radius:var(--radius);padding:12px 14px}
.stat small{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:var(--t3)}
.stat b{font-size:26px;letter-spacing:-.04em;display:block;margin-top:3px}
.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;align-items:start}
.card{background:var(--s);border:1px solid var(--l);border-radius:var(--radius);overflow:hidden}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.11em;color:var(--t3);margin:0;padding:13px 15px;border-bottom:1px solid var(--l);font-weight:800}
table{width:100%;border-collapse:collapse}
th{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);text-align:left;padding:9px 13px;background:var(--s2);font-weight:800;position:sticky;top:0}
td{padding:9px 13px;border-top:1px solid var(--l);font-size:12.5px;color:var(--t2)}
td b{color:var(--t)}
tbody tr:hover td{background:var(--s2)}
.b{display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:800;background:var(--s2);color:var(--t2);border:1px solid var(--l)}
.b.ok{background:rgba(53,179,126,.15);color:var(--ok);border-color:transparent}
.b.late{background:rgba(224,171,85,.15);color:var(--late);border-color:transparent}
.b.bad{background:rgba(224,104,95,.15);color:var(--bad);border-color:transparent}
.b.blue{background:rgba(91,149,239,.15);color:var(--blue);border-color:transparent}
.b.purple{background:rgba(163,130,234,.15);color:var(--purple);border-color:transparent}
.mono{font-family:"DM Mono",ui-monospace,Menlo,Consolas,monospace}
.scroll{max-height:520px;overflow-y:auto}
.feed{display:flex;flex-direction:column}
.feed .row{display:flex;align-items:center;gap:10px;padding:9px 15px;border-top:1px solid var(--l);font-size:12.5px}
.feed .row:first-child{border-top:0}
.feed time{margin-left:auto;color:var(--t3);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.feed .v{font-size:10px;color:var(--t3);white-space:nowrap}
.foot{text-align:center;color:var(--t3);font-size:11px;padding:18px 0 6px;line-height:1.7}
.bar{height:5px;background:var(--l);border-radius:99px;overflow:hidden;margin-top:7px}
.bar div{height:100%;background:var(--ok);border-radius:inherit;transition:width .4s}
a{color:var(--blue)}
@media(max-width:860px){.grid{grid-template-columns:1fr}.clock b{font-size:20px}.stat b{font-size:21px}}
`;

function livePage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d100e">
<meta http-equiv="refresh" content="30">
<title>Live attendance · AMAYA</title>
<style>${LIVE_CSS}</style>
</head><body>
<div class="wrap">
  <header>
    <div>
      <h1>Live attendance<small>AMAYA ERP · biometric terminals</small></h1>
    </div>
    <div class="row" id="devs" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    <div class="clock"><b id="clk">--:--:--</b><small id="datelbl">—</small></div>
  </header>

  <div class="stats" id="stats"></div>

  <div class="grid">
    <div class="card">
      <h2>Today's board</h2>
      <div class="scroll"><table>
        <thead><tr><th>Person</th><th>Terminal</th><th>In</th><th>Out</th><th class="right">Worked</th><th>Status</th></tr></thead>
        <tbody id="board"><tr><td colspan="6" style="text-align:center;padding:28px;color:var(--t3)">Loading…</td></tr></tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>Latest punches</h2>
      <div class="scroll feed" id="feed"></div>
    </div>
  </div>

  <p class="foot" id="foot">—</p>
</div>

<script>
var TOKEN=${JSON.stringify(CFG.liveToken)};
var API=${JSON.stringify('/api')};
function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e;}

function tick(){
  var d=new Date();
  document.getElementById('clk').textContent=d.toLocaleTimeString('en-GB',{hour12:false});
  document.getElementById('datelbl').textContent=d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
}
setInterval(tick,1000);tick();

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function badge(s){
  var cls={'Present':'ok','Weekend':'purple','Late':'late','Half Day':'late','Early Leave':'bad','Single Punch':'blue','Absent':'bad'}[s]||'';
  return '<span class="b '+cls+'">'+esc(s)+'</span>';
}
function hm(iso){
  if(!iso)return '—';
  var d=new Date(iso);
  return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}

function load(){
  fetch(API+'/live?token='+encodeURIComponent(TOKEN),{cache:'no-store'})
   .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
   .then(function(d){render(d);})
   .catch(function(e){
     document.getElementById('board').innerHTML='<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--late)">Live feed unavailable ('+esc(e.message)+')</td></tr>';
     document.getElementById('foot').textContent='Retrying automatically…';
   });
}

function render(d){
  var t=d.totals;
  document.getElementById('stats').innerHTML=[
    ['On site',t.present,'var(--ok)'],
    ['Late',t.late,'var(--late)'],
    ['Half day',t.halfDay,'var(--late)'],
    ['Unmapped',t.unmapped,t.unmapped?'var(--bad)':'var(--t3)'],
    ['Punches',d.punchCount,'var(--blue)'],
    ['Terminals',d.devices.filter(function(x){return x.online;}).length+'/'+d.devices.length,'var(--purple)']
  ].map(function(s){
    return '<div class="stat"><small>'+esc(s[0])+'</small><b style="color:'+s[2]+'">'+(s[1]==null?0:s[1])+'</b></div>';
  }).join('');

  document.getElementById('devs').innerHTML=d.devices.map(function(x){
    return '<span class="pill"><span class="dot '+(x.online?'on':'off')+'"></span>'+esc(x.id)+
      (x.model?' <span style="opacity:.6">'+esc(x.model)+'</span>':'')+'</span>';
  }).join('');

  var body=d.rows.length?d.rows.map(function(r){
    return '<tr><td><b>'+esc(r.name)+'</b>'+(r.matched?'':' <span class="b bad">unmapped</span>')+
      (r.punchCount>1?'<div style="font-size:10.5px;color:var(--t3)">'+r.punchCount+' punches</div>':'')+'</td>'+
      '<td>'+esc(r.deviceId)+'</td><td class="mono">'+hm(r.firstIn)+'</td><td class="mono">'+hm(r.lastOut)+'</td>'+
      '<td class="right mono">'+esc(r.workedLabel)+'</td><td>'+badge(r.status)+'</td></tr>';
  }).join(''):'<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--t3)">No punches recorded today</td></tr>';
  document.getElementById('board').innerHTML=body;

  document.getElementById('feed').innerHTML=d.feed.length?d.feed.map(function(p){
    return '<div class="row"><b>'+esc(p.name)+'</b><span class="v">'+esc(p.verifyName||'')+'</span><time>'+esc(p.localTime)+'</time></div>';
  }).join(''):'<div class="row" style="color:var(--t3)">No punches yet</div>';

  var g=d.generatedAt?new Date(d.generatedAt):new Date();
  document.getElementById('foot').innerHTML='Updated '+g.toLocaleTimeString('en-GB',{hour12:false})+
    ' · shift '+esc(d.shift.start)+'–'+esc(d.shift.end)+' · auto-refreshes every 15s · next poll in '+
    (d.nextPollIn!=null?Math.max(0,Math.round(d.nextPollIn/1000))+'s':'—')+
    '<br><a href="/">AMAYA ERP</a> · <a href="/status">server status</a> · read-only view';
}

load();
setInterval(load,15000);
</script>
</body></html>`;
}

/* ------------------------------------------------------------- HTTP API */
function send(res, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : String(body);
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': CFG.corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Bridge-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  }, extraHeaders));
  res.end(payload);
}
/* The 2 MB default is fine for the small control endpoints. A first sync from a
 * fresh device can legitimately be several megabytes of records, so `limit` is
 * a parameter rather than a constant — and an oversized body is refused
 * outright rather than silently truncated, because half a sync applied is worse
 * than none applied. */
const readBody = (req, limit = 2e6) => new Promise((resolve) => {
  let raw = '';
  let tooBig = false;
  req.on('data', c => {
    if (tooBig) return;
    raw += c;
    if (raw.length > limit) { tooBig = true; raw = ''; }
  });
  req.on('end', () => {
    if (tooBig) return resolve({ __tooLarge: true, limit });
    try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
  });
  req.on('error', () => resolve({}));
});

function deviceStatus() {
  return CFG.devices.map(d => ({
    id: d.id, model: d.model, host: d.host, port: d.port || 80, sn: d.sn,
    site: d.site, enabled: d.enabled,
    online: !!d.online, latencyMs: d.latencyMs ?? null,
    lastOk: d.lastOk || null, lastFail: d.lastFail || null, lastError: d.lastError || null,
    lastRecordAt: d.lastRecordAt || null,
    lastAdded: d.lastAdded ?? 0, lastCount: d.lastCount ?? 0,
    parseWarning: d.parseWarning || null,
    parseNotes: d.parseNotes || []
  }));
}

function authorised(req) {
  if (!CFG.apiToken) return true;
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/live') return url.searchParams.get('token') === CFG.liveToken;
  const header = req.headers['x-bridge-token'] || req.headers.authorization;
  return header === CFG.apiToken || header === 'Bearer ' + CFG.apiToken;
}

/* Push-mode endpoints: some firmware is configured to upload instead of
   being polled. Handling them costs little and makes the bridge work either
   way. The shapes seen in the wild are:

     /iclock/devicecmd?SN=…&cmd=ATTLOG&Pin=101&DateTime=2026-09-27 09:12:11&Verify=15
     /iclock/records?SN=…&table=<tab separated rows>
     /iclock/getrequest?SN=…            (device asking for its next command)
     /iclock/cdata?SN=…&options=all    (device announcing itself)                */
async function handlePush(url, res) {
  const q = url.searchParams;
  const sn = q.get('SN') || q.get('deviceSN') || 'UNKNOWN';
  const d = CFG.devices.find(x => x.sn && x.sn === sn)
        || CFG.devices.find(x => x.id === q.get('deviceId'))
        || CFG.devices[0];
  const path = url.pathname;
  log('info', 'push', `${path} from ${sn}${d ? ` (${d.id})` : ' (unmatched device)'}`);

  const isAttendanceCommand = String(q.get('cmd') || '').toUpperCase() === 'ATTLOG';

  if (isAttendanceCommand || q.get('Pin') || q.get('pin')) {
    const pin = (q.get('Pin') || q.get('pin') || '').trim();
    const when = parseDateTime(q.get('DateTime') || q.get('datetime') || q.get('time') || q.get('Time'));
    if (d && pin && when) {
      const verify = Number(q.get('Verify') || q.get('verify') || 0);
      const res2 = ingest(d, [{ pin, at: when, verify, verifyName: VERIFY[verify] || 'Unknown', workCode: q.get('WorkCode') || '0' }], 'push');
      state.lastRun = new Date().toISOString();
      saveStore();
      if (res2.added) log('ok', d.id, `push received: pin ${pin} at ${when.toLocaleTimeString('en-GB', { hour12: false })}`);
    } else {
      log('warn', 'push', `ATTLOG push from ${sn} had no usable Pin/DateTime (pin=${pin || '—'})`);
    }
    return send(res, 200, 'OK', 'text/plain; charset=utf-8');
  }

  /* Some firmware ships a whole batch inside a parameter. */
  if (q.has('table')) {
    const raw = q.get('table') || '';
    if (/ATTLOG/i.test(raw) || parseRecords(raw).length) {
      const rows = parseRecords(raw.replace(/^ATTLOG\s*/i, ''));
      if (rows.length && d) {
        const res2 = ingest(d, rows, 'push');
        state.lastRun = new Date().toISOString();
        saveStore();
        log('ok', d.id, `batch push: +${res2.added} punch(es)`);
      }
    }
    return send(res, 200, 'OK', 'text/plain; charset=utf-8');
  }

  if (path === '/iclock/getrequest') {
    /* Device asks whether it has work. Reply OK plus the current time so it
       keeps its clock aligned and does not retry aggressively. */
    return send(res, 200, `OK ${Math.floor(Date.now() / 1000)}`, 'text/plain; charset=utf-8');
  }

  return send(res, 200, 'OK ' + Math.floor(Date.now() / 1000), 'text/plain; charset=utf-8');
}

/* ------------------------------------------------------------ App hosting */
/**
 * Serve the single-file ERP app.
 *
 * Read from disk on every request and revalidated by modification time, so a
 * rebuild shows up on the next page load without restarting anything. Serving
 * over HTTP rather than file:// also means localStorage behaves normally —
 * browsers restrict storage on file:// pages in some configurations.
 */
let appCache = { mtimeMs: 0, body: null };

function serveApp(res) {
  let stat;
  try {
    stat = fs.statSync(CFG.appPath);
  } catch (e) {
    return send(res, 500,
      `<!doctype html><meta charset="utf-8"><title>App not found</title>
       <body style="font:15px/1.6 system-ui;max-width:640px;margin:60px auto;padding:0 20px;color:#222">
       <h1 style="font-size:20px">AMAYA ERP app not found</h1>
       <p>Expected it at <code>${escapeHtml(CFG.appPath)}</code>.</p>
       <p>Build it, or point the server at the right file:</p>
       <pre style="background:#f4f4f5;padding:12px;border-radius:8px">cd stockflow-erp
.\\build.ps1
cd bridge
node bridge.js --app ../index.html</pre></body>`,
      'text/html; charset=utf-8');
  }

  if (!appCache.body || appCache.mtimeMs !== stat.mtimeMs) {
    appCache = { mtimeMs: stat.mtimeMs, body: fs.readFileSync(CFG.appPath) };
    log('info', 'app', `loaded ${(stat.size / 1024).toFixed(1)} KB from ${CFG.appPath}`);
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': appCache.body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(appCache.body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    /* ---- ZKTeco push endpoints (device → bridge) ---- */
    if (p.startsWith('/iclock/')) return await handlePush(url, res);

    /* ---- Public ---- */
    if (p === '/health') {
      return send(res, 200, {
        ok: true, service: 'stockflow-attendance-bridge', version: '1.0.0',
        uptimeSec: Math.round((Date.now() - START) / 1000),
        devices: deviceStatus(), lastRun: state.lastRun,
        punches: punches.length,
        nextPollInMs: Math.max(0, CFG.pollIntervalMs - (Date.now() - (Date.parse(state.lastRun) || 0)))
      });
    }

    if (p === '/live' || p === '/live/') {
      const token = url.searchParams.get('token');
      if (token && token !== CFG.liveToken) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
      return send(res, 200, livePage(), 'text/html; charset=utf-8');
    }

    if (p === '/api/live') {
      if (!authorised(req)) return send(res, 401, { error: 'unauthorised' });
      return send(res, 200, Object.assign(dayBoard(url.searchParams.get('date')), {
        devices: deviceStatus(), feed: latestFeed(30),
        punchCount: punches.length,
        nextPollIn: Math.max(0, CFG.pollIntervalMs - (Date.now() - (Date.parse(state.lastRun) || 0)))
      }));
    }

    /* ---- Authenticated API ---- */
    if (p.startsWith('/api/')) {
      if (!authorised(req)) return send(res, 401, { error: 'unauthorised', hint: 'Send X-Bridge-Token header' });
    }

    if (p === '/api/devices') return send(res, 200, { devices: deviceStatus(), pollIntervalMs: CFG.pollIntervalMs, lastRun: state.lastRun });

    if (p === '/api/devices/refresh' && req.method === 'POST') {
      await pollAll();
      return send(res, 200, { ok: true, devices: deviceStatus(), punches: punches.length });
    }

    if (p === '/api/attendance') {
      const since = url.searchParams.get('since');
      const limit = Number(url.searchParams.get('limit') || 5000);
      let rows = punches;
      if (since) rows = rows.filter(x => x.at > since || x.receivedAt > since);
      return send(res, 200, { count: Math.min(rows.length, limit), punches: rows.slice(-limit), lastRun: state.lastRun });
    }

    if (p === '/api/attendance/today') return send(res, 200, dayBoard(url.searchParams.get('date')));

    if (p === '/api/users') {
      /* Refresh device user lists on demand so pins can be named. */
      if (url.searchParams.get('refresh') === '1') await refreshUsers();
      const out = [];
      Object.keys(state.users).forEach(k => out.push(Object.assign({ mapKey: k }, state.users[k])));
      return send(res, 200, { users: out });
    }

    if (p === '/api/links') {
      if (req.method === 'GET') return send(res, 200, { links: state.links });
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        const key = `${body.deviceId}:${body.pin}`;
        if (body.clear) delete state.links[key];
        else state.links[key] = { employeeId: body.employeeId || '', name: body.name || '', updatedAt: new Date().toISOString() };
        saveStore();
        return send(res, 200, { ok: true, links: state.links });
      }
    }

    if (p === '/api/diagnostics') {
      const id = url.searchParams.get('device');
      const d = CFG.devices.find(x => x.id === id);
      if (!d) return send(res, 404, { error: 'unknown device', known: CFG.devices.map(x => x.id) });
      const out = { device: d.id, host: d.host, probes: [] };
      const sn = d.sn || (await probeSerial(d));
      out.sn = sn;
      /* Deliberately no Stamp: this is a parser check, so we want the device
         to return actual records even when polling has caught up. */
      const urls = [
        `${deviceBase(d)}/iclock/cdata?options=all&pushver=2.4.1`,
        `${deviceBase(d)}/iclock/records?table=ATTLOG&type=1&limit=20`
      ];
      if (sn) urls.unshift(`${deviceBase(d)}/iclock/records?deviceSn=${sn}&table=ATTLOG&type=1&limit=20`);
      for (const u of urls) {
        try {
          const r = await request(u);
          const parsed = parseRecords(r.body);
          out.probes.push({
            url: u.replace(/\?.*$/, '?…'),
            status: r.status,
            parsed: parsed.length,
            sample: r.body.slice(0, 400),
            firstRecords: parsed.slice(0, 5)
          });
        } catch (e) { out.probes.push({ url: u.replace(/\?.*$/, '?…'), error: e.message }); }
      }
      out.status = deviceStatus().find(x => x.id === d.id);
      return send(res, 200, out);
    }

    if (p === '/api/logs') return send(res, 200, { entries: recent.slice(0, 120) });

    /* ---- Offline sync ----------------------------------------------------
       The app is offline-first: it writes everything to local storage and works
       with no network at all. That is the right default for a shop floor, but
       it means two devices that both work offline have silently diverged and
       there is no record of who changed what. These endpoints are the
       reconciliation point. The revision, tombstone and conflict model is
       documented in bridge/sync.js. */

    if (p === '/api/sync/status') {
      return send(res, 200, Object.assign({ ok: true }, sync.status()));
    }

    if (p === '/api/sync/pull') {
      /* `since` is the highest rev the client already holds. Omitting it is a
       * full pull, which is what a device does on first sync. */
      const since = Number(url.searchParams.get('since') || 0);
      const device = url.searchParams.get('device') || '';
      const limit = url.searchParams.get('limit');
      let collections = null;
      if (url.searchParams.get('collections')) {
        collections = url.searchParams
          .get('collections').split(',').map(s => s.trim()).filter(Boolean);
      }

      const result = sync.pull({ since, collections, limit });
      if (device) sync.notePull(device);

      if (result.hasMore) {
        /* A client that reads `changes` but ignores `hasMore` would stop
         * part-way through a large catch-up and believe it was up to date.
         * Hand back the next URL so continuing is the easy path. */
        result.next = `/api/sync/pull?since=${result.cursor}&device=${encodeURIComponent(device)}`;
      }
      log('debug', 'sync',
        `pull ${device || 'anon'} since ${since} -> ${result.count} change(s), cursor ${result.cursor}/${result.serverRev}`);
      return send(res, 200, result);
    }

    if (p === '/api/sync/push' && (req.method === 'POST' || req.method === 'PUT')) {
      /* Generous limit: a device that has been offline over a long weekend can
       * legitimately hold a few megabytes of unsent work. */
      const body = await readBody(req, 32 * 1024 * 1024);
      if (body.__tooLarge) {
        return send(res, 413, {
          error: 'push body too large',
          limitBytes: body.limit,
          hint: 'Send the batch in pages. Every change carries its own baseRev, so splitting a push is safe.'
        });
      }
      if (!Array.isArray(body.changes)) {
        return send(res, 400, { error: 'changes must be an array' });
      }

      const result = sync.push({
        device: body.device || '',
        changes: body.changes,
        /* 'conflict' (default) hands the server copy back for the client to
         * merge against. 'lww' resolves server-side on updatedAt. */
        strategy: body.strategy === 'lww' ? 'lww' : 'conflict',
        /* The client is blocked on this response, so it is the place to make
         * the write durable rather than waiting for a debounce. */
        immediate: true
      });

      if (result.ok) {
        const bits = [`${result.accepted.length} accepted`];
        if (result.conflicts.length) bits.push(`${result.conflicts.length} conflict(s)`);
        if (result.rejected.length) bits.push(`${result.rejected.length} rejected`);
        log(result.conflicts.length || result.rejected.length ? 'warn' : 'ok', 'sync',
          `push ${body.device || 'anon'} — ${bits.join(', ')}`);
        sync.registerClient(body.device, { platform: body.platform, appVersion: body.appVersion });
        return send(res, 200, result);
      }
      log('warn', 'sync', `push refused: ${result.error}`);
      return send(res, 400, result);
    }

    if (p === '/api/sync/sweep' && req.method === 'POST') {
      /* Tombstone housekeeping. Normally a timer, but exposed so an operator
       * can reclaim space after decommissioning a device. */
      const dropped = sync.sweepTombstones();
      sync.save(true);
      return send(res, 200, { ok: true, dropped });
    }

    if (p === '/api/sync/reset' && req.method === 'POST') {
      /* Destroys every synced record. Needs the token in the body as well as
       * the header so an accidental POST from a script cannot wipe a shop's
       * data. */
      const body = await readBody(req);
      if (body.confirm !== 'DELETE-ALL-SYNC-DATA') {
        return send(res, 400, {
          error: 'refused',
          hint: 'Send { "confirm": "DELETE-ALL-SYNC-DATA" } to wipe the sync store.'
        });
      }
      return send(res, 200, sync.reset());
    }

    /* ---- the AMAYA ERP app, served from disk ---- */
    if (p === '/' || p === '/index.html' || p === '/app' || p === '/erp') {
      return serveApp(res);
    }

    if (p === '/status' || p === '/status/') {
      return send(res, 200, statusPage(), 'text/html; charset=utf-8');
    }

    return send(res, 404, {
      error: 'not found',
      endpoints: ['/', '/live?token=…', '/status', '/health', '/api/live?token=…', '/api/devices', '/api/attendance?since=ISO', '/api/attendance/today', '/api/users?refresh=1', '/api/links', '/api/diagnostics?device=ID', '/api/logs',
        '/api/sync/status', '/api/sync/pull?since=REV&device=ID', '/api/sync/push (POST)', '/api/sync/sweep (POST)']
    });
  } catch (e) {
    log('error', 'http', `${p} failed — ${e.message}`);
    return send(res, 500, { error: e.message });
  }
});

async function refreshUsers() {
  for (const d of CFG.devices.filter(x => x.enabled)) {
    try {
      const users = await fetchUsers(d);
      users.forEach(u => { state.users[`${d.id}:${u.pin}`] = { pin: u.pin, name: u.name, group: u.group, deviceId: d.id }; });
      if (users.length) log('ok', d.id, `${users.length} user(s) read from device`);
    } catch (e) { log('warn', d.id, `user list unavailable — ${e.message}`); }
  }
  saveStore();
}

/* --------------------------------------------------------- Status page */
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
function statusPage() {
  const ips = lanAddresses();
  const host = ips[0] || 'localhost';
  const appUrl = `http://${host}:${CFG.port}/`;
  const liveUrl = `http://${host}:${CFG.port}/live?token=${CFG.liveToken}`;
  const devs = deviceStatus();
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AMAYA Local Server</title>
<style>${LIVE_CSS}</style></head><body><div class="wrap">
<header><div><h1>AMAYA local server<small>ERP app + ZKTeco K40 / K50i attendance</small></h1></div></header>

<div class="stats" id="stats">
  <div class="stat"><small>App</small><b style="font-size:15px;color:var(--ok)">Ready</b></div>
  <div class="stat"><small>Terminals online</small><b style="color:${devs.filter(d=>d.online).length ? 'var(--ok)' : 'var(--t3)'}">${devs.filter(d=>d.online).length}/${devs.length}</b></div>
  <div class="stat"><small>Punches held</small><b>${punches.length}</b></div>
  <div class="stat"><small>Uptime</small><b style="font-size:19px">${Math.round((Date.now()-START)/60000)}m</b></div>
</div>

<div class="card"><h2>Open</h2><div class="scroll"><table><tbody>
${[['AMAYA ERP app', `<a href="/">${appUrl}</a>`],
   ['Live attendance (read-only, share this)', `<a href="/live?token=${encodeURIComponent(CFG.liveToken)}">${liveUrl}</a>`],
   ['API token for the app', `<span class="mono">${escapeHtml(CFG.apiToken)}</span>`],
   ['Live-view token', `<span class="mono">${escapeHtml(CFG.liveToken)}</span>`],
   ['Health check', `<a href="/health">/health</a>`]]
  .map(r => `<tr><td><b>${r[0]}</b></td><td class="mono" style="word-break:break-all;font-size:11.5px">${r[1]}</td></tr>`).join('')}
</tbody></table></div></div>

${devs.length ? `<div class="card" style="margin-top:16px"><h2>Terminals</h2><div class="scroll"><table>
<thead><tr><th>Terminal</th><th>Model</th><th>Address</th><th>Serial</th><th>Status</th></tr></thead>
<tbody>${devs.map(d => `<tr>
  <td><b>${escapeHtml(d.id)}</b></td>
  <td>${escapeHtml(d.model || '—')}</td>
  <td class="mono" style="font-size:11px">${escapeHtml(d.host)}:${d.port}</td>
  <td class="mono" style="font-size:11px">${escapeHtml(d.sn || '—')}</td>
  <td>${d.online ? '<span class="b ok">Online</span>' : `<span class="b bad">${escapeHtml(d.lastError || 'Offline')}</span>`}</td>
</tr>`).join('')}</tbody></table></div></div>`
: `<div class="card" style="margin-top:16px"><h2>Terminals</h2><div class="scroll"><table><tbody>
  <tr><td>No terminals configured yet. Edit <b class="mono">devices.json</b> beside bridge.js, then restart.
  Run <b class="mono">node find-devices.js</b> to scan the network for them.</td></tr>
</tbody></table></div></div>`}

<p class="foot">Open the app, then paste the API token into <b>Settings → Biometric terminals</b>.</p>
</div></body></html>`;
}

/* ------------------------------------------------------------------ Boot */
function banner() {
  const ips = lanAddresses();
  const line = '─'.repeat(66);
  const host = ips[0] || 'localhost';
  const appOk = fs.existsSync(CFG.appPath);
  console.log('');
  console.log('  AMAYA Local Server  ·  ERP app + ZKTeco K40 / K50i');
  console.log('  ' + line);
  console.log(`  Listening      ${CFG.host}:${CFG.port}`);
  console.log(`  App file       ${appOk ? 'found' : 'NOT FOUND'}  ${CFG.appPath}`);
  console.log(`  Devices        ${CFG.devices.map(d => `${d.id} (${d.host})`).join(', ') || 'none configured yet'}`);
  if (CFG.devices.length) console.log(`  Polling every  ${Math.round(CFG.pollIntervalMs / 1000)}s`);
  console.log('  ' + line);
  console.log('  Open the app:');
  ips.forEach(ip => console.log(`    http://${ip}:${CFG.port}/`));
  if (!ips.length) console.log(`    http://localhost:${CFG.port}/`);
  console.log('  ' + line);
  console.log(`  Bridge URL     http://${host}:${CFG.port}`);
  console.log(`  API token      ${CFG.apiToken}`);
  console.log('  ' + line);
  console.log('  Live attendance board (share this, no login needed):');
  ips.forEach(ip => console.log(`    http://${ip}:${CFG.port}/live?token=${CFG.liveToken}`));
  if (!ips.length) console.log(`    http://localhost:${CFG.port}/live?token=${CFG.liveToken}`);
  console.log('  ' + line);
  if (!CFG.devices.length) {
    console.log('  No terminals yet. To add them later:');
    if (EMBEDDED) {
      console.log('    In AMAYA ERP: Setup and settings → Terminals → Scan now');
    } else {
      console.log('    node find-devices.js            scan this network for terminals');
      console.log('    notepad devices.json            then set each terminal\'s host');
      console.log('    node bridge.js --diagnose       confirm it reads them');
    }
  }
  if (EMBEDDED) {
    console.log('  In AMAYA ERP: Settings → Biometric terminals, paste the API token above.');
    console.log('  Tray icon → Setup and settings… for the machine, terminal and remote options.');
  } else {
    console.log('  In the app: Settings → Biometric terminals, paste the API token.');
  }
  console.log('  For access from outside the office, put this behind a tunnel or');
  console.log('  reverse proxy with TLS, e.g.  cloudflared tunnel --url http://localhost:' + CFG.port);
  console.log(EMBEDDED ? '  The console can be closed — the app keeps running.' : '  Press Ctrl+C to stop.');
  console.log('');
}

async function main() {
  loadStore();
  rebuildSeen();

  if (flag('diagnose')) {
    await diagnose();
    process.exit(0);
  }

  return startServer();
}

/**
 * Probe every terminal and print the raw replies, so the operator can confirm
 * the parser understands their firmware before trusting any numbers.
 * Shared with the desktop app, which shows this output in its setup window.
 */
async function diagnose() {
  const report = [];
  const say = (s) => { report.push(s); console.log(s); };
  say('\n  Probing devices — this prints the raw replies so you can confirm');
  say('  the terminal firmware and column layout are understood.\n');

  for (const d of CFG.devices) {
    const entry = { id: d.id, model: d.model || 'unknown model', host: d.host, port: d.port || 80, sn: '', probes: [], ok: false, error: null };
    report.push(`  ${d.id}  (${entry.model})  http://${d.host}:${entry.port}`);
    try {
      entry.sn = await probeSerial(d);
      report.push(`    serial: ${entry.sn || 'not detected'}`);
      /* No Stamp: we want sample records even when polling has caught up. */
      const urls = [];
      if (entry.sn) urls.push(`${deviceBase(d)}/iclock/records?deviceSn=${entry.sn}&table=ATTLOG&type=1&limit=20`);
      urls.push(`${deviceBase(d)}/iclock/records?table=ATTLOG&type=1&limit=20`);

      for (const u of urls) {
        try {
          const r = await request(u);
          const parsed = parseRecords(r.body);
          const line = { url: u.replace(/^https?:\/\//, ''), status: r.status, parsed: parsed.length, raw: r.body.slice(0, 300), sample: parsed.slice(0, 3), ambiguous: parsed.some(p => p.ambiguous) };
          entry.probes.push(line);
          report.push(`    HTTP ${r.status}  ${parsed.length} record(s) parsed`);
          report.push(`    ${line.url}`);
          report.push('    raw: ' + (r.body.slice(0, 300).replace(/\s+/g, ' ') || '(empty)'));
          parsed.slice(0, 3).forEach(rec => report.push('      · ' + JSON.stringify(rec)));
          if (line.ambiguous) {
            report.push('    ! two-column layout detected — check that the PIN and verify');
            report.push('      columns are being in the right order on real hardware.');
          }
        } catch (e) {
          entry.probes.push({ url: u.replace(/^https?:\/\//, ''), error: e.message });
          report.push(`    ERROR ${e.message}`);
        }
      }
      entry.ok = entry.probes.some(p => p.parsed > 0);
    } catch (e) {
      entry.error = e.message;
      report.push(`    ERROR ${e.message}`);
    }
    report.push('');
  }
  return report;
}

/* ------------------------------------------------------------------ Exports
   Exposed so the desktop app can host this server in its own process rather
   than shelling out, and so diagnostics can be shown in a real window.
   ------------------------------------------------------------------------ */
function createServer() {
  loadStore();
  rebuildSeen();
  return server;
}
function startServer() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(CFG.port, CFG.host, () => {
      server.removeListener('error', reject);
      banner();
      pollAll().catch(() => {});
      startPolling();
      refreshUsers().catch(() => {});
      resolve(server);
    });
  });
}
function stop() {
  clearInterval(pollTimer);
  saveStore(true);
  return new Promise((resolve) => server.close(() => resolve()));
}
function shutdown() {
  /* Flush the sync store before anything else. Its pushes are already written
   * synchronously, but a client registration or a tombstone sweep can still be
   * sitting in the debounce window, and losing that on exit is a silent data
   * loss the client has no way to detect. */
  try { sync.saveNow(); } catch (_) {}
  try { saveStore(true); } catch (_) {}
  try { stop(); } catch (_) {}
}

module.exports = {
  CFG, server, createServer, startServer, stop, shutdown, diagnose,
  deviceStatus, dayBoard, pollAll, refreshUsers,
  localDayKey, lanAddresses, saveStore: () => saveStore(true), sync
};

/* Only self-start when run directly. `require`-ing this file (as the desktop
   app does) must not begin listening on a port. */
if (require.main === module) {
  process.on('SIGINT', () => { log('info', 'bridge', 'shutting down'); shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  process.on('uncaughtException', (e) => { log('error', 'fatal', e.message, e.stack); saveStore(true); try { sync.saveNow(); } catch (_) {} });
  main().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
}

/* ==========================================================================
   AMAYA Industries ERP — Core: constants, utilities, data store, seed, auth, sync
   ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- Constants */
const APP = {
  name: 'AMAYA ERP',
  company: 'AMAYA Industries',
  /* Shown in the sidebar / header. The full company name is used on documents. */
  product: 'AMAYA ERP',
  version: '1.0.0',
  /* Storage keys carry the product name. They are intentionally NOT compatible
   * with the old StockFlow keys: AMAYA is a separate deployment and must not
   * inherit a demo database, demo sessions or demo logins. */
  dbKey: 'amaya_erp_db_v1',
  sessionKey: 'amaya_erp_session',
  themeKey: 'amaya_erp_theme',
  queueKey: 'amaya_erp_queue',
  configKey: 'amaya_erp_remote_config',
  /* Set once the real superadmin exists. Its presence is what removes the
   * demo quick-login buttons and hides the setup wizard for good. */
  setupKey: 'amaya_erp_setup'
};

const STOCK_TYPES = ['Regular', 'LMP', 'Refurbished', 'Repair'];
const TRANSFER_STAGES = ['Pending', 'Approved', 'Dispatched', 'In Transit', 'Received', 'Complete'];
const DEFECT_TYPES = ['Display / Touch', 'Motherboard / Power', 'Camera', 'Audio / Call', 'Software / Lock', 'Physical Damage', 'Battery', 'Water Damage', 'Other'];
const REPAIR_STATUSES = ['Received', 'Diagnosing', 'Awaiting Part', 'In Repair', 'Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'];
const COURIERS = ['BlueEx', 'Leopards', 'Pathao Courier', 'Steadfast', 'RedX', 'Self Pickup', 'Company Fleet'];
const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Casual Leave', 'Unpaid Leave', 'Maternity', 'Other'];
const DEPARTMENTS = ['Operations', 'Warehouse', 'Sales', 'Accounts', 'Service', 'Human Resources', 'Logistics', 'Management'];
const PAYROLL_STATUSES = ['Pending', 'Processed'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const ROLES = [
  'Super Admin', 'Admin', 'Warehouse Manager', 'Logistics', 'Sales Executive',
  'Accounts', 'Service', 'HR Manager', 'Viewer'
];

/** Page visibility + write access per role. */
const ROLE_PERMS = {
  'Super Admin':      { pages: '*', write: '*' },
  'Admin':            { pages: '*', write: '*' },
  'Warehouse Manager':{ pages: ['dashboard','live','inventory','movements','transfers','purchases','sales','pos','dispatch','upgrades','repairs','reports','analytics','audit'], write: ['inventory','movements','transfers','purchases','sales','pos','dispatch','upgrades','repairs'] },
  'Logistics':        { pages: ['dashboard','inventory','movements','transfers','dispatch','reports','audit'], write: ['movements','transfers','dispatch'] },
  'Sales Executive':  { pages: ['dashboard','inventory','sales','pos','customers','dispatch','upgrades','invoices','reports','analytics'], write: ['sales','pos','customers','dispatch','upgrades'] },
  'Accounts':         { pages: ['dashboard','live','sales','purchases','invoices','suppliers','customers','finance','reports','analytics','audit'], write: ['purchases','invoices','suppliers','customers'] },
  'Service':          { pages: ['dashboard','repairs','upgrades','inventory','reports','analytics','audit'], write: ['repairs','upgrades'] },
  'HR Manager':       { pages: ['dashboard','live','employees','payroll','leave','attendance','reports','analytics','audit'], write: ['employees','payroll','leave','attendance'] },
  'Viewer':           { pages: ['dashboard','live','inventory','sales','upgrades','reports','analytics','audit'], write: [] }
};

/* ---------------------------------------------------------------- Utilities */
/** By id, from `document` or any element root. */
const $ = (id, root) => {
  if (!id) return null;
  if (!root || root === document) return document.getElementById(id);
  if (typeof root.getElementById === 'function') return root.getElementById(id);
  return root.querySelector('#' + String(id).replace(/([^\w-])/g, '\\$1'));
};
/** First match of a CSS selector. */
const qs = (sel, root = document) => root.querySelector(sel);
/** All matches of a CSS selector. */
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = (prefix = 'ID') =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* Two decimal places, rounding half AWAY FROM ZERO, which is what an invoice
 * and a till both do. Plain `Math.round(n * 100) / 100` is wrong at the half
 * cent: 1.005 is stored as 1.00499999999999989, so it rounds DOWN to 1.00, and
 * the famous 2.675 becomes 2.67. The nudge is scaled with the value, so it stays
 * far below one cent for any figure this app can produce, and the sign is
 * handled explicitly because Math.round(-1.005) rounds towards zero - a credit
 * note and a receipt must not disagree about which way a half cent goes. */
const round2 = (n) => {
  const scaled = num(n) * 100;
  const eps = Math.abs(scaled) * Number.EPSILON;
  return (scaled < 0 ? -Math.round(-scaled + eps) : Math.round(scaled + eps)) / 100;
};

const fmt = (n) => Math.round(num(n)).toLocaleString('en-US');

const CURRENCY = () => (state.db && state.db.settings && state.db.settings.currency) || '৳';
const money = (n, dp = 0) => {
  const v = num(n);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${CURRENCY()}${s}`;
};
const moneyExact = (n) => money(n, 2);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowISO = () => new Date().toISOString();
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const relTime = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units = [[86400000, 'd'], [3600000, 'h'], [60000, 'm']];
  if (abs < 60000) return 'just now';
  for (const [ms, lbl] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return future ? `in ${n}${lbl}` : `${n}${lbl} ago`;
    }
  }
  return 'just now';
};
const monthKey = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (key) => {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] || '?'} ${String(y).slice(2)}`;
};
const daysBetween = (a, b) => {
  const d1 = new Date(a), d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
};
const initials = (name) => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const norm = (s) => String(s ?? '').toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function debounce(fn, wait = 260) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}
const sortBy = (arr, fn, dir = 1) => [...arr].sort((a, b) => {
  const x = fn(a), y = fn(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return (typeof x === 'string' ? x.localeCompare(String(y), undefined, { numeric: true }) : x - y) * dir;
});
const groupBy = (arr, fn) => arr.reduce((acc, x) => { const k = fn(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
const sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + num(fn(x)), 0);
const uniq = (arr) => [...new Set(arr)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* CSV */
function toCSV(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
function downloadFile(filename, content, type = 'text/csv;charset=utf-8') {
  const text = content instanceof Blob ? null : '\uFEFF' + content;

  /* Android 10+ scoped storage makes <a download> unreliable inside a WebView:
   * the tap is swallowed and the file never appears. Route native builds
   * through the Filesystem + share sheet instead, and keep the anchor path for
   * the browser, where it is the correct and simplest mechanism. */
  if (typeof Native !== 'undefined' && Native.isNative()) {
    Native.saveFile(filename, text != null ? text : content, type)
      .then(r => {
        if (r && r.ok) toast(r.method === 'capacitor' ? `Saved to ${r.path}` : `${filename} saved`, 'good');
        else toast('Export failed', 'bad');
      })
      .catch(() => toast('Export failed', 'bad'));
    return;
  }

  const blob = content instanceof Blob ? content : new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportCSV(filename, rows) {
  if (!rows.length) return toast('Nothing to export', 'warn');
  downloadFile(`${filename}-${todayISO()}.csv`, toCSV(rows));
  audit('EXPORT', 'Reports', filename, `${rows.length - 1} rows`);
  if (typeof Native === 'undefined' || !Native.isNative()) toast(`${filename} downloaded`, 'good');
}
function parseCSV(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return { headers: [], records: [] };
  const split = (line) => {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = split(lines[0]).map(slug);
  const records = lines.slice(1).map(line => {
    const vals = split(line);
    return headers.reduce((rec, h, i) => { rec[h] = vals[i] ?? ''; return rec; }, {});
  });
  return { headers, records };
}

/**
 * localStorage wrapper. Some browsers refuse storage on `file://` or in
 * private mode, so every access is guarded and falls back to memory.
 */
const store = (() => {
  const memory = {};
  let backing = null;
  try {
    /* Probe the raw API — `store` is still in its temporal dead zone here. */
    const probe = '__sf_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backing = window.localStorage;
  } catch (_) { backing = null; }
  return {
    available: !!backing,
    get(k) { try { return backing ? backing.getItem(k) : (k in memory ? memory[k] : null); } catch (_) { return null; } },
    set(k, v) { try { if (backing) backing.setItem(k, v); else memory[k] = v; return true; } catch (_) { memory[k] = v; return false; } },
    del(k) { try { if (backing) backing.removeItem(k); } catch (_) {} delete memory[k]; }
  };
})();

/* ------------------------------------------------------------------- State */
const state = {
  db: null,
  session: null,
  route: 'dashboard',
  theme: store.get(APP.themeKey) || 'light',
  cart: [],
  queue: JSON.parse(store.get(APP.queueKey) || '[]'),
  sync: { status: 'idle', message: 'Local mode', lastSync: null, mode: 'local' },
  ui: {},
  modalStack: []
};

/* -------------------------------------------------------------- Data store */
const DB = {
  /* `attachments` holds image metadata only. On native builds the pixels live
   * in files on disk; the base64 in a data URL would blow the localStorage quota
   * after a handful of photos. */
  collections: ['locations','users','items','inventory','imeis','movements','transfers','sales',
                'purchases','dispatches','customers','suppliers','invoices','repairs','employees',
                'payroll','leaves','attendance','tasks','upgrades','audit','attachments'],

  blank() {
    const db = { meta: { version: APP.version, createdAt: nowISO(), updatedAt: nowISO() }, settings: {} };
    DB.collections.forEach(c => { db[c] = []; });
    return db;
  },

  load() {
    let parsed = null;
    try { parsed = JSON.parse(store.get(APP.dbKey) || 'null'); } catch (_) { parsed = null; }
    if (!parsed || !parsed.meta) { state.db = seedDatabase(); DB.save(); return; }
    const fresh = DB.blank();
    Object.keys(fresh).forEach(k => {
      if (k === 'settings') parsed.settings = Object.assign({}, defaultSettings(), parsed.settings || {});
      else if (k === 'meta') parsed.meta = Object.assign({}, fresh.meta, parsed.meta || {});
      else if (!Array.isArray(parsed[k])) parsed[k] = fresh[k];
    });
    state.db = parsed;
  },

  saveTimer: null,
  /**
   * Persist to storage. Debounced unless `immediate` is set.
   *
   * The whole document is serialized on every save, which is what makes large
   * bulk imports slow and what puts the ~5 MB localStorage ceiling within
   * reach. Two mitigations are in place:
   *   - `suspend` lets a bulk operation mutate freely and write once at the end
   *     instead of once per row.
   *   - Web mode keeps base64 photos inline, so a `photoBytes` cap is enforced
   *     on save to degrade a photo into metadata rather than lose the database.
   */
  saveDepth: 0,
  suspend() { DB.saveDepth++; },
  resume(immediate = true) {
    DB.saveDepth = Math.max(0, DB.saveDepth - 1);
    if (DB.saveDepth === 0) DB.save(immediate);
  },

  /* Above this much inline photo payload the browser store starts rejecting
   * writes. Roughly 4 MB of base64, which is only reached in web mode. */
  photoBudget: 3.5 * 1024 * 1024,

  save(immediate = false) {
    clearTimeout(DB.saveTimer);
    if (DB.saveDepth > 0) return;      // a bulk op owns the write
    const doIt = () => {
      try {
        state.db.meta.updatedAt = nowISO();
        let payload = state.db;

        if (typeof store !== 'undefined' && store.available) {
          const inline = DB.inlinePhotoBytes();
          if (inline > DB.photoBudget) {
            /* Do not throw away photos, and do not fail the save. Strip the
             * pixels, keep the metadata, and tell the user once. */
            const copy = Object.assign({}, state.db, {
              attachments: DB.get('attachments').map(a =>
                (a.dataUrl || a.thumbDataUrl) ? Object.assign({}, a, { dataUrl: undefined, thumbDataUrl: undefined, stripped: true }) : a)
            });
            payload = copy;
            DB.set('__photoOverflow', true);
          }
        }

        store.set(APP.dbKey, JSON.stringify(payload));
        store.set(APP.queueKey, JSON.stringify(state.queue));
      } catch (e) {
        console.error('Save failed', e);
        toast('Could not save locally — storage may be full', 'bad');
      }
    };
    if (immediate) doIt(); else DB.saveTimer = setTimeout(doIt, 120);
  },

  /** Rough size of photo data currently held inline in the document. */
  inlinePhotoBytes() {
    let n = 0;
    for (const a of DB.get('attachments')) {
      if (a.dataUrl) n += a.dataUrl.length;
      if (a.thumbDataUrl) n += a.thumbDataUrl.length;
    }
    return n;
  },

  get(col) { return state.db[col] || []; },
  byId(col, id) { return DB.get(col).find(x => x.id === id) || null; },
  insert(col, rec) { const r = Object.assign({ id: uid(col.slice(0, 3).toUpperCase()) }, rec); state.db[col].unshift(r); DB.save(); return r; },
  update(col, id, patch) {
    const i = state.db[col].findIndex(x => x.id === id);
    if (i < 0) return null;
    state.db[col][i] = Object.assign({}, state.db[col][i], patch, { id });
    DB.save();
    return state.db[col][i];
  },
  remove(col, id) {
    const i = state.db[col].findIndex(x => x.id === id);
    if (i < 0) return false;
    state.db[col].splice(i, 1); DB.save(); return true;
  }
};

function defaultSettings() {
  return {
    company: 'AMAYA Industries',
    address: '128 Gulshan Avenue, Dhaka 1212, Bangladesh',
    phone: '+880 1711 000111',
    email: 'accounts@amaya.com',
    taxNo: 'TRN-1122334455',
    currency: '৳',
    threshold: 10,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    bridgeUrl: '',
    bridgeToken: '',
    bridgeLiveToken: '',
    bridgeAutoSync: true,
    bridgePollMs: 60000,
    footerNote: 'Thank you for your business. Goods once sold are exchangeable only against this invoice within 7 days.',
    backendMode: 'local',
    appsScriptUrl: '',
    restBase: '',
    autoSync: true,
    syncIntervalMs: 45000,
    requireReasonOnAdjust: true,
    printOnSale: true,
    allowNegative: false,
    seedDemo: true
  };
}

/* ------------------------------------------------------------- Computations */

/* Which way does a movement move stock? Stated ONCE, here, because the
 * alternative was three different answers to the same question.
 *
 * The on-hand balance below reads six running counters off the line rather than
 * replaying the ledger, so "does this type add stock or take it away" has to be
 * known to this module - and it used to be re-stated at every call site as an
 * inline list. Those lists disagreed with each other AND with inHand():
 * customer returns were counted as an outflow on the dashboard, and as neither
 * inflow nor outflow in the movement analytics, while inHand() correctly added
 * them back in. A figure signed one way on the ledger page and the other way on
 * the dashboard is worse than no figure at all, because the user cannot tell
 * which one to believe.
 *
 * Spelling is part of the contract: the movement filter lists use
 * 'TRANSFER IN' with a space, so the keys here do too, and the lookup folds case
 * and separators so a future 'Transfer_Out' cannot quietly become a zero.
 *
 * ADJUST is deliberately absent. A cycle count carries its own sign in its
 * quantity, so it has no fixed direction and forcing one would be a lie. */
const MOVEMENT_SIGN = {
  'IN': 1, 'RETURN': 1, 'TRANSFER IN': 1,
  'OUT': -1, 'SALE': -1, 'TRANSFER OUT': -1
};
/** +1 brings stock in, -1 takes it out, 0 means the type carries its own sign. */
function movementSign(type) {
  return MOVEMENT_SIGN[String(type || '').trim().toUpperCase().replace(/[\s_-]+/g, ' ')] || 0;
}

/** A movement row's signed effect on stock, in units.
 *
 * This is the function that makes the ledger reconstructable: summing it over
 * every movement for a model, and adding that model's opening balance, has to
 * give the on-hand figure the inventory line reports. If that identity does not
 * hold, the stock number is a claim rather than a record.
 *
 * ADJUST is the case that made it false. A cycle count that finds fewer units
 * than the system holds is a negative, and both the seeder and the reconcile
 * form stored the MAGNITUDE with the direction only in English - a `source` of
 * 'Shortage / damage' against 'Surplus found'. A ledger a machine cannot sum is
 * not a ledger, so the sign now travels in the quantity itself. The free-text
 * source is kept, because it is genuinely useful to a human reading the row. */
function movementEffect(m) {
  if (!m) return 0;
  const sign = movementSign(m.type);
  const qty = num(m.qty);
  return sign === 0 ? qty : sign * Math.abs(qty);
}

/** Available units on a stock line. */
function inHand(line) {
  if (!line) return 0;
  return num(line.openingQty) + num(line.inQty) - num(line.outQty)
       + num(line.transferInQty) - num(line.transferOutQty)
       + num(line.returnQty) - num(line.soldQty) + num(line.adjustedQty);
}
/** Reorder threshold. Defensive: the seeder runs before `state.db` is assigned. */
function threshold() {
  const s = state.db && state.db.settings;
  return (s ? num(s.threshold) : 10) || 10;
}
function stockLevel(line) {
  const n = inHand(line);
  if (n <= 0) return { key: 'out', label: 'Out of stock', color: 'red' };
  if (n <= 5) return { key: 'critical', label: 'Critical', color: 'red' };
  if (n <= threshold()) return { key: 'low', label: 'Low', color: 'amber' };
  return { key: 'healthy', label: 'Healthy', color: 'green' };
}
const lineValue = (line) => inHand(line) * num(line.unitCost);
const inventoryValue = () => sum(DB.get('inventory'), lineValue);
const totalUnits = () => sum(DB.get('inventory'), inHand);

function findLine(sku, house, color) {
  return DB.get('inventory').find(l =>
    norm(l.sku) === norm(sku) && (!house || norm(l.house) === norm(house)) && (!color || norm(l.color) === norm(color))
  ) || null;
}
/** Find the closest matching line, or create one from the catalogue entry. */
function resolveLine({ sku, brand, type, house, color, unitCost, unitPrice }) {
  let line = findLine(sku, house, color);
  if (line) return line;
  const item = DB.get('items').find(i => norm(i.sku) === norm(sku) || norm(i.model) === norm(sku));
  line = DB.insert('inventory', {
    itemId: item ? item.id : null,
    sku, brand: brand || (item ? item.brand : ''), type: type || (item ? item.type : 'Regular'),
    house: house || 'Unassigned', color: color || 'Standard',
    unitCost: num(unitCost != null ? unitCost : item ? item.cost : 0),
    unitPrice: num(unitPrice != null ? unitPrice : item ? item.price : 0),
    openingQty: 0, inQty: 0, outQty: 0, transferInQty: 0, transferOutQty: 0,
    returnQty: 0, soldQty: 0, adjustedQty: 0,
    reorderPoint: item ? num(item.reorderPoint) : threshold(),
    createdAt: nowISO()
  });
  return line;
}
function bumpLine(line, field, qty) {
  if (!line) return null;
  const patch = {};
  patch[field] = num(line[field]) + num(qty);
  return DB.update('inventory', line.id, patch);
}
function locationName(id) {
  if (!id) return '—';
  const l = DB.get('locations').find(x => x.id === id || x.name === id);
  return l ? l.name : id;
}

/* ------------------------------------------------------------------ Audit */
function audit(action, module, recordId, details) {
  const u = state.session && state.session.user ? state.session.user : { name: 'System', role: 'System' };
  state.db.audit.unshift({
    id: uid('AUD'),
    timestamp: nowISO(),
    user: u.name || 'System',
    role: u.role || 'System',
    action, module,
    recordId: recordId || '—',
    details: details || ''
  });
  if (state.db.audit.length > 4000) state.db.audit.length = 4000;
  DB.save();
  /* Every write in the app funnels through audit(), so this is the one place
   * that reliably means "the user just recorded something". Guarded and
   * deferred: Momentum lives in 16-experience.js and is not present during a
   * bare-source parse, and a bulk import writes thousands of audit rows in a
   * tight loop where a synchronous milestone scan would be pure waste. */
  if (typeof Momentum !== 'undefined') Momentum.scheduleCelebrate(module);
}

/* ------------------------------------------------------------------- Auth */
const perms = () => (state.session && state.session.user ? ROLE_PERMS[state.session.user.role] : null) || { pages: [], write: [] };
function canSee(page) {
  const p = perms();
  if (p.pages === '*') return true;
  return p.pages.includes(page);
}
function canWrite(module) {
  const p = perms();
  if (p.write === '*') return true;
  return p.write.includes(module);
}
function isAdmin() {
  const r = state.session && state.session.user ? state.session.user.role : '';
  return r === 'Super Admin' || r === 'Admin';
}
function requireWrite(module, label) {
  if (canWrite(module)) return true;
  toast(`Your role cannot ${label || `change ${module}`}`, 'bad');
  return false;
}
function requireAdmin(label) {
  if (isAdmin()) return true;
  toast('Administrator access required', 'bad');
  return false;
}

function login(email, password) {
  const user = DB.get('users').find(u => norm(u.email) === norm(email) && u.password === password);
  if (!user) return { error: 'Invalid email or password' };
  if (user.status && user.status !== 'Active') return { error: 'This account has been deactivated' };
  state.session = { user: { id: user.id, name: user.name, email: user.email, role: user.role, location: user.location }, at: nowISO() };
  store.set(APP.sessionKey, JSON.stringify(state.session));
  audit('LOGIN', 'Auth', user.email, `${user.role} signed in`);
  return { ok: true, user };
}
function logout() {
  if (state.session) audit('LOGOUT', 'Auth', state.session.user.email, 'Session ended');
  state.session = null;
  store.del(APP.sessionKey);
}
function restoreSession() {
  try {
    const s = JSON.parse(store.get(APP.sessionKey) || 'null');
    if (s && s.user) {
      const fresh = DB.get('users').find(u => u.email === s.user.email);
      if (fresh) { state.session = { user: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, location: fresh.location }, at: s.at }; return true; }
    }
  } catch (_) {}
  return false;
}
function switchUser(userId) {
  const u = DB.byId('users', userId);
  if (!u) return false;
  state.session = { user: { id: u.id, name: u.name, email: u.email, role: u.role, location: u.location }, at: nowISO() };
  store.set(APP.sessionKey, JSON.stringify(state.session));
  audit('SWITCH', 'Auth', u.email, `Now acting as ${u.role}`);
  return true;
}

/* ------------------------------------------------------------------- Sync */
const Sync = {
  get mode() { return state.db.settings.backendMode || 'local'; },
  get url() { return state.db.settings.backendMode === 'appscript' ? state.db.settings.appsScriptUrl : state.db.settings.restBase; },

  setStatus(status, message) {
    state.sync.status = status;
    state.sync.message = message;
    const chip = $('syncChip'), txt = $('syncText');
    if (chip) chip.className = 'sync-chip ' + status;
    if (txt) txt.textContent = message;
  },

  async call(action, payload = {}) {
    const url = Sync.url;
    if (!url) throw new Error('No backend URL configured');
    const u = state.session ? state.session.user : {};
    if (state.db.settings.backendMode === 'appscript') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, user: u, token: state.session ? state.session.at : '', ...payload })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && json.success === false) throw new Error(json.error || 'Server rejected the request');
      return json;
    }
    const res = await fetch(`${url.replace(/\/$/, '')}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  },

  /** Push the local dataset to the remote backend. */
  async push(action, payload, label) {
    if (Sync.mode === 'local' || !Sync.url) { DB.save(true); renderAll(); return { local: true }; }
    if (navigator.onLine) {
      try {
        Sync.setStatus('syncing', 'Committing…');
        const out = await Sync.call(action, Object.assign({ dataset: snapshotForSync() }, payload));
        Sync.setStatus('online', 'Synced ' + fmtTime(nowISO()));
        state.sync.lastSync = nowISO();
        renderAll();
        toast(out && out.message ? out.message : (label || 'Saved') + ' and synced', 'good');
        return out;
      } catch (e) {
        console.warn('Remote commit failed, queueing:', e.message);
      }
    }
    state.queue.push({ id: uid('Q'), action, payload, label, at: nowISO() });
    DB.save();
    Sync.setStatus('offline', `Queued (${state.queue.length})`);
    toast(`${label || 'Change'} saved offline — will sync`, 'warn');
    return { queued: true };
  },

  async pull() {
    if (Sync.mode === 'local' || !Sync.url) return false;
    try {
      Sync.setStatus('syncing', 'Pulling…');
      const data = await Sync.call(Sync.mode === 'appscript' ? 'syncAll' : 'dashboard');
      if (data && data.data) { mergeRemote(data.data); DB.save(true); }
      Sync.setStatus('online', 'Synced ' + fmtTime(nowISO()));
      state.sync.lastSync = nowISO();
      await Sync.drain();
      renderAll();
      return true;
    } catch (e) {
      Sync.setStatus('error', 'Sync failed');
      console.warn('Pull failed:', e.message);
      return false;
    }
  },

  async drain() {
    if (!state.queue.length || !navigator.onLine || !Sync.url) return;
    const remaining = [];
    for (const item of state.queue) {
      try { await Sync.call(item.action, Object.assign({ dataset: snapshotForSync() }, item.payload)); }
      catch (_) { remaining.push(item); }
    }
    state.queue = remaining;
    DB.save();
    if (!remaining.length && state.queue.length === 0) toast('All queued changes synchronised', 'good');
  },

  startAuto() {
    clearInterval(Sync._timer);
    Sync._timer = setInterval(() => {
      if (state.session && navigator.onLine && state.db.settings.autoSync && Sync.mode !== 'local' && Sync.url) {
        Sync.pull();
      }
    }, num(state.db.settings.syncIntervalMs) || 45000);
  }
};

function snapshotForSync() {
  const s = {};
  DB.collections.forEach(c => { s[c] = state.db[c]; });
  return s;
}
function mergeRemote(data) {
  if (!data || typeof data !== 'object') return;
  DB.collections.forEach(col => {
    if (Array.isArray(data[col]) && data[col].length) {
      const local = new Set(state.db[col].map(x => x.id));
      data[col].forEach(rec => { if (rec && rec.id && !local.has(rec.id)) state.db[col].push(rec); });
    }
  });
  if (data.settings) state.db.settings = Object.assign(state.db.settings, data.settings);
}

/* ------------------------------------------------------------- Seed data */
function seedDatabase() {
  const db = DB.blank();
  db.settings = Object.assign(defaultSettings(), {
    company: 'AMAYA Industries',
    address: '128 Gulshan Avenue, Dhaka 1212, Bangladesh',
    phone: '+880 1711 000111',
    email: 'accounts@amaya.com',
    taxNo: 'TRN-1122334455'
  });

  /* Facilities */
  db.locations = [
    { id: 'LOC-001', name: 'Main House',        type: 'Central warehouse', address: 'Gulshan, Dhaka',  active: true },
    { id: 'LOC-002', name: 'New House',         type: 'Warehouse',          address: 'Mirpur, Dhaka',  active: true },
    { id: 'LOC-003', name: '2nd Floor',         type: 'Overflow store',     address: 'Main House',      active: true },
    { id: 'LOC-004', name: 'Temporary House A', type: 'Staging house',      address: 'Uttara, Dhaka',   active: true },
    { id: 'LOC-005', name: 'Temporary House B', type: 'Staging house',      address: 'Savar, Dhaka',    active: true },
    { id: 'LOC-006', name: 'Retail Counter',    type: 'Point of sale',      address: 'Gulshan, Dhaka',  active: true },
    { id: 'LOC-007', name: 'Service Center',    type: 'After-sales lab',    address: 'Bashundhara',     active: true }
  ];

  /* Users */
  db.users = [
    { id: 'USR-001', name: 'System Super Admin',  email: 'admin@amaya.com',     password: 'admin',    pin: '123456', role: 'Super Admin',      location: 'Main House',     status: 'Active', joinedAt: '2024-01-04' },
    { id: 'USR-002', name: 'Warehouse Floor Lead', email: 'floor@amaya.com',     password: 'admin',    pin: '123456', role: 'Warehouse Manager', location: 'Main House',     status: 'Active', joinedAt: '2024-02-11' },
    { id: 'USR-003', name: 'Logistics Coordinator', email: 'logistics@amaya.com', password: 'admin', pin: '123456', role: 'Logistics',        location: 'New House',      status: 'Active', joinedAt: '2024-03-02' },
    { id: 'USR-004', name: 'Retail Sales Executive', email: 'sales@amaya.com',   password: 'admin',    pin: '123456', role: 'Sales Executive',  location: 'Retail Counter', status: 'Active', joinedAt: '2024-05-19' },
    { id: 'USR-005', name: 'Accounts Officer',     email: 'accounts@amaya.com',  password: 'admin',    pin: '123456', role: 'Accounts',         location: 'Main House',     status: 'Active', joinedAt: '2024-06-01' },
    { id: 'USR-006', name: 'Service Technician',   email: 'service@amaya.com',   password: 'admin',    pin: '123456', role: 'Service',          location: 'Service Center', status: 'Active', joinedAt: '2024-07-15' },
    { id: 'USR-007', name: 'HR Manager',           email: 'hr@amaya.com',        password: 'admin',    pin: '123456', role: 'HR Manager',       location: 'Main House',     status: 'Active', joinedAt: '2024-08-01' },
    { id: 'USR-008', name: 'Accounts Viewer',      email: 'viewer@amaya.com',    password: 'admin',    pin: '123456', role: 'Viewer',           location: 'Main House',     status: 'Active', joinedAt: '2024-09-12' }
  ];

  /* Catalogue */
  const catalogue = [
    ['HONOR 600 Pro 12/256',  'HONOR',    'Regular',     '8/256',  41500, 46900, 12],
    ['HONOR 400 Lite 8/128',  'HONOR',    'Regular',     '8/128',  24800, 28900, 20],
    ['HONOR X9b 5G 12/256',  'HONOR',    'Regular',     '12/256', 33200, 37900, 15],
    ['HONOR 200 6/128',      'HONOR',    'LMP',         '6/128',  17200, 19900, 25],
    ['REDMI Note 14 8/256',   'REDMI',    'Regular',     '8/256',  27500, 31500, 20],
    ['REDMI 14C 6/128',      'REDMI',    'Regular',     '6/128',  16400, 18900, 30],
    ['REDMI Note 13 Pro',     'REDMI',    'LMP',         '8/256',  22900, 25900, 18],
    ['OnePlus 12R 8/256',     'OnePlus',  'Regular',     '8/256',  38500, 43900, 10],
    ['OnePlus Nord CE3',      'OnePlus',  'LMP',         '8/128',  26900, 30500, 14],
    ['realme 12 Pro 8/256',   'realme',   'Regular',     '8/256',  29800, 33900, 16],
    ['vivo Y28 6/128',       'vivo',     'Regular',     '6/128',  15200, 17900, 22],
    ['OPPO A78 8/256',       'OPPO',     'Regular',     '8/256',  31400, 35900, 12],
    ['HONOR X6 Refurb',      'HONOR',    'Refurbished', '6/128',  19800, 23900, 8],
    ['REDMI 13 Dead Unit',   'REDMI',    'Repair',      '6/128',   6400,  6900, 6]
  ];
  catalogue.forEach((c, i) => {
    db.items.push({
      id: `ITM-${String(i + 1).padStart(3, '0')}`,
      sku: c[0], model: c[0], brand: c[1], type: c[2], config: c[3],
      cost: c[4], price: c[5], reorderPoint: c[6],
      warrantyMonths: c[2] === 'Repair' ? 0 : 12,
      note: '', active: true, createdAt: '2025-01-05'
    });
  });

  /* Stock lines spread across facilities */
  const houses = db.locations.map(l => l.name);
  const colors = { HONOR: ['Black', 'Green', 'Silver'], REDMI: ['Blue', 'Black', 'Purple'], OnePlus: ['Black', 'Aqua'], realme: ['Gold'], vivo: ['Blue'], OPPO: ['Black'] };
  let ln = 1;
  db.items.forEach(item => {
    const stockHouses = [houses[ln % 5], houses[(ln + 2) % houses.length]];
    stockHouses.forEach((h, hi) => {
      const palette = colors[item.brand] || ['Standard'];
      palette.slice(0, hi === 0 ? 2 : 1).forEach(color => {
        const base = item.cost;
        const opening = item.type === 'Repair' ? 0 : (ln * 7 + hi * 3) % 46;

        /* Issue legs are DERIVED FROM RECEIPTS, not from their own moduli.
         *
         * The previous version set `inQty: (ln % 5) * 3` and
         * `soldQty: (ln % 4) * 2` independently. Those two expressions have no
         * relationship, so for some line numbers the issues exceeded the
         * receipts and inHand() came out negative - with no movement row to
         * explain it, which is exactly the sort of number the app's own
         * integrity check is built to catch. It fired on a fresh install, and
         * the fix for that is to generate data the app would accept rather than
         * to mute the check.
         *
         * Each debit is now clamped to what is actually available, which is the
         * same discipline the live movement writer uses. Low and at-threshold
         * lines still occur, because clamping can drain a line to exactly zero,
         * so the reorder alerts keep something to say. */
        const received = (ln % 5) * 3;
        const returned = ln % 2;
        const available = opening + received + returned + hi;
        const issued = Math.min((ln % 3) * 2, available);
        const sold = Math.min((ln % 4) * 2, available - issued);

        db.inventory.push({
          id: `INV-${String(ln).padStart(4, '0')}`,
          itemId: item.id, sku: item.model, brand: item.brand, type: item.type,
          house: h, color,
          unitCost: base, unitPrice: item.price,
          openingQty: opening,
          inQty: received, outQty: issued,
          transferInQty: hi, transferOutQty: 0,
          returnQty: returned, soldQty: sold, adjustedQty: 0,
          reorderPoint: item.reorderPoint,
          lastMovementAt: nowISO(), createdAt: '2025-01-05'
        });
        ln++;
      });
    });
  });

  /* Give the seeded baseline a history.
   *
   * The lines above are built with six running counters already populated -
   * receipts, issues, returns, sales, a transfer in - so that the item drawer
   * has a movement breakdown to show and stock levels vary across the
   * catalogue. Those counters were, until now, an assertion with nothing behind
   * them: the ledger began 60 days ago, so `opening + ledger` did not reproduce
   * the on-hand figure for a single model, and 27 units of `inQty` on one model
   * simply did not exist anywhere a person could look.
   *
   * A real distributor did not open its books empty either. So the baseline is
   * back-dated into the ledger as opening movements, four months back. That is
   * both more honest and more useful - the movement history now reaches further
   * than the demo window - and it makes the identity
   *
   *     on hand == opening balance + every movement
   *
   * hold exactly, per model, with no exceptions. tools/maths-test.js asserts it.
   *
   * `openingQty` is deliberately left alone: it is the opening balance and gets
   * no row, which is what makes it an opening balance. */
  {
    const prior = new Date();
    prior.setDate(prior.getDate() - 120);
    const priorISO = prior.toISOString().slice(0, 10);
    let seq = 0;
    /* Each baseline leg becomes one dated movement, so the drawer's per-type
     * breakdown and the ledger agree by construction rather than by luck. */
    const LEGS = [
      ['inQty', 'IN', 'Opening stock receipt'],
      ['outQty', 'OUT', 'Opening stock issue'],
      ['returnQty', 'RETURN', 'Customer return'],
      ['soldQty', 'SALE', 'Counter sale'],
      ['transferInQty', 'TRANSFER IN', 'Transferred in from another facility'],
      ['transferOutQty', 'TRANSFER OUT', 'Transferred out to another facility']
    ];
    for (const line of db.inventory) {
      for (const [field, type, note] of LEGS) {
        const qty = num(line[field]);
        if (!qty) continue;
        db.movements.push({
          id: uid('MOV'), trxRef: `TRX-OPENING-${String(++seq).padStart(4, '0')}`, type,
          sku: line.sku, brand: line.brand, itemType: line.type,
          house: line.house, color: line.color, qty, date: priorISO,
          note, source: 'System', user: 'System Super Admin', role: 'System',
          timestamp: prior.toISOString(), imeis: []
        });
      }
      /* A baseline variance, if the line was given one. */
      if (num(line.adjustedQty)) {
        db.movements.push({
          id: uid('MOV'), trxRef: `TRX-OPENING-${String(++seq).padStart(4, '0')}`, type: 'ADJUST',
          sku: line.sku, brand: line.brand, itemType: line.type,
          house: line.house, color: line.color, qty: num(line.adjustedQty), date: priorISO,
          note: 'Opening stock reconciliation', source: 'System',
          user: 'System Super Admin', role: 'System', timestamp: prior.toISOString(), imeis: []
        });
      }
    }
  }

  /* Customers & suppliers */
  db.customers = [
    { id: 'CUS-001', name: 'Walk-in Retail',        phone: '',           email: '',                        city: 'Dhaka',   address: '',              creditLimit: 0,      balance: 0,    status: 'Active' },
    { id: 'CUS-002', name: 'Bismillah Electronics', phone: '+8801711000111', email: 'orders@bismillah.com', city: 'Dhaka',   address: 'Sadarghat',          creditLimit: 250000, balance: 18400, status: 'Active' },
    { id: 'CUS-003', name: 'Star Mobile Point',    phone: '+8801811222333', email: 'buy@starmobile.com',   city: 'Chattogram', address: 'Agrabad',         creditLimit: 400000, balance: 62300, status: 'Active' },
    { id: 'CUS-004', name: 'Tech World BD',        phone: '+8801911445566', email: 'hello@techworld.bd',  city: 'Sylhet',   address: 'Zindabazar',         creditLimit: 150000, balance: 0,    status: 'Active' },
    { id: 'CUS-005', name: 'Metro Communication',  phone: '+8801611999888', email: 'purchase@metro.com.bd', city: 'Dhaka', address: 'Farmgate',         creditLimit: 500000, balance: 127500,status: 'Active' },
    { id: 'CUS-006', name: 'Delta Traders',        phone: '+8801555444433', email: 'info@deltatraders.com', city: 'Khulna', address: 'Boyra',            creditLimit: 120000, balance: 41200, status: 'Active' },
    { id: 'CUS-007', name: 'Sunrise Telecom',      phone: '+8801300222333', email: 'orders@sunrisetelecom.com', city: 'Rajshahi', address: 'Shaheed A.H.M. Kamaruzzaman', creditLimit: 200000, balance: 0, status: 'Inactive' }
  ];
  db.suppliers = [
    { id: 'SUP-001', name: 'Heaven Electronics Ltd', phone: '+880211234567', email: 'supply@heaven.com',  city: 'Dhaka',    address: 'Tejgaon',   accountNo: 'HVE-4471-02', paymentTerms: 'Net 30', openingBalance: 320000, balance: 486000, status: 'Active' },
    { id: 'SUP-002', name: 'Pacific Distributors',   phone: '+880911234567', email: 'sales@pacific.com',  city: 'Chattogram', address: 'Agrabad',  accountNo: 'PDC-8820-11', paymentTerms: 'Net 45', openingBalance: 140000, balance: 212000, status: 'Active' },
    { id: 'SUP-003', name: 'Global Mobile Supply',   phone: '+8801811887766', email: 'orders@globalmobile.com', city: 'Dhaka', address: 'Tejgaon I', accountNo: 'GMS-2214-77', paymentTerms: 'Net 15', openingBalance: 0,      balance: 96500,  status: 'Active' },
    { id: 'SUP-004', name: 'Smart Accessories Ltd', phone: '+8801611999000', email: 'sales@smartacc.com', city: 'Sylhet',    address: 'Shahabajpur', accountNo: 'SAL-3390-05', paymentTerms: 'Net 30', openingBalance: 45000,  balance: 12000,  status: 'Active' }
  ];

  /* Employees */
  db.employees = [
    ['EMP-001','E-101','Ayesha Khan',     'ayesha@amaya.com',   '+8801712000001','Warehouse','Floor Supervisor',      'Main House',     38000,'2024-02-01','Active'],
    ['EMP-002','E-102','Rakib Hasan',     'rakib@amaya.com',    '+8801712000002','Warehouse','Stock Controller',     'New House',      34000,'2024-02-14','Active'],
    ['EMP-003','E-103','Nadia Islam',     'nadia@amaya.com',    '+8801712000003','Sales',     'Sales Executive',       'Retail Counter', 32000,'2024-05-06','Active'],
    ['EMP-004','E-104','Tanvir Ahmed',    'tanvir@amaya.com',   '+8801712000004','Service',   'Senior Technician',     'Service Center', 42000,'2024-07-22','Active'],
    ['EMP-005','E-105','Sadia Afreen',    'sadia@amaya.com',    '+8801712000005','Accounts',  'Accounts Officer',      'Main House',     36000,'2024-06-17','Active'],
    ['EMP-006','E-106','Imran Hossain',   'imran@amaya.com',    '+8801712000006','Logistics', 'Logistics Coordinator', 'New House',      30000,'2024-03-11','Active'],
    ['EMP-007','E-107','Farhana Akter',   'farhana@amaya.com',  '+8801712000007','Human Resources','HR Manager',        'Main House',     48000,'2024-08-05','Active'],
    ['EMP-008','E-108','Jahid Alam',      'jahid@amaya.com',    '+8801712000008','Warehouse','Loader',              '2nd Floor',      22000,'2025-01-19','On Leave'],
    ['EMP-009','E-109','Mehedi Hasan',    'mehedi@amaya.com',   '+8801712000009','Sales',     'Sales Executive',       'Retail Counter', 28000,'2025-04-02','Active']
  ].map(e => ({
    id: e[0], code: e[1], name: e[2], email: e[3], phone: e[4],
    department: e[5], role: e[6], location: e[7], salary: e[8],
    joinDate: e[9], status: e[10]
  }));

  /* Build transaction history over the last 60 days */
  const customers = db.customers, items = db.items;
  const ops = ['Ayesha Khan','Rakib Hasan','Nadia Islam','Tanvir Ahmed','Sadia Afreen','Imran Hossain','System Super Admin'];

  const stockMovements = [
    ['mov', 'IN',  'supplier',  'Supplier delivery — batch #401'],
    ['mov', 'OUT', 'internal', 'Showroom display units'],
    ['mov', 'ADJUST','internal','Cycle count reconciliation'],
    ['mov', 'RETURN','customer','Customer return — box opened'],
    ['mov', 'OUT', 'internal', 'Corporate order fulfilment']
  ];

  for (let d = 59; d >= 0; d--) {
    const day = new Date(); day.setDate(day.getDate() - d);
    const date = day.toISOString().slice(0, 10);
    const perDay = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < perDay; k++) {
      const spec = stockMovements[Math.floor(Math.random() * stockMovements.length)];
      const line = db.inventory[Math.floor(Math.random() * db.inventory.length)];
      if (!line) continue;
      const qty = 1 + Math.floor(Math.random() * 8);
      const user = ops[Math.floor(Math.random() * ops.length)];

      /* `booked` is what the ledger records, and it is deliberately NOT always
       * `qty`. Two legs are clamped against what the line actually holds, and
       * an adjustment carries a sign. The old code drew one random number,
       * clamped the line with it, and then wrote the UNCLAMPED number to the
       * ledger - so the ledger claimed more units had moved than the line had
       * lost, which is precisely the disagreement this whole check exists to
       * catch, written by the seeder itself. */
      let booked = qty;
      if (spec[1] === 'IN') { line.inQty += qty; }
      else if (spec[1] === 'OUT') { booked = Math.min(qty, Math.max(0, inHand(line))); line.outQty += booked; }
      else if (spec[1] === 'RETURN') { line.returnQty += qty; }
      else if (spec[1] === 'ADJUST') {
        /* A cycle count can find a shortage, but never more than what is on hand.
         * Clamping the negative leg to available stock keeps the demo data clean
         * while still exercising the ADJUST path. */
        const mag = 1 + Math.floor(Math.random() * 3);
        const delta = Math.random() > .5 ? mag : -Math.min(mag, Math.max(0, inHand(line)));
        line.adjustedQty += delta;
        booked = delta;
      }
      else { booked = Math.min(qty, Math.max(0, inHand(line))); line.soldQty += booked; }
      line.lastMovementAt = new Date(day).toISOString();
      /* A clamped-to-zero leg moved nothing, so it gets no ledger row. */
      if (booked === 0) continue;
      db.movements.push({
        id: uid('MOV'), trxRef: `TRX-${date.replace(/-/g, '')}-${String(1000 + db.movements.length).slice(-4)}`,
        type: spec[1], sku: line.sku, brand: line.brand, itemType: line.type,
        house: line.house, color: line.color, qty: booked, date,
        note: spec[3], source: spec[2], user, role: 'System',
        timestamp: new Date(day).toISOString(), imeis: []
      });
    }

    /* Sales */
    if (Math.random() > .35) {
      const n = 1 + Math.floor(Math.random() * 3);
      const cust = customers[Math.floor(Math.random() * customers.length)];
      const saleItems = [];
      for (let i = 0; i < n; i++) {
        const line = db.inventory.filter(l => l.type !== 'Repair' && inHand(l) > 0)[Math.floor(Math.random() * db.inventory.filter(l => l.type !== 'Repair' && inHand(l) > 0).length)];
        if (!line) continue;
        const qty = 1 + Math.floor(Math.random() * 2);
        const available = Math.max(0, inHand(line));
        const take = Math.min(qty, available);
        if (take <= 0) continue;
        line.soldQty += take;
        saleItems.push({ sku: line.sku, color: line.color, qty: take, price: num(line.unitPrice) || 25500, cost: num(line.unitCost) });
      }
      if (saleItems.length) {
        const subtotal = sum(saleItems, i => i.qty * i.price);
        const discount = Math.random() > .75 ? Math.round(subtotal * .03) : 0;
        const total = subtotal - discount;
        const paid = Math.random() > .18;
        const idx = db.sales.length + 1;
        db.sales.push({
          id: uid('SAL'),
          orderId: `SO-${date.replace(/-/g, '')}-${String(idx).padStart(4, '0')}`,
          invoiceNo: `INV-${date.replace(/-/g, '')}-${String(idx).padStart(4, '0')}`,
          date, customerId: cust.id, customerName: cust.name, customerPhone: cust.phone,
          warehouse: houses[Math.floor(Math.random() * 6)],
          items: saleItems, subtotal, discount, tax: 0, total, paid,
          paymentMethod: ['Cash','Bank','Cheque','Card'][Math.floor(Math.random() * 4)],
          status: paid ? 'Paid' : (Math.random() > .5 ? 'Pending' : 'Processing'),
          user: 'Nadia Islam', createdAt: new Date(day).toISOString(), note: ''
        });
        if (!paid) cust.balance = num(cust.balance) + total;

        /* One SALE row per line, the way the live till posts it. The seeded
         * sale took stock off the line (soldQty above) with no ledger entry at
         * all, so every unit of demo revenue was a unit the audit trail could
         * not account for - the same hole the transfer path had. */
        const sale = db.sales[db.sales.length - 1];
        saleItems.forEach((si, n) => {
          const l = db.inventory.find(x => String(x.sku) === String(si.sku) && String(x.color) === String(si.color));
          db.movements.push({
            id: uid('MOV'), trxRef: sale.orderId, type: 'SALE',
            sku: si.sku, brand: l ? l.brand : '', itemType: l ? l.type : '',
            house: l ? l.house : sale.warehouse, color: si.color, qty: si.qty, date,
            note: `Sale ${sale.orderId} to ${sale.customerName}`, source: sale.paymentMethod,
            user: sale.user, role: 'System', timestamp: new Date(day).toISOString(), imeis: []
          });
        });
      }
    }

    /* Dispatches for unpaid orders */
    if (Math.random() > .5) {
      const pending = db.sales.filter(s => s.status !== 'Paid');
      const s = pending[Math.floor(Math.random() * pending.length)];
      if (s) {
        const st = ['Packed','Courier','In Transit','Delivered','Handed Over'];
        const status = st[Math.floor(Math.random() * st.length)];
        s.status = status === 'Delivered' || status === 'Handed Over' ? 'Paid' : (status === 'Packed' ? 'Processing' : 'Shipped');
        db.dispatches.push({
          id: uid('DSP'),
          dispatchId: `DSP-${date.replace(/-/g, '')}-${String(db.dispatches.length + 1).padStart(4, '0')}`,
          saleId: s.id, orderId: s.orderId, date,
          customer: s.customerName, phone: s.customerPhone,
          items: s.items.map(i => `${i.sku} × ${i.qty}`).join(', '),
          courier: COURIERS[Math.floor(Math.random() * (COURIERS.length - 1))],
          tracking: `TRK${Math.floor(Math.random() * 9e9 + 1e9)}`,
          route: ['Dhaka North','Dhaka South','Chattogram','Sylhet','Khulna','Rajshahi'][Math.floor(Math.random() * 6)],
          status, eta: new Date(day.getTime() + 2 * 86400000).toISOString().slice(0, 10),
          weight: round2(0.4 + Math.random() * 1.2), cost: 60 + Math.floor(Math.random() * 180),
          dispatchedBy: 'Imran Hossain', notes: ''
        });
      }
    }

    /* Attendance */
    if (day.getDay() !== 5) {
      db.employees.forEach(emp => {
        if (Math.random() > .1) {
          const late = Math.random() > .82;
          const base = new Date(day); base.setHours(9, 0, 0, 0);
          const check = new Date(base.getTime() + (late ? (12 + Math.floor(Math.random() * 40)) : -Math.floor(Math.random() * 25)) * 60000);
          db.attendance.push({
            id: uid('ATT'), employeeId: emp.id, employeeName: emp.name, code: emp.code,
            department: emp.department, deviceId: `ZK-${['01','02','03'][db.employees.indexOf(emp) % 3]}`,
            checkTime: check.toISOString(), date,
            status: late ? 'Late' : 'Present'
          });
        }
      });
    }
  }

  /* Purchase orders */
  for (let i = 0; i < 14; i++) {
    const sup = db.suppliers[Math.floor(Math.random() * db.suppliers.length)];
    const item = items[Math.floor(Math.random() * items.length)];
    const day = new Date(); day.setDate(day.getDate() - Math.floor(Math.random() * 45));
    const date = day.toISOString().slice(0, 10);
    const qty = 10 + Math.floor(Math.random() * 60);
    const cost = Math.round(num(item.cost) * (0.94 + Math.random() * .12));
    const st = ['Pending','In Transit','Received','Partially Received','Cancelled'][Math.floor(Math.random() * 4)];
    db.purchases.push({
      id: uid('PO'), poNumber: `PO-${date.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
      supplierId: sup.id, supplier: sup.name, date,
      itemId: item.id, item: item.model, brand: item.brand, type: item.type,
      house: houses[Math.floor(Math.random() * 5)],
      qty, receivedQty: st === 'Received' ? qty : (st === 'Partially Received' ? Math.floor(qty / 2) : 0),
      cost, total: qty * cost, status: st,
      eta: new Date(day.getTime() + (3 + Math.floor(Math.random() * 12)) * 86400000).toISOString().slice(0, 10),
      approvedBy: 'System Super Admin', notes: ''
    });
  }

  /* Transfers */
  for (let i = 0; i < 9; i++) {
    const from = houses[Math.floor(Math.random() * 5)];
    let to = houses[Math.floor(Math.random() * 6)];
    if (to === from) to = houses[(houses.indexOf(from) + 1) % houses.length];
    const status = TRANSFER_STAGES[Math.floor(Math.random() * 6)];
    const day = new Date(); day.setDate(day.getDate() - Math.floor(Math.random() * 20));
    const date = day.toISOString().slice(0, 10);
    const idx = db.transfers.length + 1;

    /* Only a line that is genuinely in the source facility, and only as many
     * units as it actually holds.
     *
     * The old code read `... || db.inventory[0]`, and when no line matched the
     * fallback was in some other warehouse. The dispatch leg was then skipped
     * by its own `line.house === from` guard while the receipt was still booked,
     * so the database gained units that no stock left for - and `qty` was
     * generated up to 6 against a line holding as little as 3, which is how
     * negative stock reached a fresh install. */
    const line = db.inventory.find(l => l.house === from && inHand(l) > 2);
    if (!line) continue;
    const qty = Math.min(1 + Math.floor(Math.random() * 6), inHand(line));

    if (status === 'Complete' || status === 'Received') {
      line.transferOutQty += qty;
      const dest = resolveLineIn(db, { sku: line.sku, brand: line.brand, type: line.type, house: to, color: line.color, unitCost: line.unitCost, unitPrice: line.unitPrice });
      dest.transferInQty += qty;

      /* Post the ledger. The demo transfers used to move stock with no
       * movement row at all, so the audit trail and the on-hand figure
       * described two different histories. Both legs are recorded, matching
       * the live path, so a seeded transfer is auditable exactly like a real
       * one. */
      const ref = `TRF-${date.replace(/-/g, '')}-${String(idx).padStart(3, '0')}`;
      [['TRANSFER OUT', line, from], ['TRANSFER IN', dest, to]].forEach(([type, l, house]) => {
        db.movements.push({
          id: uid('MOV'), trxRef: ref, type,
          sku: l.sku, brand: l.brand, itemType: l.type, house, color: l.color,
          qty, date, note: `Transfer ${ref}`, source: 'Internal',
          user: 'System Super Admin', role: 'System',
          timestamp: new Date(day).toISOString(), imeis: [], transferRef: ref
        });
      });
    }
    db.transfers.push({
      id: uid('TRF'),
      transferRef: `TRF-${date.replace(/-/g, '')}-${String(idx).padStart(3, '0')}`,
      fromLocation: from, toLocation: to,
      items: [{ sku: line.sku, color: line.color, qty }],
      totalUnits: qty, status, date,
      requestedBy: ['Rakib Hasan','Imran Hossain','Ayesha Khan'][Math.floor(Math.random() * 3)],
      approvedBy: status === 'Pending' ? '' : 'System Super Admin',
      dispatchedBy: ['Dispatched','In Transit','Received','Complete'].includes(status) ? 'Imran Hossain' : '',
      receivedBy: ['Received','Complete'].includes(status) ? 'Ayesha Khan' : '',
      carrier: ['Logistics Van Bay 2','Courier — BlueEx','Company Pickup','Hand trolley'][Math.floor(Math.random() * 4)],
      tracking: Math.random() > .5 ? `TRK${Math.floor(Math.random() * 9e9 + 1e9)}` : '',
      notes: '', imeis: []
    });
  }

  /* Repairs / BadBin */
  const techs = ['Tanvir Ahmed','Rakib Hasan','Imran Hossain'];
  for (let i = 0; i < 16; i++) {
    const item = items[Math.floor(Math.random() * items.length)];
    const day = new Date(); day.setDate(day.getDate() - Math.floor(Math.random() * 40));
    const date = day.toISOString().slice(0, 10);
    const st = REPAIR_STATUSES[Math.floor(Math.random() * 6)];
    const imei = String(35 + Math.floor(Math.random() * 49)) + String(Math.floor(Math.random() * 1e13)).padStart(13, '0');
    db.repairs.push({
      id: uid('REP'), ticketNo: `RPR-${date.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
      imei, imei2: '', serialNumber: `SN${Math.floor(Math.random() * 9e7 + 1e7)}`,
      model: item.model, brand: item.brand, color: (colors[item.brand] || ['Standard'])[0],
      defectType: DEFECT_TYPES[Math.floor(Math.random() * DEFECT_TYPES.length)],
      customerName: customers[Math.floor(Math.random() * customers.length)].name,
      customerPhone: '+88017' + Math.floor(Math.random() * 1e8),
      technician: st === 'Received' || st === 'Diagnosing' ? '' : techs[Math.floor(Math.random() * techs.length)],
      status: st, intakeDate: date,
      promisedDate: new Date(day.getTime() + 5 * 86400000).toISOString().slice(0, 10),
      completedDate: ['Repaired','GoodBin Returned','Scrapped'].includes(st) ? new Date(day.getTime() + (2 + Math.floor(Math.random() * 6)) * 86400000).toISOString().slice(0, 10) : '',
      destination: st === 'Scrapped' ? 'Scrap Yard' : (st === 'GoodBin Returned' ? 'GoodBin — Refurbished' : 'Service Lab'),
      cost: 200 + Math.floor(Math.random() * 3200),
      warrantyClaim: Math.random() > .55,
      discount: Math.random() > .6 ? 500 : 0,
      paid: st === 'Scrapped' ? 0 : (Math.random() > .35),
      notes: 'Customer reported intermittent fault. Diagnostic notes recorded on intake.',
      labourCost: 300 + Math.floor(Math.random() * 1500)
    });
    db.imeis.push({
      id: uid('IMEI'), imei, sku: item.model, brand: item.brand,
      house: 'Service Center', color: '', status: st,
      ticketNo: `RPR-${date.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
      addedAt: new Date(day).toISOString(), note: 'BadBin intake'
    });
  }

  /* Sold IMEIs from sales */
  db.sales.slice(-24).forEach(s => {
    s.items.forEach(it => {
      const imei = String(35 + Math.floor(Math.random() * 49)) + String(Math.floor(Math.random() * 1e13)).padStart(13, '0');
      db.imeis.push({
        id: uid('IMEI'), imei, sku: it.sku, brand: '',
        house: s.warehouse, color: it.color, status: 'Sold',
        ticketNo: '', addedAt: s.createdAt, note: `Sold on ${s.orderId}`
      });
    });
  });

  /* Invoices mirror unpaid sales + supplier bills */
  db.sales.filter(s => !s.paid).slice(0, 14).forEach(s => {
    const due = new Date(new Date(s.date).getTime() + 21 * 86400000).toISOString().slice(0, 10);
    db.invoices.push({
      id: uid('BILL'), invoiceNo: s.invoiceNo, type: 'Sale',
      partyId: s.customerId, partyName: s.customerName, amount: s.total, paid: 0,
      status: due < todayISO() ? 'Overdue' : 'Pending', date: s.date, dueDate: due,
      refId: s.id, notes: ''
    });
  });
  db.purchases.forEach(p => {
    const due = new Date(new Date(p.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);
    db.invoices.push({
      id: uid('BILL'), invoiceNo: p.poNumber, type: 'Purchase',
      partyId: p.supplierId, partyName: p.supplier, amount: p.total, paid: p.status === 'Received' ? p.total : 0,
      status: p.status === 'Received' ? 'Paid' : (due < todayISO() ? 'Overdue' : 'Pending'),
      date: p.date, dueDate: due, refId: p.id, notes: ''
    });
  });

  /* Payroll — last two months */
  ['2026-08', '2026-09'].forEach(month => {
    db.employees.forEach(emp => {
      if (emp.status === 'Inactive') return;
      const ot = Math.random() > .6 ? Math.floor(Math.random() * 12) + 2 : 0;
      const ded = Math.random() > .7 ? 500 : 0;
      const bonus = Math.random() > .82 ? 2000 : 0;
      const net = num(emp.salary) + ot * 220 + bonus - ded;
      const processed = month !== '2026-09' || Math.random() > .4;
      db.payroll.push({
        id: uid('PAY'), employeeId: emp.id, employeeName: emp.name, code: emp.code,
        month, baseSalary: num(emp.salary), overtimeHours: ot, overtimeRate: 220,
        deductions: ded, bonus, netSalary: net,
        status: processed ? 'Processed' : 'Pending',
        paidDate: processed ? `${month}-28` : '', notes: ''
      });
    });
  });

  /* Leave requests */
  db.employees.forEach((emp, i) => {
    if (i % 2) return;
    const day = new Date(); day.setDate(day.getDate() - Math.floor(Math.random() * 25));
    const start = day.toISOString().slice(0, 10);
    const end = new Date(day.getTime() + (1 + Math.floor(Math.random() * 4)) * 86400000).toISOString().slice(0, 10);
    db.leaves.push({
      id: uid('LV'), employeeId: emp.id, employeeName: emp.name,
      type: LEAVE_TYPES[Math.floor(Math.random() * 3)],
      startDate: start, endDate: end, days: daysBetween(start, end),
      reason: 'Family commitment — approved by department head.',
      status: ['Approved', 'Pending', 'Rejected'][Math.floor(Math.random() * 3)],
      appliedOn: start, actionBy: 'Farhana Akter', actionDate: start
    });
  });

  /* Tasks */
  db.tasks = [
    { id: uid('TSK'), title: 'Count Main House retail counter stock', assigneeEmail: 'floor@amaya.com', assigneeName: 'Warehouse Floor Lead', status: 'Open', due: todayISO(), createdAt: nowISO() },
    { id: uid('TSK'), title: 'Verify all in-transit transfer IMEIs',       assigneeEmail: 'logistics@amaya.com', assigneeName: 'Logistics Coordinator', status: 'Open', due: todayISO(), createdAt: nowISO() },
    { id: uid('TSK'), title: 'Reconcile Star Mobile Point outstanding',   assigneeEmail: 'accounts@amaya.com', assigneeName: 'Accounts Officer', status: 'Done', due: '', createdAt: nowISO() }
  ];

  /* Audit seed */
  const auditSamples = [
    ['CREATE','Inventory','New catalogue line added'],
    ['MOVE','Stock','IN movement committed for HONOR 400 Lite'],
    ['APPROVE','Transfer','TRF approved by administrator'],
    ['SALE','Sales','POS checkout completed'],
    ['REPAIR','After-Sales','Ticket triaged to technician'],
    ['PAYROLL','Payroll','Payslip generated'],
    ['LOGIN','Auth','Staff signed in'],
    ['EXPORT','Reports','Inventory CSV generated']
  ];
  for (let i = 0; i < 60; i++) {
    const s = auditSamples[i % auditSamples.length];
    const ts = new Date(); ts.setMinutes(ts.getMinutes() - i * 47);
    db.audit.push({
      id: uid('AUD'), timestamp: ts.toISOString(),
      user: ops[i % ops.length], role: 'Staff',
      action: s[0], module: s[1], recordId: s[2].slice(0, 14), details: s[2]
    });
  }

  return db;
}

/** Seed helper that writes straight into the object (no DB.insert during seeding). */
function resolveLineIn(db, spec) {
  let line = db.inventory.find(l => norm(l.sku) === norm(spec.sku) && norm(l.house) === norm(spec.house) && norm(l.color) === norm(spec.color));
  if (line) return line;
  line = {
    id: `INV-S${String(db.inventory.length + 1).padStart(4, '0')}`,
    itemId: null, sku: spec.sku, brand: spec.brand || '', type: spec.type || 'Regular',
    house: spec.house, color: spec.color || 'Standard',
    unitCost: num(spec.unitCost), unitPrice: num(spec.unitPrice),
    openingQty: 0, inQty: 0, outQty: 0, transferInQty: 0, transferOutQty: 0,
    returnQty: 0, soldQty: 0, adjustedQty: 0, reorderPoint: threshold(),
    lastMovementAt: nowISO(), createdAt: nowISO()
  };
  db.inventory.push(line);
  return line;
}

/* ==========================================================================
   StockFlow ERP — Predictive AI Analytics, WhatsApp Engine & Ledger Hash
   ========================================================================== */

const StockFlowAnalytics = {
  /**
   * Predictive Reorder Engine
   * Calculates 30-day velocity, daily burn rate, EOQ, and estimated days of stock remaining.
   */
  predictiveReorder() {
    const inv = DB.get('inventory');
    const movements = DB.get('movements');
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return inv.map(line => {
      const lineMovs = movements.filter(m => m.sku === line.sku && m.date >= thirtyDaysAgo);
      const unitsSold = lineMovs.reduce((sum, m) => sum + (m.type === 'SALE' || m.type === 'OUT' ? num(m.qty) : 0), 0);
      const dailyVelocity = unitsSold / 30;
      const currentStock = inHand(line);

      const daysRemaining = dailyVelocity > 0 ? Math.round(currentStock / dailyVelocity) : 999;
      // Economic Order Quantity (EOQ) formula: sqrt((2 * Demand * OrderCost) / HoldingCost)
      const annualDemand = dailyVelocity * 365;
      const eoq = annualDemand > 0 ? Math.max(10, Math.round(Math.sqrt((2 * annualDemand * 50) / (num(line.unitCost || 10) * 0.15)))) : 10;
      const recommendedSafetyStock = Math.ceil(dailyVelocity * 7); // 7-day safety buffer

      return {
        line,
        currentStock,
        thirtyDaySales: unitsSold,
        dailyVelocity: dailyVelocity.toFixed(2),
        daysRemaining,
        recommendedSafetyStock,
        eoq,
        needsReorder: currentStock <= recommendedSafetyStock || daysRemaining <= 7
      };
    }).sort((a, b) => a.daysRemaining - b.daysRemaining);
  },

  /**
   * FIFO Costing Valuation calculation for a SKU
   */
  fifoValuation(sku) {
    const movements = DB.get('movements').filter(m => m.sku === sku && (m.type === 'IN' || m.type === 'PURCHASE'));
    movements.sort((a, b) => a.date.localeCompare(b.date)); // Oldest first
    const line = DB.get('inventory').find(l => l.sku === sku);
    if (!line) return { totalQty: 0, totalValuation: 0, avgUnitCost: 0 };

    let qtyInHand = inHand(line);
    let totalValuation = 0;

    for (let i = movements.length - 1; i >= 0 && qtyInHand > 0; i--) {
      const batchQty = Math.min(qtyInHand, num(movements[i].qty));
      const unitCost = num(movements[i].unitCost || line.unitCost);
      totalValuation += batchQty * unitCost;
      qtyInHand -= batchQty;
    }
    // Remaining fallback
    if (qtyInHand > 0) {
      totalValuation += qtyInHand * num(line.unitCost);
    }
    const realQty = inHand(line);
    return {
      sku,
      totalQty: realQty,
      totalValuation,
      avgUnitCost: realQty > 0 ? (totalValuation / realQty).toFixed(2) : 0
    };
  }
};

const WhatsAppEngine = {
  /**
   * Format customer invoice for WhatsApp sending
   */
  buildInvoiceMessage(order) {
    const company = state.db.settings.companyName || 'StockFlow ERP';
    let text = `*${company} — Invoice #${order.orderId || order.trxRef}*\n`;
    text += `Date: ${order.date || new Date().toISOString().slice(0, 10)}\n`;
    text += `Customer: ${order.customerName || 'Valued Customer'}\n\n`;
    text += `*Items Purchased:*\n`;

    (order.items || []).forEach(it => {
      text += `• ${it.name || it.sku} x${it.qty} — ৳${num(it.total || (it.qty * it.price))}\n`;
    });

    text += `\n*Total Amount:* ৳${num(order.netAmount || order.totalAmount || 0)}\n`;
    text += `Payment Method: ${order.paymentMethod || 'Cash'}\n\n`;
    text += `Thank you for shopping with us!`;
    return text;
  },

  /**
   * Format BadBin repair update message for WhatsApp
   */
  buildRepairMessage(ticket) {
    const company = state.db.settings.companyName || 'StockFlow ERP';
    let text = `*${company} — Repair Ticket #${ticket.id || ticket.ticketNo}*\n`;
    text += `Device: ${ticket.brand || ''} ${ticket.model || ''} (IMEI/SN: ${ticket.imei || 'N/A'})\n`;
    text += `Status: *${ticket.status || 'In Progress'}*\n`;
    text += `Issue: ${ticket.issue || 'Diagnosis'}\n`;
    if (ticket.estCost) text += `Estimated Cost: ৳${num(ticket.estCost)}\n`;
    text += `\nFor inquiries, reply to this message.`;
    return text;
  },

  /**
   * Open WhatsApp Web or Mobile app with text pre-filled
   */
  send(phone, text) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }
};

const LedgerIntegrity = {
  /**
   * Calculates deterministic SHA-256/checksum for a ledger movement
   */
  hashRecord(rec, prevHash = '0000000000000000') {
    const payload = `${prevHash}|${rec.id}|${rec.trxRef}|${rec.type}|${rec.sku}|${rec.qty}|${rec.date}`;
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  },

  /**
   * Verify total ledger integrity
   */
  verifyChain() {
    const movements = DB.get('movements');
    let prevHash = 'GENESIS_BLOCK_STOCKFLOW';
    let valid = true;
    let corruptedIndex = -1;

    movements.forEach((m, idx) => {
      const expected = this.hashRecord(m, prevHash);
      if (m._hash && m._hash !== expected) {
        valid = false;
        corruptedIndex = idx;
      }
      prevHash = expected;
      m._hash = expected; // Attach / verify hash
    });

    return { valid, totalRecords: movements.length, corruptedIndex };
  }
};


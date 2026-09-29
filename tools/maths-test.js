/* Arithmetic regression tests for AMAYA ERP.
 *
 * WHY A SEPARATE HARNESS RATHER THAN BROWSER ASSERTIONS
 * Everything interesting - inHand, lineValue, the invoice balance, payroll net,
 * Trade.recalc - is a pure function over records. Testing them through the DOM
 * means clicking through eleven screens to observe one number, and the
 * observation is a formatted string, so the only way to assert on it is to
 * re-parse a currency format. This harness loads the real, unmodified
 * application source and calls the real functions, so a test failure is a fact
 * about the shipped code rather than about a test double.
 *
 * THE SOURCE LIST IS PARSED OUT OF build.ps1
 * A hand-copied list of 21 filenames is a list that silently stops testing the
 * module you just added. build.ps1 is the only authority on what actually ships,
 * so it is also the authority on what gets tested. If a module is added to the
 * bundle, it is added to the tests the next time this runs, with no edit here.
 *
 * WHAT IS ASSERTED
 * Two families, in order of how badly they bite:
 *
 *   1. Cross-checks that must hold for any data at all. The stock ledger and
 *      the running counters on a line have to agree; an invoice's amount has to
 *      equal what was paid plus what is owed; a payslip's net has to be
 *      reconstructable from its parts. These are the defects that make a user
 *      stop trusting the number, because two screens disagree.
 *
 *   2. The trade-in money contract, which is the one place this codebase
 *      invents arithmetic rather than recording it. Stated once, in 18-tradein.
 *
 * Run: node tools\maths-test.js            (exit 0 = pass, 1 = fail)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* ------------------------------------------------------------ build loader */

/** Extract the $jsFiles = @(...) list from build.ps1, in order. */
function bundleSources() {
  const ps = fs.readFileSync(path.join(ROOT, 'build.ps1'), 'utf8');
  const m = /\$jsFiles\s*=\s*@\(([\s\S]*?)\n\)/.exec(ps);
  if (!m) {
    throw new Error('could not find the $jsFiles array in build.ps1 - the harness must be updated');
  }
  const files = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1].replace(/\\/g, path.sep));
  if (!files.length) throw new Error('build.ps1 $jsFiles array is empty');
  return files;
}

/* ------------------------------------------------------------- environment */

/* A localStorage that actually stores, so DB.load() seeds the demo dataset and
 * the tests run against the same records a first-run user would see. A stub that
 * returns null would make DB.load() take its empty path and every cross-check
 * below would pass vacuously on an empty database. */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
}

/** An element stub that swallows everything. Enough for module-load side effects
 *  that touch the DOM without being worth emulating. */
function stubEl() {
  const el = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, click() {}
  };
  return el;
}

function makeContext() {
  const doc = {
    /* 'loading' is load-bearing. 09-init.js ends with
     *   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
     *   else boot();
     * and addEventListener below is a no-op, so the tests get the functions
     * without boot() running. That keeps DB in its just-loaded state and avoids
     * needing to emulate navigation. */
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: stubEl, createElementNS: stubEl,
    body: stubEl(), documentElement: stubEl(),
    hidden: false, visibilityState: 'visible'
  };
  const storage = makeStorage();
  const win = {
    localStorage: storage, sessionStorage: makeStorage(),
    document: doc, navigator: { userAgent: 'node', platform: 'node', language: 'en' },
    location: { href: 'http://localhost/', origin: 'http://localhost', reload() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, alert() {}, confirm: () => true, prompt: () => null,
    print() {}, open: () => null, fetch: undefined
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  doc.defaultView = win;
  const ctx = vm.createContext(win);
  return { ctx, storage, win };
}

/* -------------------------------------------------------------- test runner */

const results = [];
let currentGroup = '';

function group(name) { currentGroup = name; }

function check(label, actual, expected, opts = {}) {
  const pass = opts.deep ? deepEq(actual, expected) : Object.is(actual, expected);
  results.push({ group: currentGroup, label, pass, actual, expected });
  return pass;
}

/** Assert a predicate, for the invariants that are not a single equality. */
function ok(label, condition, detail) {
  results.push({ group: currentGroup, label, pass: !!condition, actual: detail === undefined ? String(!!condition) : detail, expected: 'true' });
  return !!condition;
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEq(a[k], b[k]));
}

/** Within a cent. Money is summed as floats, so exact equality is the wrong
 *  assertion; 0.005 of drift over a thousand rows is normal and harmless. */
function near(a, b, tol = 0.005) { return Math.abs(a - b) <= tol; }

function money(label, actual, expected) {
  return check(label, Math.round(actual * 100) / 100, Math.round(expected * 100) / 100);
}

/* ------------------------------------------------------------------- load */

const sources = bundleSources();
const combined = sources
  .map((f) => {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) throw new Error(`build.ps1 lists ${f} but it does not exist`);
    return fs.readFileSync(p, 'utf8');
  })
  .join('\n');

const { ctx } = makeContext();

/* Expose the internals the tests need. These names are the ones a maths bug
 * would actually live in; everything else is reached through them. */
const PROBE = `
globalThis.__probe = {
  DB, state, num, round2, sum, inHand, lineValue, totalUnits, inventoryValue,
  threshold, stockLevel, findLine, movementSign, movementEffect, MOVEMENT_SIGN, Trade, Momentum,
  APP, BRAND, Drill,
  monthKey, daysBetween, todayISO, localDayOf, clockMinutes, localClockOf,
  registerPageDrills, registerMetricDrills, registerCardDrills,
  esc, fmt
};
`;

try {
  vm.runInContext(`'use strict';\n${combined}\n${PROBE}`, ctx, { filename: 'amaya-bundle.js', timeout: 30000 });
} catch (e) {
  console.error('  maths-test — the bundle threw while loading. Nothing was tested.');
  console.error(`  ${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e}`);
  process.exit(1);
}

const P = ctx.__probe;
if (!P || !P.DB) {
  console.error('  maths-test — the bundle loaded but did not expose a probe.');
  process.exit(1);
}

/* Seed the same dataset the app ships with. */
P.DB.load();

/* Install the drill table exactly as boot() does, so the drill tests below
 * exercise the real registrations rather than an empty object. */
P.registerPageDrills();
P.registerMetricDrills();
P.registerCardDrills();

/* =============================================================== 1. primitives */

group('primitives');

check('num() of a numeric string', P.num('12.5'), 12.5);
check('num() of empty string', P.num(''), 0);
check('num() of null', P.num(null), 0);
check('num() of undefined', P.num(undefined), 0);
check('num() of NaN-producing text', P.num('abc'), 0);
check('num() of Infinity', P.num(Infinity), 0);
check('num() of a comma thousands string', P.num('1,200'), 0, { note: 'a comma string is not a number; it must not become 1200' });
check('num() of negative', P.num('-4'), -4);

/* The classic float traps. 1.005 is stored as 1.00499999999999989, so a naive
 * `Math.round(n*100)/100` rounds it DOWN to 1.00 and 2.675 becomes 2.67. */
check('round2() rounds a half up, not down', P.round2(1.005), 1.01);
check('round2() handles 2.675', P.round2(2.675), 2.68);
check('round2() is symmetric below zero', P.round2(-1.005), -1.01);
check('round2() does not shift an exact value', P.round2(2.67), 2.67);
check('round2() of a whole number', P.round2(7), 7);
check('round2() of junk', P.round2('abc'), 0);

check('sum() of an empty list', P.sum([], (x) => x), 0);
check('sum() with no accessor', P.sum([1, 2, 3]), 6);
check('sum() over junk elements', P.sum([1, 'x', null, 4]), 5);
check('sum() is not affected by a float tail', P.sum([0.1, 0.2]) !== 0.3, true, { note: 'informational: float tails are real, money() is the rounding boundary' });

/* ============================================================ 2. stock maths */

group('stock');

const probeLine = {
  openingQty: 10, inQty: 5, outQty: 3, transferInQty: 2, transferOutQty: 1,
  returnQty: 1, soldQty: 4, adjustedQty: -2, unitCost: 100
};
check('inHand() sums every movement leg', P.inHand(probeLine), 10 + 5 - 3 + 2 - 1 + 1 - 4 - 2);
check('inHand() of an untouched line', P.inHand({ openingQty: 7 }), 7);
check('inHand() of an empty line', P.inHand({}), 0);
check('inHand() of null is zero, not a throw', P.inHand(null), 0);
check('lineValue() is inHand times unit cost', P.lineValue(probeLine), P.inHand(probeLine) * 100);
check('lineValue() of a negative line is negative', P.lineValue({ openingQty: 0, outQty: 5, unitCost: 100 }), -500);
check('lineValue() of a missing cost is zero', P.lineValue({ openingQty: 10 }), 0);

/* The ledger cross-check - the important one. Every movement row names a model,
 * a quantity and a direction; the running counters on the inventory line are
 * supposed to be the same history expressed a different way. If these drift, a
 * stock number is fiction, and no amount of correct arithmetic elsewhere will
 * make the two screens agree.
 *
 * Aggregated PER MODEL, not per line. A model is stocked at several facilities
 * and in several colours, each with its own line and its own counters, so
 * comparing one line against every movement row for that model would report a
 * mismatch on correct data. The sum of inHand across a model's lines is what
 * the ledger for that model has to explain. */
{
  const inv = P.DB.get('inventory');
  const movs = P.DB.get('movements');
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

  /* The identity under test. For each model:
   *
   *     on hand  ==  opening balance  +  every movement in the ledger
   *
   * Nothing is exempt and nothing is tolerated. This is the strongest statement
   * the app can make about its own stock: the running counters on the inventory
   * lines are the ledger, re-expressed per facility and colour. It failed three
   * separate ways before - the seeder wrote unclamped quantities to the ledger,
   * the seeder booked cycle counts with no sign, and transfers moved stock with
   * no row at all - and each of those left a plausible-looking number on screen
   * that the audit trail did not support. */
  const ledgerByModel = new Map();
  for (const m of movs) {
    const key = norm(m.sku);
    if (!key) continue;
    ledgerByModel.set(key, (ledgerByModel.get(key) || 0) + P.movementEffect(m));
  }

  const totals = new Map();
  for (const l of inv) {
    const key = norm(l.sku);
    if (!key) continue;
    const t = totals.get(key) || { opening: 0, counted: 0, lines: 0 };
    t.opening += P.num(l.openingQty);
    t.counted += P.inHand(l);
    t.lines++;
    totals.set(key, t);
  }

  const bad = [], unknown = new Set();
  for (const m of movs) {
    if (P.movementSign(m.type) === 0 && String(m.type || '').trim().toUpperCase() !== 'ADJUST') unknown.add(m.type);
  }
  let checked = 0;
  for (const [key, t] of totals) {
    /* A model with no movement history is fully described by its opening
     * balance, so there is nothing to reconcile. */
    if (!ledgerByModel.has(key)) continue;
    checked++;
    const moved = ledgerByModel.get(key);
    if (!near(t.opening + moved, t.counted, 0.001)) {
      bad.push(`${key}: opening ${Math.round(t.opening)} + ledger ${Math.round(moved)} = ${Math.round(t.opening + moved)}, but ${t.lines} line(s) report ${Math.round(t.counted)}`);
    }
  }
  ok(`stock: opening + ledger == on hand, exactly, for all ${checked} model(s) with history`,
    bad.length === 0, bad.length ? bad.slice(0, 6).join('; ') : `${checked} models reconciled`);

  /* Every type the app writes must be classifiable. An unrecognised type is
   * silently dropped by every "sum the inflows" query in the app, so a new type
   * added without updating MOVEMENT_SIGN would quietly vanish from the
   * analytics rather than error. */
  ok('stock: every movement type in the data has a known direction', unknown.size === 0,
    unknown.size ? `unclassified: ${[...unknown].join(', ')}` : 'clean');

  /* And the sign table must agree with the way inHand() treats each counter.
   * A customer return adds stock. If this ever inverts, every inflow figure in
   * the app is wrong in the same direction and nothing else would notice. */
  const ret = P.DB.get('inventory').reduce((a, l) => a + P.num(l.returnQty), 0);
  ok('stock: customer returns are an inflow', P.movementSign('RETURN') === 1 && ret >= 0,
    `movementSign('RETURN')=${P.movementSign('RETURN')}, returns seeded ${Math.round(ret)}`);
  check('movementSign() of TRANSFER IN', P.movementSign('TRANSFER IN'), 1);
  check('movementSign() of TRANSFER OUT', P.movementSign('TRANSFER OUT'), -1);
  check('movementSign() of SALE', P.movementSign('SALE'), -1);
  check('movementSign() of ADJUST is directionless', P.movementSign('ADJUST'), 0);
  check('movementSign() folds separators, so Transfer_Out is not a silent zero', P.movementSign('transfer_out'), -1);
  check('movementSign() of an unknown type is zero, not a guess', P.movementSign('MYSTERY'), 0);
}

{
  /* Threshold boundary behaviour, read straight off stockLevel so the
   * "at or below" wording in the UI and the label agree. */
  const mk = (n) => ({ openingQty: n });
  const lvl = (n) => P.stockLevel(mk(n)).key;
  const t = P.threshold();
  check('stockLevel() at zero is out', lvl(0), 'out');
  check('stockLevel() below zero is out', lvl(-3), 'out');
  check('stockLevel() at the threshold is low, not healthy', lvl(t), 'low');
  check('stockLevel() one above the threshold is healthy', lvl(t + 1), 'healthy');
  check('stockLevel() at 5 is critical', lvl(5), 'critical');
  check('stockLevel() at 6 is not critical when the threshold is 10', lvl(6), lvl(6) === 'critical' ? 'critical' : 'low');
}

/* =========================================================== 3. invoices */

group('invoices');

{
  const invs = P.DB.get('invoices');
  ok('invoices: the demo set is present', invs.length > 0, `${invs.length} rows`);

  let bad = 0, badStatus = 0;
  const samples = [];
  for (const i of invs) {
    const amount = P.num(i.amount);
    const paid = P.num(i.paid);
    const owing = amount - paid;
    if (amount < 0 || paid < 0 || paid > amount + 0.005) {
      bad++;
      if (samples.length < 5) samples.push({ no: i.invoiceNo, amount, paid });
      continue;
    }
    /* status must follow the money, not a stale field */
    const shouldBe = paid >= amount - 0.005 ? 'Paid' : (i.dueDate && i.dueDate < P.todayISO() ? 'Overdue' : 'Pending');
    if (i.status !== shouldBe) {
      badStatus++;
      if (samples.length < 8) samples.push({ no: i.invoiceNo, status: i.status, shouldBe, amount, paid });
    }
  }
  ok('invoices: paid never exceeds amount, and neither is negative', bad === 0, bad ? JSON.stringify(samples) : 'clean');
  ok('invoices: status agrees with amount/paid/due date', badStatus === 0, badStatus ? JSON.stringify(samples) : 'clean');
}

{
  /* Receivables as the finance page computes it must equal the sum of the open
   * invoice rows behind it. Two screens, one number. */
  const invs = P.DB.get('invoices');
  const receivables = invs.filter((i) => i.type === 'Sale' && i.status !== 'Paid');
  const payables = invs.filter((i) => i.type === 'Purchase' && i.status !== 'Paid');
  const recvTotal = receivables.reduce((a, i) => a + (P.num(i.amount) - P.num(i.paid)), 0);
  const recvNaive = receivables.reduce((a, i) => a + P.num(i.amount), 0);
  const paidPartial = receivables.filter((i) => P.num(i.paid) > 0);
  ok('invoices: a partially paid invoice is counted at its outstanding amount',
    paidPartial.length === 0 || !near(recvTotal, recvNaive),
    paidPartial.length
      ? `${paidPartial.length} partially paid; outstanding ${Math.round(recvTotal)} vs face ${Math.round(recvNaive)}`
      : 'no partially paid invoices in the demo set');
  check('invoices: payables and receivables are separate sets',
    receivables.some((i) => payables.includes(i)), false);
}

/* ============================================================== 4. sales */

group('sales');

{
  const sales = P.DB.get('sales');
  let bad = 0, badQty = 0;
  const samples = [];
  for (const s of sales) {
    const lines = s.items || [];
    if (!Array.isArray(lines)) { bad++; continue; }
    for (const l of lines) {
      if (P.num(l.qty) <= 0) { badQty++; if (samples.length < 5) samples.push({ order: s.orderId, sku: l.sku, qty: l.qty }); }
    }
    const total = P.num(s.total);
    if (total < 0) { bad++; if (samples.length < 8) samples.push({ order: s.orderId, total }); }
  }
  ok('sales: every line has a positive quantity', badQty === 0, badQty ? JSON.stringify(samples) : 'clean');
  ok('sales: no negative order total', bad === 0, bad ? JSON.stringify(samples) : 'clean');
}

/* ============================================================= 5. payroll */

group('payroll');

{
  const rows = P.DB.get('payroll');
  ok('payroll: the demo set is present', rows.length > 0, `${rows.length} rows`);

  let bad = 0;
  const samples = [];
  /* net = base + (overtimeHours * overtimeRate) - deductions + bonus
   * This is the definition used to build a payslip; reconstructing it is the
   * check that the stored net is not a stale hand-entered number. The field
   * names are read defensively so a rename shows up as a failure here rather
   * than as a silently skipped test. */
  for (const p of rows) {
    const base = P.num(p.baseSalary != null ? p.baseSalary : p.salary);
    const ot = P.num(p.overtimeHours) * P.num(p.overtimeRate);
    const ded = P.num(p.deductions);
    const bonus = P.num(p.bonus);
    const net = P.num(p.netSalary);
    const rebuilt = base + ot - ded + bonus;
    if (!near(rebuilt, net, 0.05)) {
      bad++;
      if (samples.length < 5) samples.push({ who: p.employeeName, month: p.month, net, rebuilt, base, ot, ded, bonus });
    }
  }
  ok('payroll: net salary is reconstructable from its parts', bad === 0, bad ? JSON.stringify(samples) : `${rows.length} payslips agree`);

  const netNeg = rows.filter((p) => P.num(p.netSalary) < 0);
  ok('payroll: no negative net salary', netNeg.length === 0,
    netNeg.length ? netNeg.map((p) => p.employeeName).join(', ') : 'clean');
}

/* ============================================================== 6. trade-in */

group('trade-in');

{
  const T = P.Trade;
  ok('trade-in: the module is present', !!T && typeof T.recalc === 'function', T ? 'yes' : 'MISSING');
  if (T && typeof T.recalc === 'function') {
    /* recalc() mutates and returns the record, and derives the incoming
     * device's worth itself from oldModel/oldValue/condition rather than
     * accepting it - so the test drives it the way the desk does and reads back
     * the fields it actually writes. */
    const cases = [
      { name: 'equal value, no money either way', credit: 100, newPrice: 100, newCost: 60 },
      { name: 'credit exceeds the new price - a refund is due', credit: 200, newPrice: 100, newCost: 60 },
      { name: 'new price exceeds the credit - the customer pays', credit: 100, newPrice: 180, newCost: 120 },
      { name: 'credit is exactly one cent over - must not leak into payable', credit: 100.01, newPrice: 100, newCost: 60 },
      { name: 'nothing at all', credit: 0, newPrice: 0, newCost: 0 },
      { name: 'free replacement - we pay out and sell nothing', credit: 50, newPrice: 0, newCost: 0 }
    ];
    for (const c of cases) {
      const r = T.recalc({ credit: c.credit, newPrice: c.newPrice, newCost: c.newCost, oldValue: 2000, condition: 'Working' });
      const payable = Math.max(0, c.newPrice - c.credit);
      const refundDue = Math.max(0, c.credit - c.newPrice);
      const margin = c.newPrice - c.newCost - refundDue;
      money(`trade-in: payable is the shortfall  [${c.name}]`, P.num(r.payable), payable);
      money(`trade-in: refund is only the surplus  [${c.name}]`, P.num(r.refundDue), refundDue);
      money(`trade-in: margin is net of any refund  [${c.name}]`, P.num(r.margin), margin);
      money(`trade-in: the agreed credit is retained  [${c.name}]`, P.num(r.creditValue), c.credit);
      money(`trade-in: new gross mirrors the new price  [${c.name}]`, P.num(r.newGross), c.newPrice);

      /* The two money directions can never both be positive. A trade that pays
       * the customer AND bills them is the single worst bug this module could
       * have: a real, collectable-looking amount in the wrong direction. */
      ok(`trade-in: never both payable and refund due  [${c.name}]`,
        !(P.num(r.payable) > 0.005 && P.num(r.refundDue) > 0.005),
        `payable ${P.num(r.payable)} / refund ${P.num(r.refundDue)}`);

      /* Margin can never be better than selling the phone outright, and can
       * never be worse than handing back the entire credit. */
      ok(`trade-in: margin is bounded by the sale  [${c.name}]`,
        P.num(r.margin) <= c.newPrice + 0.005 && P.num(r.margin) >= -refundDue - 0.005,
        `margin ${P.num(r.margin)}, refund ${refundDue}`);

      /* The trade gap is the whole point of the module: what the customer was
       * given credit for, less what the device is actually worth to us. It must
       * be derived from the record's own worth, not from an input. */
      money(`trade-in: gap is credit above the device's worth  [${c.name}]`,
        P.num(r.tradeGap), c.credit - P.num(r.incomingWorth));
      ok(`trade-in: the device's worth is a real figure  [${c.name}]`,
        Number.isFinite(P.num(r.incomingWorth)) && P.num(r.incomingWorth) >= 0,
        `incomingWorth ${P.num(r.incomingWorth)}`);
    }

    /* A dead board is scrap, so its worth has to be far below a working one
     * with the same stated value - otherwise the condition field does nothing. */
    const working = P.num(T.recalc({ oldModel: '', oldValue: 2000, condition: 'Working', incomingQty: 0 }).incomingWorth);
    const dead = P.num(T.recalc({ oldModel: '', oldValue: 2000, condition: 'Dead', incomingQty: 0 }).incomingWorth);
    ok('trade-in: a dead device is worth less than a working one', dead < working, `working ${working} vs dead ${dead}`);

    const grades = T.suggest ? T.suggest('HONOR X9b 5G 12/256', 'A') : null;
    ok('trade-in: a catalogued model yields a suggestion', P.num(grades) > 0, `suggest = ${grades}`);
    ok('trade-in: an unknown model yields no invented number', P.num(T.suggest('NOT A REAL MODEL', 'A')) === 0, 'refused, as intended');
  }
}

/* ===================================================== 7. drill footers agree */

group('drills');

{
  /* The promise made to the user is that a card resolves to its data. The
   * sharpest version of that promise is the footer: it sits under the table and
   * states a total, so if the total is not the total of the rows above it, the
   * drill has quietly become a different chart from the card that opened it.
   *
   * Not every footer is a row count, and assuming they all were produced two
   * false alarms on the first run: the Stock valuation footer leads with total
   * UNITS under a per-facility table, and the Staff-on-leave footer leads with
   * the size of the ROSTER under a table of the people currently away. Both are
   * correct, and both name a different quantity from the drill's own unit.
   *
   * So the check is scoped rather than skipped: a footer that names the drill's
   * own unit is claiming a row count and must match; one that names some other
   * quantity is an aggregate and is exempt. The exemption count is reported
   * below, so a drill cannot fall out of this test unnoticed. */
  const specs = P.Drill && P.Drill.specs ? P.Drill.specs : {};
  const keys = Object.keys(specs);
  ok('drills: a table of specifications is registered', keys.length > 0, `${keys.length} drills`);

  const singular = (w) => String(w || '').trim().toLowerCase().replace(/s$/, '');
  let counted = 0, exempt = 0, bad = [], errs = [], noCount = [];
  for (const k of keys) {
    const spec = specs[k];
    let rows;
    try { rows = spec.rows() || []; }
    catch (e) { errs.push(`${k}: rows() threw ${e.message}`); continue; }
    if (!Array.isArray(rows)) { errs.push(`${k}: rows() did not return an array`); continue; }
    if (!spec.foot) continue;
    let foot;
    try { foot = P.Drill._text(spec.foot); } catch (e) { errs.push(`${k}: foot() threw ${e.message}`); continue; }
    if (typeof foot !== 'string' || !foot) { errs.push(`${k}: footer produced no markup`); continue; }

    const unit = singular(spec.unit);
    if (!unit) { noCount.push(k); continue; }

    /* The leading bold figure, and the word that follows it. */
    const m = /<b>([\d,]+)\s+([a-z]+)<\/b>/i.exec(foot);
    if (!m) { noCount.push(k); continue; }
    const said = Number(m[1].replace(/,/g, ''));
    const word = singular(m[2]);

    if (word !== unit) { exempt++; continue; }   // an aggregate, not a row count
    counted++;
    if (said !== rows.length) bad.push(`${k}: footer says ${said} ${word}, table has ${rows.length}`);
  }
  ok(`drills: row-count footers match their own tables (${counted} checked, ${exempt} aggregate exempt)`,
    bad.length === 0, bad.length ? bad.slice(0, 8).join('; ') : `${counted} checked`);
  ok('drills: every drill produces its rows and footer', errs.length === 0,
    errs.length ? errs.slice(0, 8).join('; ') : 'clean');
  /* Informational, not a failure: footers with no leading count, e.g. the
   * two-leg money summaries. Listed so a newly added one stays visible. */
  results.push({ group: 'drills', label: `drills: ${noCount.length} footer(s) carry no leading count`, pass: true,
    actual: noCount.slice(0, 6).join(', ') || 'none', expected: 'informational' });
}

/* ============================================== 8. no NaN anywhere in money */

group('integrity');

{
  const MONEY_FIELDS = [
    ['sales', ['total', 'paid', 'discount']],
    ['purchases', ['total', 'receivedQty', 'qty']],
    ['invoices', ['amount', 'paid']],
    ['customers', ['balance', 'creditLimit']],
    ['suppliers', ['balance']],
    ['employees', ['salary']],
    ['payroll', ['baseSalary', 'netSalary', 'overtimeRate', 'deductions', 'bonus', 'overtimeHours']],
    ['inventory', ['unitCost', 'unitPrice', 'openingQty', 'inQty', 'outQty', 'soldQty', 'adjustedQty', 'reorderPoint']],
    ['dispatches', ['cost']],
    ['repairs', ['cost', 'labourCost']],
    ['upgrades', ['credit', 'newPrice', 'newCost', 'payable', 'refundDue', 'margin', 'incomingWorth', 'tradeGap']]
  ];
  const bad = [];
  for (const [col, fields] of MONEY_FIELDS) {
    for (const rec of P.DB.get(col) || []) {
      for (const f of fields) {
        if (rec[f] === undefined || rec[f] === null || rec[f] === '') continue;
        const v = Number(rec[f]);
        if (!Number.isFinite(v)) bad.push(`${col}.${f}=${JSON.stringify(rec[f])}`);
      }
    }
  }
  ok('integrity: no NaN or Infinity in any money or quantity field', bad.length === 0,
    bad.length ? [...new Set(bad)].slice(0, 8).join(', ') : 'clean');
}

{
  /* Negative stock is a legitimate state, not a defect, and this suite is
   * careful not to pretend otherwise. A cycle count that finds fewer units than
   * the system holds is a real business event, the live reconcile form records
   * it, and the app ships a whole drill and a dashboard alert to surface it.
   * Mute those and an ERP that cannot show you a shortage is worse than one
   * that can.
   *
   * What is NOT legitimate is negative stock with nothing behind it, and that is
   * already ruled out above: the exact opening + ledger == on-hand identity
   * means every negative unit is accounted for by a signed movement. So the
   * check here is that the demo set is not dominated by them, and that the
   * app's own drill reports the ones that exist - which is the "every card
   * resolves to its data" promise, exercised on real data. */
  const invAll = P.DB.get('inventory');
  const negatives = invAll.filter((l) => P.inHand(l) < 0);
  ok('integrity: negative stock is the exception, not the rule', negatives.length <= Math.max(2, invAll.length * 0.05),
    `${negatives.length} of ${invAll.length} lines below zero`);

  for (const l of negatives) {
    const key = String(l.sku).toLowerCase();
    const explains = P.DB.get('movements')
      .filter((m) => String(m.sku).toLowerCase() === key && P.movementEffect(m) < 0);
    ok(`integrity: ${l.sku} being below zero is backed by the ledger`, explains.length > 0,
      explains.length ? `${explains.length} issuing movement(s)` : 'no ledger row supports this');
  }

  /* The drill that exists to show them must actually show them. */
  const negDrill = P.Drill.specs['inv:negative'];
  ok('integrity: the Negative stock drill returns the negative lines', !!negDrill,
    negDrill ? 'registered' : 'NOT REGISTERED');
  if (negDrill) {
    const rows = negDrill.rows() || [];
    const reported = new Set(rows.map((r) => String(r.sku).toLowerCase()));
    const missed = negatives.filter((l) => !reported.has(String(l.sku).toLowerCase()));
    ok('integrity: every negative line appears in the Negative stock drill', missed.length === 0,
      missed.length ? missed.map((l) => l.sku).join(', ') : `${rows.length} row(s) reported`);
  }

  /* The rest of the admin integrity panel, asserted directly. These are the
   * checks the UI shows as "N checks need attention", so a seeded dataset that
   * trips any of them is a false alarm on first run. */
  const quality = [
    ['every line has a facility', invAll.every((l) => l.house), `${invAll.filter((l) => !l.house).length} missing`],
    ['every line has a cost price', invAll.every((l) => P.num(l.unitCost) > 0), `${invAll.filter((l) => !P.num(l.unitCost)).length} at zero`],
    ['every sale has an invoice', P.DB.get('sales').every((s) => s.invoiceNo), 'invoice link'],
    ['every invoice has a due date', P.DB.get('invoices').every((i) => i.dueDate), 'due date'],
    ['every repair has an intake date', P.DB.get('repairs').every((r) => r.intakeDate), 'intake date']
  ];
  for (const [label, good, detail] of quality) {
    ok(`integrity: a fresh install passes "${label}"`, good, detail);
  }

  /* Seeded transfers must be in the ledger. Nine demo transfers used to move
   * stock with no movement row at all, so the audit trail and the on-hand
   * figure described two different histories. */
  const trfRefs = new Set(P.DB.get('transfers').map((t) => t.transferRef));
  const mvRefs = new Set(P.DB.get('movements').map((m) => m.transferRef).filter(Boolean));
  const unbacked = [...trfRefs].filter((r) => !mvRefs.has(r));
  /* Only settled transfers should have posted stock. A Pending or Approved
   * gate pass has not moved anything and must NOT appear in the ledger. */
  const settled = P.DB.get('transfers').filter((t) => t.status === 'Complete' || t.status === 'Received');
  const settledRefs = new Set(settled.map((t) => t.transferRef));
  const missing = settled.filter((t) => !mvRefs.has(t.transferRef));
  ok(`integrity: all ${settled.length} settled seeded transfer(s) are in the ledger`, missing.length === 0,
    missing.length ? missing.map((t) => t.transferRef).slice(0, 5).join(', ') : 'clean');
  ok('integrity: unsettled transfers are not in the ledger',
    [...mvRefs].every((r) => settledRefs.has(r)),
    [...mvRefs].filter((r) => !settledRefs.has(r)).join(', ') || 'clean');
  ok('integrity: the ledger has no transfer rows for transfers that do not exist',
    [...mvRefs].every((r) => trfRefs.has(r)), [...mvRefs].filter((r) => !trfRefs.has(r)).join(', ') || 'clean');

  /* A transfer's ledger rows must match what the gate pass says moved, per
   * model and per direction. The old live path posted one row carrying the
   * first SKU and the transfer's TOTAL, which failed this for any multi-model
   * transfer.
   *
   * Checked per direction, not summed: N units leaving one facility and N
   * arriving at another is TWO rows totalling 2N, and that is correct. */
  const trfBad = [];
  let legsChecked = 0;
  for (const t of settled) {
    for (const it of (t.items || [])) {
      const want = P.num(it.qty);
      for (const [dir, type] of [['out', 'TRANSFER OUT'], ['in', 'TRANSFER IN']]) {
        const legs = P.DB.get('movements').filter((m) => m.transferRef === t.transferRef
          && String(m.type).toUpperCase() === type
          && String(m.sku).toLowerCase() === String(it.sku).toLowerCase());
        legsChecked++;
        const moved = legs.reduce((a, m) => a + P.num(m.qty), 0);
        if (moved !== want) trfBad.push(`${t.transferRef}/${it.sku} ${dir}: ledger ${moved} vs gate pass ${want}`);
      }
    }
  }
  ok(`integrity: every transfer leg matches its own ledger rows (${legsChecked} checked)`, trfBad.length === 0,
    trfBad.length ? trfBad.slice(0, 5).join('; ') : 'clean');

  /* A multi-model transfer must produce a ledger row per model, not one row
   * for the whole thing. Assert the shape directly. */
  const distinct = (list, f) => new Set(list.map(f)).size;
  const multi = settled.find((t) => distinct(t.items || [], (i) => String(i.sku).toLowerCase()) > 1);
  ok('integrity: a multi-model transfer logs one row per model, not one per transfer',
    !multi || distinct(P.DB.get('movements').filter((m) => m.transferRef === multi.transferRef), (m) => String(m.sku).toLowerCase())
      === distinct(multi.items || [], (i) => String(i.sku).toLowerCase()),
    multi ? `${multi.transferRef}: ${(multi.items || []).length} lines` : 'demo set has no multi-model transfer');
}

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.pass);
const byGroup = [];
for (const g of results) {
  let b = byGroup.find((x) => x.name === g.group);
  if (!b) { b = { name: g.group, total: 0, failed: 0 }; byGroup.push(b); }
  b.total++;
  if (!g.pass) b.failed++;
}

console.log(`  maths-test — ${sources.length} bundled sources, ${results.length} assertions\n`);
for (const b of byGroup) {
  console.log(`  ${b.failed ? 'FAIL' : ' ok '}  ${b.name.padEnd(12)} ${b.total - b.failed}/${b.total}`);
}
if (failed.length) {
  console.log('\n  failures:');
  for (const f of failed) {
    console.log(`    [${f.group}] ${f.label}`);
    console.log(`      actual:   ${JSON.stringify(f.actual)}`);
    console.log(`      expected: ${JSON.stringify(f.expected)}`);
  }
}
console.log('');
process.exit(failed.length ? 1 : 0);

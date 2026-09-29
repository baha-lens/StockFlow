/* Diagnostic: for a chosen model, print every ledger row and every stock line
 * side by side so the residual drift can be attributed to a specific leg.
 * Not part of the test suite - a debugging aid. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ps = fs.readFileSync(path.join(ROOT, 'build.ps1'), 'utf8');
const files = [...(/\$jsFiles\s*=\s*@\(([\s\S]*?)\n\)/.exec(ps)[1]).matchAll(/'([^']+)'/g)]
  .map(x => x[1].replace(/\\/g, path.sep));
const combined = files.map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');

const store = new Map();
const doc = { readyState: 'loading', addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: {}, documentElement: {}, hidden: false };
const win = { localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  document: doc, navigator: { userAgent: 'node' }, location: { href: 'http://x/', origin: 'http://x' },
  matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
  setTimeout, clearTimeout, setInterval, clearInterval, console };
win.window = win; win.self = win;
const ctx = vm.createContext(win);
vm.runInContext(`'use strict';\n${combined}\nglobalThis.__p={DB,inHand,num,movementEffect,movementSign};`, ctx, { timeout: 30000 });
const P = ctx.__p;
P.DB.load();

const want = process.argv[2] || '';
const inv = P.DB.get('inventory');
const models = [...new Set(inv.map(l => String(l.sku).toLowerCase()))];

const rows = [];
for (const key of models) {
  const lines = inv.filter(l => String(l.sku).toLowerCase() === key);
  const mv = P.DB.get('movements').filter(m => String(m.sku).toLowerCase() === key);
  const opening = lines.reduce((a, l) => a + P.num(l.openingQty), 0);
  const ledger = mv.reduce((a, m) => a + P.movementEffect(m), 0);
  const counted = lines.reduce((a, l) => a + P.inHand(l), 0);
  rows.push({ key, opening, ledger, implied: opening + ledger, counted, drift: counted - (opening + ledger),
    counters: lines.map(l => `${l.house}/${l.color}: o${P.num(l.openingQty)} i${P.num(l.inQty)} x${P.num(l.outQty)} ti${P.num(l.transferInQty)} to${P.num(l.transferOutQty)} r${P.num(l.returnQty)} s${P.num(l.soldQty)} a${P.num(l.adjustedQty)} = ${P.inHand(l)}`) });
}
rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
const show = want ? rows.filter(r => r.key.includes(want.toLowerCase())) : rows.filter(r => r.drift !== 0);

console.log(`models with any drift: ${rows.filter(r => r.drift !== 0).length} of ${rows.length}`);
for (const r of show.slice(0, 6)) {
  console.log(`\n=== ${r.key}  drift ${r.drift}  (opening ${r.opening} + ledger ${r.ledger} = ${r.implied}, lines say ${r.counted})`);
  r.counters.forEach(c => console.log('    ' + c));
  const mv = P.DB.get('movements').filter(m => String(m.sku).toLowerCase() === r.key);
  const byType = {};
  for (const m of mv) {
    const k = `${m.type}|${m.house}`;
    byType[k] = (byType[k] || 0) + P.movementEffect(m);
  }
  console.log('    ledger by type|house: ' + Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  '));
}

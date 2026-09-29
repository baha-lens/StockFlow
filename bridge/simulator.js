#!/usr/bin/env node
/* ==========================================================================
   Fake ZKTeco terminal — for testing the bridge without real hardware.

   Serves the same /iclock/ HTTP interface a K40 or K50i does, and invents
   plausible punches. Two firmware dialects are available so the bridge's
   parser is exercised against both:

     --format=tab    (default, mimics the K40)  tab separated, no XML
     --format=xml    (mimics newer K50i firmware) <ATTLOG><Row>…</Row></ATTLOG>

   It also supports the device-initiated push mode, so you can point a real
   terminal at the simulator and confirm the push endpoints work.

   Usage:
     node simulator.js --port 8801 --id K40   --format=tab
     node simulator.js --port 8802 --id K50i  --format=xml
     node simulator.js --port 8801 --id K40   --push http://localhost:8787
   ========================================================================== */

'use strict';

const http = require('node:http');

const argv = process.argv.slice(2);
/* Accepts both `--key value` and `--key=value`. */
const arg = (k, d) => {
  const inline = argv.find((a) => a.startsWith('--' + k + '='));
  if (inline) return inline.slice(k.length + 3);
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.some((a) => a === '--' + k || a.startsWith('--' + k + '='));

const PORT = Number(arg('port', 8801));
const ID = arg('id', 'K40');
const SN = arg('sn', String(ID).toUpperCase().replace(/[^A-Z0-9]/g, '') + '123456789');
const FORMAT = arg('format', 'tab');
const PUSH = arg('push', '');
const AUTO_PUSH = has('push');

/* Fake staff — pin and name, the way a terminal stores them. */
const STAFF = [
  { pin: '101', name: 'Ayesha Khan' },
  { pin: '102', name: 'Rakib Hasan' },
  { pin: '103', name: 'Nadia Islam' },
  { pin: '104', name: 'Tanvir Ahmed' },
  { pin: '105', name: 'Sadia Afreen' },
  { pin: '106', name: 'Imran Hossain' },
  { pin: '201', name: 'Farhana Akter' },
  { pin: '202', name: 'Jahid Alam' },
  { pin: '901', name: 'Unknown Contractor' }
];

const store = [];              // { pin, at: Date, verify }
let watermark = 0;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function seedToday() {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plans = [
    { pin: '101', inH: 8, inM: 47, outH: 18, outM: 12, v: 15 },
    { pin: '102', inH: 8, inM: 58, outH: 18, outM: 4, v: 1 },
    { pin: '103', inH: 9, inM: 22, outH: 18, outM: 30, v: 15 },
    { pin: '104', inH: 9, inM: 6, outH: 14, outM: 20, v: 1 },
    { pin: '105', inH: 8, inM: 40, outH: 18, outM: 20, v: 2 },
    { pin: '106', inH: 9, inM: 55, outH: 18, outM: 1, v: 15 },
    { pin: '201', inH: 8, inM: 35, outH: 17, outM: 50, v: 15 },
    { pin: '202', inH: 12, inM: 30, outH: 18, outM: 15, v: 1 }
  ];
  for (const p of plans) {
    const a = new Date(day); a.setHours(p.inH, p.inM, 0, 0);
    const b = new Date(day); b.setHours(p.outH, p.outM, 0, 0);
    store.push({ pin: p.pin, at: a, verify: p.v });
    store.push({ pin: p.pin, at: b, verify: p.v });
  }
  /* One deliberately unmapped person, to exercise the matching screen. */
  const u = new Date(day); u.setHours(9, 15, 0, 0);
  store.push({ pin: '901', at: u, verify: 15 });
  store.sort((x, y) => x.at - y.at);
}
seedToday();

/** Add a fresh punch a few seconds ago, as if someone just badged in. */
function addLivePunch() {
  const staff = STAFF[Math.floor(Math.random() * STAFF.length)];
  const rec = { pin: staff.pin, at: new Date(Date.now() - 4000), verify: [1, 2, 15][Math.floor(Math.random() * 3)] };
  store.push(rec);
  return staff;
}

function rowsSince(stampSec) {
  const cut = Number(stampSec || 0) * 1000;
  return store.filter(r => Math.floor(r.at.getTime() / 1000) > cut);
}

function renderTab(rows) {
  return rows.map((r, i) =>
    [i + 1, r.pin, r.verify, stamp(r.at), 0, '', ''].join('\t')
  ).join('\n');
}
function renderXml(rows) {
  const body = rows.map((r, i) =>
    `<Row><Index>${i + 1}</Index><Pin>${r.pin}</Pin><DateTime>${stamp(r.at)}</DateTime>` +
    `<Verify>${r.verify}</Verify><WorkCode>0</WorkCode><Reserved1></Reserved1></Row>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ATTLOG>\n${body}\n</ATTLOG>`;
}

async function pushNow() {
  if (!PUSH) return;
  const rows = rowsSince(watermark);
  if (!rows.length) return;
  const base = PUSH.replace(/\/$/, '');
  /* Mirror the real device-initiated push: one ATTLOG command per punch. */
  for (const r of rows) {
    const u = `${base}/iclock/devicecmd?SN=${SN}&cmd=ATTLOG&Pin=${encodeURIComponent(r.pin)}` +
              `&DateTime=${encodeURIComponent(stamp(r.at))}&Verify=${r.verify}&WorkCode=0`;
    try { const res = await fetch(u, { method: 'GET' }); await res.text(); }
    catch (e) { console.log('  push failed:', e.message); return; }
  }
  watermark = Math.floor(rows[rows.length - 1].at.getTime() / 1000);
  /* Devices also announce themselves and ask for work, as they do on a
     real deployment. Expose those so the bridge's replies are exercised. */
  for (const t of [`${base}/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1`, `${base}/iclock/getrequest?SN=${SN}`]) {
    try { const res = await fetch(t); await res.text(); } catch (_) {}
  }
  console.log(`  pushed ${rows.length} punch(es) to bridge`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const sn = url.searchParams.get('SN') || url.searchParams.get('deviceSN') || SN;
  const stampParam = url.searchParams.get('Stamp') || 0;
  const text = (body) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); };

  if (p === '/iclock/cdata') {
    return text(`GET OPTION FROM: ${SN}\n\nStamp=9999999999\nOpStamp=${Math.floor(Date.now() / 1000)}\nErrorDelay=30\nTimeZone=6\n`);
  }
  if (p === '/iclock/getrequest') return text('OK ' + Math.floor(Date.now() / 1000));
  if (p === '/iclock/user') {
    return text(STAFF.map(s => [s.pin, s.name, 14, 1].join('\t')).join('\n'));
  }
  if (p === '/iclock/records') {
    const rows = rowsSince(stampParam);
    if (!rows.length) return text('');
    return text(FORMAT === 'xml' ? renderXml(rows) : renderTab(rows));
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log(`  Simulated ZKTeco ${ID}  ·  ${FORMAT.toUpperCase()} firmware  ·  http://127.0.0.1:${PORT}`);
  console.log(`  serial ${SN}  ·  ${STAFF.length} staff  ·  ${store.length} punch(es) seeded for today`);
  if (PUSH) console.log(`  push target ${PUSH}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

setInterval(() => {
  if (Math.random() > 0.35) { const s = addLivePunch(); console.log(`  ${new Date().toLocaleTimeString('en-GB', { hour12: false })}  ${s.name} badged in`); }
  pushNow().catch(() => {});
}, 30000);

setTimeout(() => pushNow().catch(() => {}), 4000);

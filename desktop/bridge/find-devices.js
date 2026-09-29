#!/usr/bin/env node
/* ==========================================================================
   Find ZKTeco terminals on the local network.

   Scans the local subnet for hosts serving the ZKTeco /iclock interface and
   reports what each one is. Read-only: it only issues GETs to the two paths
   a terminal already serves to any browser on the LAN.

     node find-devices.js
     node find-devices.js --subnet 192.168.1
   ========================================================================== */

'use strict';

const http = require('node:http');
const os = require('node:os');
const https = require('node:https');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const inline = argv.find((a) => a.startsWith('--' + k + '='));
  if (inline) return inline.slice(k.length + 3);
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const only = arg('subnet', '');

function localIPv4() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      out.push({ name, address: i.address, netmask: i.netmask });
    }
  }
  return out;
}

function probe(host, port, path, timeout = 2500) {
  return new Promise((resolve) => {
    const mod = port === 443 ? https : http;
    const started = Date.now();
    const req = mod.request(
      { host, port, path, method: 'GET', timeout, headers: { 'User-Agent': 'AMAYA-Finder/1.0', Connection: 'close' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => { if (chunks.length < 400) chunks.push(c); });
        res.on('end', () => resolve({
          ok: true, status: res.statusCode, server: res.headers.server || '',
          body: Buffer.concat(chunks).toString('utf8').slice(0, 1200), ms: Date.now() - started
        }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });
}

/** Decide whether a response looks like a biometric terminal, not a printer or router. */
function classify(r) {
  if (!r || !r.ok) return null;
  const body = r.body || '';
  const server = (r.server || '').toLowerCase();

  // Strongest signal: the iclock device-info page.
  if (/\/iclock\/(cdata|getrequest|user|records)/i.test(body) ||
      /(deviceSN|GET OPTION FROM|OpStamp|ErrorDelay)/i.test(body) ||
      /^OK\s+\d{9,}/.test(body.trim()) ||
      /<ATTLOG>/i.test(body) || /<USER>/i.test(body)) {
    const sn = (body.match(/(?:deviceSN|SN)\s*[=:]\s*([A-Za-z0-9]{6,})/i) || [])[1] || '';
    const name = (body.match(/deviceName\s*[=:]\s*"?([^"\r\n,]+)"?/i) || [])[1] || '';
    const fw = (body.match(/(?:firmware|ver)[^0-9]{0,4}(\d[\w.]*)/i) || [])[1] || '';
    const users = (body.match(/userCount\s*[=:]\s*(\d+)/i) || [])[1] || '';
    const records = (body.match(/recordCount\s*[=:]\s*(\d+)/i) || body.match(/attLogCount\s*[=:]\s*(\d+)/i) || [])[1] || '';
    return { kind: 'zkteco', sn, name, fw, users, records };
  }

  // Weaker but still useful: a device that serves /iclock/ at all.
  if (server.includes('nginx') || server.includes('lighttpd') || server.includes('uhttpd')) return null;
  if (/\/iclock\/?/.test(body) || /iclock/i.test(body)) return { kind: 'iclock?' };
  return null;
}

const PORTS = [80, 8080, 8000, 443];

async function checkHost(ip) {
  for (const port of PORTS) {
    const r = await probe(ip, port, '/iclock/cdata?options=all&pushver=2.4.1&language=69', port === 443 ? 3000 : 2000);
    if (!r.ok) continue;
    const hit = classify(r);
    if (!hit) continue;

    /* Confirm by asking for actual attendance records. A real terminal with
       punches returns rows; an empty buffer is still a valid confirmation. */
    const rec = await probe(ip, port, '/iclock/records?table=ATTLOG&type=1&limit=3', 2500);
    const hasRecords = !!(rec && rec.ok && rec.body && rec.body.trim().length > 2);
    return { ip, port, ...hit, recordsReply: hasRecords ? rec.body.slice(0, 120) : null, ms: r.ms };
  }
  return null;
}

async function pool(items, size, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { const v = await fn(items[idx]); if (v) results.push(v); } catch (_) {}
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const ifaces = localIPv4();
  console.log('\n  Scanning for ZKTeco terminals');
  console.log('  =============================\n');
  ifaces.forEach(i => console.log(`  ${i.address}  (${i.name}, mask ${i.netmask})`));

  let subnets = [];
  if (only) {
    subnets = [only];
  } else {
    subnets = ifaces.map(i => i.address.split('.').slice(0, 3).join('.'));
  }
  subnets = [...new Set(subnets)];

  for (const subnet of subnets) {
    const hosts = [];
    for (let h = 1; h <= 254; h++) hosts.push(`${subnet}.${h}`);
    console.log(`\n  Probing ${subnet}.1-254 on ports ${PORTS.join(', ')} …`);
    const found = await pool(hosts, 48, checkHost);
    if (!found.length) {
      console.log(`    no terminals found in ${subnet}.0/24`);
      continue;
    }
    console.log(`\n    FOUND ${found.length} terminal(s):\n`);
    found.forEach((f, n) => {
      console.log(`    [${n + 1}] http://${f.ip}:${f.port}`);
      console.log(`        serial   ${f.sn || 'not reported'}`);
      if (f.name) console.log(`        name     ${f.name}`);
      if (f.fw) console.log(`        firmware ${f.fw}`);
      if (f.users) console.log(`        users    ${f.users}`);
      if (f.records) console.log(`        punches  ${f.records}`);
      console.log(`        latency  ${f.ms} ms`);
      if (f.recordsReply) console.log(`        sample   ${f.recordsReply.replace(/\s+/g, ' ').slice(0, 90)}`);
      console.log('');
    });
    console.log(`    Add to bridge\\devices.json:\n`);
    console.log('    "devices": [');
    found.forEach((f, n) => {
      const model = f.name || (f.sn && /K50/i.test(f.sn) ? 'ZK K50i' : 'ZK terminal');
      console.log(`      { "id": "${f.sn || 'ZK' + (n + 1)}", "model": "${model}", "host": "${f.ip}", "port": ${f.port}, "sn": "${f.sn}", "site": "Main House", "enabled": true }${n < found.length - 1 ? ',' : ''}`);
    });
    console.log('    ]\n');
  }
}

main();

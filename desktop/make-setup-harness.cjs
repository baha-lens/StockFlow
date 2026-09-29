/* Builds a test harness for the setup window.

   The real window talks to the main process over the `window.sf` preload
   bridge. Injecting a stub in its place lets the window's own logic be driven
   in a plain browser, which is the only way to check it without a Windows
   desktop session. Generated file is disposable.

     node make-setup-harness.cjs
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'windows');
const html = fs.readFileSync(path.join(dir, 'setup.html'), 'utf8');

/* A stub that answers like the main process would, including the awkward parts:
   a port conflict, a terminal that is offline, and an empty terminal list. */
const stub = `
<script>
/* --- stub of the preload bridge --------------------------------------- */
const NOW = new Date().toISOString();
const DEVICES = [
  { id:'K40',  model:'ZK K40',  host:'192.168.31.201', port:80, sn:'8BGDD18507000028', site:'Main House', enabled:true,
    online:true,  latencyMs:7,  lastOk:NOW, lastError:null, lastAdded:3, parseWarning:null },
  { id:'K50i', model:'ZK K50i', host:'192.168.31.202', port:80, sn:'',               site:'New House',  enabled:true,
    online:false, latencyMs:null, lastOk:null, lastError:'connect ECONNREFUSED', lastAdded:0,
    parseWarning:'unrecognised response' }
];
let S = {
  port:8787, lanOnly:true, startWithWindows:false, startMinimised:true, closeToTray:true,
  setupDone:false, devices:DEVICES,
  shift:{ start:'09:00', end:'18:00', graceMinutes:10, earlyLeaveGraceMinutes:15, halfDayHours:4, weekendDays:[5,6] }
};
const U = () => ({
  address:'192.168.31.72', port:S.port,
  app:\`http://192.168.31.72:\${S.port}/\`,
  status:\`http://192.168.31.72:\${S.port}/status\`,
  live:\`http://192.168.31.72:\${S.port}/live?token=TESTTOKEN\`,
  localhost:\`http://127.0.0.1:\${S.port}/\`
});
window.sf = {
  getSettings: async () => ({ settings:S, urls:U(), status:DEVICES, running:true,
    settingsPath:'C:\\\\Users\\\\abthe\\\\AppData\\\\Roaming\\\\AMAYA ERP\\\\settings.json',
    appPath:'…\\\\app\\\\index.html', version:'1.0.0' }),
  saveSettings: async (patch) => { Object.assign(S, patch); return { ok:true, settings:S, urls:U() }; },
  startHost: async () => ({ ok:true }),
  stopHost: async () => ({ ok:true }),
  restartHost: async () => ({ ok:true, port:S.port }),
  status: async () => ({ running:true, uptimeSec:9274, lastRun:NOW, devices:DEVICES, punches:1284, addresses:U() }),
  diagnose: async () => '  K40  (ZK K40)  http://192.168.31.201\\n' +
    '    serial: 8BGDD18507000028\\n' +
    '    HTTP 200  17 record(s) parsed\\n' +
    '    raw: 1\\t201\\t15\\t2026-09-27 08:35:00\\t0\\t2\\t105\\t2\\t…\\n' +
    '      · {"pin":"201","verify":15,"verifyName":"Face"}\\n\\n' +
    '  K50i (ZK K50i)  http://192.168.31.202\\n' +
    '    serial: not detected\\n    ERROR connect ECONNREFUSED\\n',
  scanDevices: async () => ({ ok:true, output:'  Probing 192.168.31.1-254 …\\n\\n    FOUND 1 terminal(s):\\n\\n    [1] http://192.168.31.201\\n        serial   8BGDD18507000028\\n        users    412\\n' }),
  openExternal: async (u) => { window.__opened = u; return true; },
  copy: async (t) => { window.__copied = t; return true; },
  startTunnel: async () => ({ ok:false, error:'cloudflared is not installed.' }),
  revealData: async () => { window.__revealed = true; return true; },
  completeSetup: async () => { window.__done = true; return { ok:true }; },
  appInfo: async () => ({ version:'1.0.0', node:'33.4.11', chrome:'130' }),
  close: async () => { window.__closed = true; }
};
</script>
`;

/* Insert the stub immediately before the window's own script. */
const out = html.replace('<script src="setup.js"></script>', stub + '<script src="setup.js"></script>');
fs.writeFileSync(path.join(dir, '_harness.html'), out);
console.log('  wrote windows/_harness.html');

/* Cross-check the IPC surface: every channel the main process handles must be
   reachable from the setup window through the preload bridge, and every method
   the window calls must exist. Run with:  node check-ipc.cjs                */

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const main = fs.readFileSync(path.join(here, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(here, 'preload.js'), 'utf8');
const setup = fs.readFileSync(path.join(here, 'windows', 'setup.js'), 'utf8');

const channels = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]);
const exposed = new Set([...preload.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]));
const called = new Set([...setup.matchAll(/window\.sf\.(\w+)/g)].map(m => m[1]));

/* Channel name → preload method name. They are not always a literal strip, so
   resolve by asking the preload map for a channel string it forwards. */
const forwarded = new Map();
for (const m of preload.matchAll(/(\w+):\s*\(?[^)]*?\)?\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g)) {
  forwarded.set(m[2], m[1]);
}

let bad = 0;

const noBridge = channels.filter(ch => !forwarded.has(ch));
if (noBridge.length) {
  console.error(`  FAIL — ${noBridge.length} channel(s) handled but not forwarded by preload:`);
  noBridge.forEach(c => { console.error('    ' + c); bad++; });
}

/* A method the window calls must forward to a channel that exists. */
for (const [channel, method] of forwarded) {
  if (!channels.includes(channel)) {
    console.error(`  FAIL — preload forwards "${channel}" to "${method}" but main.js handles nothing by that name.`);
    bad++;
  }
}

const notExposed = [...called].filter(m => !exposed.has(m));
if (notExposed.length) {
  console.error(`  FAIL — setup window calls ${notExposed.length} method(s) preload does not expose:`);
  notExposed.forEach(m => { console.error('    sf.' + m); bad++; });
}

/* Anything preload exposes that nothing calls is dead surface. */
const unused = [...forwarded.values()].filter(m => !called.has(m));
if (unused.length) {
  console.warn(`  note — exposed but not called from the setup window: ${unused.join(', ')}`);
}

if (bad) process.exit(1);
console.log(`  guard ok — ${channels.length} channels, ${exposed.size} exposed methods, ${called.size} used, all wired`);

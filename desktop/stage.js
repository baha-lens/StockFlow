/* ==========================================================================
   Stage the files the desktop build needs.

   The Electron app is built from desktop/, but the ERP bundle and the bridge
   live one level up. This copies exactly what is required into desktop/, so
   the packaged app is self-contained. Run before electron-builder:

     node stage.js            copy and report
     node stage.js --check    verify only, fail if something is missing
   ========================================================================== */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const SRC = path.join(HERE, '..');
const CHECK = process.argv.includes('--check');

/** [source, destination] — the app bundle, and the parts of the bridge it uses. */
const ITEMS = [
  ['index.html', 'app/index.html'],
  ['bridge/bridge.js', 'bridge/bridge.js'],
  ['bridge/find-devices.js', 'bridge/find-devices.js'],
  ['bridge/devices.example.json', 'bridge/devices.example.json'],
  ['bridge/package.json', 'bridge/package.json']
];

let missing = [];
let copied = 0;

for (const [rel, dest] of ITEMS) {
  const from = path.join(SRC, rel);
  const to = path.join(HERE, dest);

  if (!fs.existsSync(from)) {
    missing.push(rel);
    continue;
  }

  const src = fs.readFileSync(from);
  const alreadyThere = fs.existsSync(to) && Buffer.compare(fs.readFileSync(to), src) === 0;
  if (alreadyThere) continue;

  if (!CHECK) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, src);
  }
  copied++;
  console.log(`  ${alreadyThere ? 'same' : CHECK ? 'would copy' : 'copied'}  ${(src.length / 1024).toFixed(1).padStart(7)} KB  ${dest}`);
}

if (missing.length) {
  console.error('\n  Missing source files:');
  missing.forEach(m => console.error('    ' + m));
  console.error('\n  Build the app bundle first:  cd .. && .\\build.ps1\n');
  process.exit(1);
}

if (CHECK) console.log('  all staged files present');
else console.log(`\n  staged ${ITEMS.length} file(s), ${copied} updated`);

/* Verifies that a signed release APK still contains everything the Capacitor
 * bridge resolves at runtime.
 *
 * A Capacitor app is a WebView wrapper, so the Java side has no compile-time
 * caller for the plugin classes. R8 sees them as unreachable and strips them.
 * The APK still launches, every page still works, and then every plugin call
 * fails at runtime — camera, file export, share sheet and the Android back
 * button all stop working with no build-time warning and nothing in the gradle
 * log to grep for.
 *
 * The contract is assets/capacitor.plugins.json: the Bridge reads it at startup
 * and does Class.forName on every classpath in it. So rather than hardcoding a
 * list of class names (which is how the first version of this check reported
 * five false failures — the real classes are com.capacitorjs.plugins.*, not
 * com.getcapacitor.*), read that manifest and verify each entry against the
 * dex. Also confirm the classes are not obfuscated, because a renamed class is
 * just as unreachable to Class.forName as a missing one.
 *
 * Usage:
 *   node tools/verify-release-apk.js <path-to-apk>
 */
const fs = require('fs');
const zlib = require('zlib');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Read every entry of a zip, keyed by name, inflated as needed. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`not a zip: ${file} has no end-of-central-directory record`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`bad central directory entry at offset ${p} in ${file}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`${name}: unsupported zip method ${method}`);

    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const apk = process.argv[2];
if (!apk) {
  console.error('usage: node tools/verify-release-apk.js <path-to-apk>');
  process.exit(2);
}
if (!fs.existsSync(apk)) {
  console.error(`not found: ${apk}`);
  process.exit(2);
}

const entries = readZip(apk);
const dex = [...entries.entries()]
  .filter(([name]) => /^classes\d*\.dex$/.test(name))
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([, data]) => data);

if (!dex.length) {
  console.error('no classes*.dex in the APK');
  process.exit(2);
}
const hay = Buffer.concat(dex);
const text = hay.toString('latin1');

/* Class type descriptor as it appears in the dex string table. */
const descriptor = fqcn => 'L' + fqcn.replace(/\./g, '/') + ';';

/* The app entry point named in AndroidManifest.xml, plus the bridge itself. */
const CORE = [
  'com.amaya.industries.erp.MainActivity',
  'com.getcapacitor.Bridge',
  'com.getcapacitor.Plugin',
  'com.getcapacitor.annotation.CapacitorPlugin'
];

/* Read the manifest the Bridge actually uses. */
const pluginsJson = entries.get('assets/capacitor.plugins.json');
let registered = [];
if (pluginsJson) {
  try {
    registered = JSON.parse(pluginsJson.toString('utf8'));
  } catch (e) {
    console.error(`assets/capacitor.plugins.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

/* The web bundle is the whole product; if it is missing the app is a shell. */
const webBundle = [...entries.keys()].filter(n => n.startsWith('assets/public/') && n.endsWith('.html'));

console.log(`apk    ${apk}`);
console.log(`size   ${(fs.statSync(apk).size / 1048576).toFixed(2)} MB`);
console.log(`dex    ${dex.length} file(s), ${(hay.length / 1048576).toFixed(2)} MB`);
console.log(`web    ${webBundle.length ? webBundle.join(', ') : '*** NO HTML IN assets/public ***'}`);
console.log('');

const failures = [];

for (const fqcn of CORE) {
  const ok = text.includes(descriptor(fqcn));
  if (!ok) failures.push(`${fqcn} — missing from the dex`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${fqcn}`);
}

console.log('');
if (!pluginsJson) {
  console.log('  warn  assets/capacitor.plugins.json not found; skipping plugin check.');
  console.log('        Without it no Capacitor plugin can be registered at all.');
  failures.push('assets/capacitor.plugins.json missing');
} else {
  console.log(`  ${registered.length} Capacitor plugin(s) registered:`);
  for (const reg of registered) {
    /* A renamed class is as unreachable to Class.forName as a missing one, so
     * checking the exact name is the whole test. */
    const ok = text.includes(descriptor(reg.classpath));
    if (!ok) failures.push(`${reg.pkg} → ${reg.classpath} — missing or renamed`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${reg.pkg.padEnd(24)} ${reg.classpath}`);
  }
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} problem(s):`);
  failures.forEach(f => console.log(`  - ${f}`));
  console.log('');
  console.log('The app would launch and then fail on every Capacitor call:');
  console.log('camera, file export, share sheet and the Android back button.');
  console.log('Add matching -keep rules to app/proguard-rules.pro, or set');
  console.log('minifyEnabled false until the bridge is verified on a device.');
  process.exit(1);
}

console.log('bridge intact: core classes present and no plugin class was stripped or renamed.');

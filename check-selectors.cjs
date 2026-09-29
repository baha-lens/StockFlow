/* Build-time guard for the bundled app.
 *
 * Check 1 — `$` is id-based (getElementById), `qs` is the selector helper.
 *          Passing a CSS selector to `$` returns null silently, so catch it
 *          here rather than in the browser.
 *
 * Check 2 — a name may not be declared twice. The bundle concatenates every
 *          module into one IIFE, so a duplicate `const` in two modules is a
 *          SyntaxError that only appears at runtime.
 */
const fs = require('node:fs');
const path = require('node:path');

/* Check the file we were actually asked to build. Hard-coding `index.html`
 * meant a build to any other destination (e.g. mobile/www) silently checked
 * a stale artifact and let real mistakes through. */
const target = process.argv[2]
  ? path.resolve(__dirname, process.argv[2])
  : path.join(__dirname, 'index.html');

if (!fs.existsSync(target)) {
  console.error(`  guard — nothing to check, ${target} does not exist`);
  process.exit(1);
}
const html = fs.readFileSync(target, 'utf8');

/* The output can contain more than one script: build.ps1 may prepend the
 * esbuild-bundled Capacitor plugins. Take the app bundle, not simply the first
 * tag — otherwise these checks run against the 30 KB plugin bundle and report
 * nothing useful.
 *
 * The bundle is identified by the IIFE opener that build.ps1 writes around the
 * concatenated sources, which is a structural fact rather than a brand name, so
 * it survives a rebrand. The version banner is accepted as a fallback.
 *
 * If neither is found the guard ABORTS. The previous version fell through to
 * "whichever script is longest", which means that the day the marker stopped
 * matching, this guard would have silently inspected some other script and
 * reported success while checking none of the app. A build guard that can pass
 * vacuously is worse than no build guard, because it is trusted.
 */
const APP_MARKERS = ["(function(){'use strict'", 'AMAYA ERP v'];
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.find(s => APP_MARKERS.some(mk => s.includes(mk)));

if (!js) {
  console.error('  guard — no app bundle found in the output.');
  console.error(`    looked for ${APP_MARKERS.map(m => JSON.stringify(m)).join(' or ')}`);
  console.error(`    ${scripts.length} <script> tag(s) present, sizes: ${scripts.map(s => (s.length / 1024).toFixed(0) + ' KB').join(', ') || 'none'}`);
  console.error('    if the app wrapper in build.ps1 changed, update APP_MARKERS here.');
  process.exit(1);
}

/* --- check 1: selectors passed to $() ------------------------------------- */

const bad = [];
const re = /(?<!\$)\$(?!\$)\(\s*(['"`])\s*[\[.#]/g;
let m;
while ((m = re.exec(js)) !== null) {
  const line = js.slice(0, m.index).split('\n').length;
  bad.push(`line ${line}: ${js.slice(m.index, js.indexOf('\n', m.index)).trim().slice(0, 100)}`);
}

if (bad.length) {
  console.error(`\n  FAIL — ${bad.length} call(s) pass a CSS selector to \`$\` (id lookup):`);
  bad.forEach(b => console.error('    ' + b));
  console.error('    Use `qs(sel, root)` for selectors and `$$(sel, root)` for a list.\n');
  process.exit(1);
}

/* --- check 2: duplicate top-level declarations ----------------------------
   Anchored to column 0. Everything the bundle defines at the top level of the
   IIFE is flush left; locals, object-literal methods and class methods are all
   indented, so anchoring is what keeps this from flagging ordinary variables
   like `d` or `s` that are reused across modules. A genuine collision — two
   modules both declaring `const DB` — is a SyntaxError that would otherwise
   only surface at runtime. */

const seen = new Map();
const dups = [];
const declRe = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
while ((m = declRe.exec(js)) !== null) {
  const name = m[1];
  const line = js.slice(0, m.index).split('\n').length;
  if (seen.has(name)) {
    dups.push(`${name} — line ${seen.get(name)} and line ${line}`);
  } else {
    seen.set(name, line);
  }
}

if (dups.length) {
  console.error(`\n  FAIL — ${dups.length} name(s) declared more than once (SyntaxError at load):`);
  dups.slice(0, 20).forEach(d => console.error('    ' + d));
  if (dups.length > 20) console.error(`    ... and ${dups.length - 20} more`);
  process.exit(1);
}

/* --- check 3: the bundle must actually parse -------------------------------
   Neither regex check above can see a syntax error: a stray quote or an
   unterminated template literal leaves every pattern here perfectly happy while
   the app dies on the first line of the script. Compiling the bundle is the
   only check that catches it, and it is cheap.
   This is what let 12-native.js and 13-attachments.js ship with a trailing
   `"` and produce a build that rendered nothing at all. */

try {
  new Function(js);
} catch (e) {
  console.error(`\n  FAIL — the bundle does not parse: ${e.message}`);
  console.error(`    ${target}`);
  /* `new Function` gives no position, so re-throw through vm to get a line. */
  try {
    require('node:vm').compileFunction(js, [], { filename: target });
  } catch (e2) {
    const lineMatch = /:(\d+)$/.exec(String(e2.stack || '').split('\n')[0]);
    if (lineMatch) console.error(`    first problem near line ${lineMatch[1]}`);
  }
  process.exit(1);
}

console.log(`  guard ok — bundle parses, no CSS selectors passed to $(), no duplicate declarations (${seen.size} names)`);

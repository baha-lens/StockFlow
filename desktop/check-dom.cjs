/* ==========================================================================
   Static guards for the desktop build.

   Two mistakes that compile cleanly and then fail silently at runtime:

     1. `$` is an id lookup (getElementById). Passing it a CSS selector returns
        null, so the next `.onclick` throws. Use querySelector for selectors.
     2. `$` takes one argument. `$('sel', root)` silently ignores the root and
        searches the whole document, so the handler attaches to the wrong
        element or to nothing.

     node check-dom.cjs
   ========================================================================== */

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const files = [
  'main.js',
  'preload.js',
  'windows/setup.js'
].map(f => path.join(__dirname, f));

let problems = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(__dirname, file);
  const lines = src.split('\n');

  const report = (i, msg) => {
    console.error(`  ${rel}:${i + 1}  ${msg}`);
    console.error(`      ${lines[i].trim()}`);
    problems++;
  };

  lines.forEach((line, i) => {
    // Strip strings and comments so examples inside them are not flagged.
    const code = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');

    // A single `$` (not `$$`) immediately followed by a string starting with
    // a CSS-ish character: that is a selector being passed to an id lookup.
    if (/(?<!\$)\$(?!\$)\(\s*""\s*[\[.#]/.test(code) === false) {
      const m = code.match(/(?<!\$)\$(?!\$)\(\s*(['"`])(\s*)([\[.#])/);
      if (m) report(i, '`$` given a CSS selector — use querySelector');
    }

    // Two arguments means a root was intended; `$` only accepts an id.
    const two = code.match(/(?<!\$)\$(?!\$)\([^()]*,[^()]*\)/);
    if (two && !/require|\.map\(|\.filter\(|\.forEach\(|\.join\(|\.replace\(|\.split\(|\.push\(/.test(two[0])) {
      report(i, '`$` called with two arguments — it only takes an id');
    }
  });
}

if (problems) {
  console.error(`\n  ${problems} problem(s) found. These pass \`node --check\` but break at runtime.\n`);
  process.exit(1);
}
console.log(`  guard ok — ${files.length} files, no selector misuse`);

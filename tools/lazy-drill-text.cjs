/* One-shot source transform: make every drill `foot`/`sub` lazy.
 *
 * The bug: a drill spec is a plain object literal, so `foot: ` + backtick
 * template was evaluated when `Drill.register()` was called during boot().
 * Every totals row in the app was therefore frozen at the counts that existed
 * the moment the app loaded, and stayed wrong for the whole session.
 *
 * The fix is textual, because once the template has been interpolated the
 * information is gone — register() cannot tell a constant footer from one that
 * used to read the database. Wrapping the template in an arrow function defers
 * it to Drill.open(), which is where it belongs.
 *
 * Backticks are matched with a brace-aware scan rather than a regex, so a
 * `${ ... }` interpolation containing a string, or a nested backtick, cannot
 * end the match early.
 *
 * Run: node tools\lazy-drill-text.cjs        (idempotent)
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'js', '17-drills.js');
let src = fs.readFileSync(file, 'utf8');
let changed = 0, skipped = 0;

const OPENERS = ['foot:', 'sub:'];

/** Given the index just past an opening backtick, return the index of its mate. */
function closeBacktick(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '$' && s[i + 1] === '{') { depth++; i++; continue; }
    if (c === '}' && depth > 0) { depth--; continue; }
    if (c === '`' && depth === 0) return i;
  }
  return -1;
}

for (const key of OPENERS) {
  let at = 0;
  for (;;) {
    const hit = src.indexOf(key + ' `', at);
    if (hit < 0) break;
    const tick = hit + key.length + 2;
    const end = closeBacktick(src, tick);
    if (end < 0) { at = tick; continue; }

    const before = src.slice(Math.max(0, hit - 8), hit);
    // Already lazy? (`foot: () =>` has no space before the backtick, but a
    // hand-written `foot: () =>`x`` would land here — guard on the arrow.)
    const afterTick = src.slice(tick, tick + 9);
    if (/^\s*\(/.test(afterTick) === false && /=>\s*$/.test(before)) { at = end + 1; skipped++; continue; }
    if (/^\s*\(/.test(afterTick)) { at = end + 1; skipped++; continue; }

    src = src.slice(0, hit + key.length + 1) + ' () => ' + src.slice(tick, end + 1) + src.slice(end + 1);
    changed++;
    at = hit + key.length + 9;
  }
}

fs.writeFileSync(file, src, 'utf8');
console.log(`lazy-drill-text: ${changed} template(s) made lazy, ${skipped} already lazy`);

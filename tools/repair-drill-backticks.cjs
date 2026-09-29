/* Repair pass for tools\lazy-drill-text.cjs.
 *
 * The first run computed the opening backtick one position too far right, so
 * it sliced from *after* the opening tick to *at* the closing tick. Every
 * transformed template lost its opening backtick and kept its closing one,
 * turning `foot: `x`` into `foot: () => x``.
 *
 * The damage is exactly invertible: for each `foot:  () => ` / `sub:  () => `
 * site, scan forward with the same brace-aware backtick matcher to find the
 * orphaned closing tick, then put the opening tick back and drop the orphan.
 *
 * Run: node tools\repair-drill-backticks.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'js', '17-drills.js');
let src = fs.readFileSync(file, 'utf8');

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

let repaired = 0, at = 0;
for (;;) {
  const m = /((?:foot|sub):\s*\(\)\s*=>\s*)/.exec(src.slice(at));
  if (!m) break;
  const leadStart = at + m.index;
  const leadEnd = leadStart + m[1].length;

  // The character that should have been the opening tick.
  if (src[leadEnd - 1] === '`') { at = leadEnd; continue; }

  const orphan = closeBacktick(src, leadEnd);
  if (orphan < 0) { at = leadEnd; continue; }

  src = src.slice(0, leadEnd) + '`'
      + src.slice(leadEnd, orphan)
      + src.slice(orphan + 1);
  repaired++;
  at = leadEnd + 1;
}

fs.writeFileSync(file, src, 'utf8');
console.log(`repair-drill-backticks: ${repaired} template(s) restored`);

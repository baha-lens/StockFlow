/* Second repair pass: restore the closing backtick on every lazy template.
 *
 * State of the file now: each `foot:  () => ` / `sub:  () => ` site has its
 * OPENING backtick (restored by repair-drill-backticks.cjs) but is missing the
 * CLOSING one, because that pass removed the wrong tick.
 *
 * The template body always runs to the property-terminating comma, or to the end
 * of the line when the property is last in its object. So the closing tick goes
 * immediately before the line's final comma — never inside a `${ }`, because
 * the last comma on these lines is the separator, not part of an expression.
 *
 * Run: node tools\close-drill-backticks.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'js', '17-drills.js');
const TICK = String.fromCharCode(96);
const lines = fs.readFileSync(file, 'utf8').split('\n');

const SITE = /(?:foot|sub):\s*\(\)\s*=>\s*`/;
let fixed = 0;
const skipped = [];

lines.forEach((line, idx) => {
  if (!SITE.test(line)) return;
  const ticks = line.split(TICK).length - 1;
  if (ticks === 2) return;                 // already balanced
  if (ticks !== 1) { skipped.push({ line: idx + 1, ticks }); return; }

  const trimmedEnd = line.replace(/\s+$/, '');
  const endsWithComma = trimmedEnd.endsWith(',');
  const body = endsWithComma
    ? trimmedEnd.slice(0, -1)
    : trimmedEnd;

  lines[idx] = body + TICK + (endsWithComma ? ',' : '') + line.slice(trimmedEnd.length);
  fixed++;
});

fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`close-drill-backticks: ${fixed} template(s) closed`);
if (skipped.length) console.log('SKIPPED (unexpected tick count):', JSON.stringify(skipped));

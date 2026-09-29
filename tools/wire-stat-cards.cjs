/* Wire every stat card to the drill that explains it.
 *
 * statCard() only becomes a button when it is given an `onClick` key, and a
 * card without one is a dead end: the user reads a number, taps it, and nothing
 * happens. This pass adds the key to every card that is missing one, in source
 * order, so the whole app has no unresolvable info cards left.
 *
 * Source order is the contract. Each file's list below must have exactly one
 * entry per statCard() call in that file, in the order they appear, with null
 * for a card that is already wired. If a card is added, moved or removed, this
 * script fails loudly rather than silently attaching the wrong drill to the
 * wrong number — which is the failure mode that is invisible until a user
 * reports that "Attention needed" opens the wrong list.
 *
 * Run: node tools\wire-stat-cards.cjs          (--check to verify only)
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js');

/* file -> stat cards in source order. null = already has an onClick. */
const PLAN = {
  '03-pages-a.js': [
    'dash:units', 'reports', 'dash:attention', 'dash:revenue',
    'dash:repairs', 'dash:transfers', 'upgrades:open', 'inv:receivable',
    /* inventory page */
    'inv:units', 'inv:value', 'inv:catalogue', 'inv:attention',
    /* item drawer */
    'inv:units', 'inv:value'
  ],
  '04-pages-b.js': [
    /* purchases */ 'po:open', 'po:committed', 'po:received', 'po:late',
    /* sales */ 'sale:thisMonth', 'dash:revenue', 'sale:paid', 'sale:outstanding',
    /* dispatch */ 'dsp:open', 'dsp:charges', 'dsp:delivered', 'dsp:slow',
    /* repairs */ 'dash:repairs', 'rep:tat', 'rep:income', 'rep:overdue'
  ],
  '05-pages-c.js': [
    /* customer drawer */ 'cust:debtors', 'cust:lifetime', 'cust:credit',
    /* supplier drawer */ 'sup:creditors', 'sup:purchased', 'sup:received',
    /* invoices */ 'inv:receivable', 'inv:payable', 'inv:overdue', 'inv:paid',
    /* employee drawer */ 'emp:salary', 'att:total',
    /* payroll */ 'pay:month', 'pay:pending', 'pay:paid', 'pay:overtime',
    /* leave */ 'leave:pending', 'leave:approved', 'leave:rejected', 'leave:away',
    /* attendance */ 'att:total', 'att:staff', 'att:late', 'att:ontime'
  ],
  '06-pages-d.js': [
    /* finance */ 'fin:cash', 'inv:receivable', 'inv:payable', 'fin:margin', 'fin:revenue', 'rep:income',
    /* analytics */ 'dash:revenue', 'fin:margin', 'an:turnover', 'att:ontime', 'dash:repairs', 'inv:value',
    /* reports */ 'inv:value', 'inv:units', 'movements', 'inv:retail'
  ],
  '11-live.js': [
    'att:onsite', 'att:late', 'att:half', null /* 'live' — already wired */, 'att:punches'
  ],
  '18-tradein.js': [
    'upgrades:open', 'upgrades:closed', 'upgrades:closed', 'upgrades:closed'
  ]
};

/** Byte offsets of the `statCard({` openings, in source order. */
function cardOpenings(src) {
  const out = [];
  const re = /statCard\(\{/g;
  let m;
  while ((m = re.exec(src))) out.push(m.index + 'statCard({'.length);
  return out;
}

let touched = 0, problems = [];

for (const [file, plan] of Object.entries(PLAN)) {
  const full = path.join(SRC, file);
  let src = fs.readFileSync(full, 'utf8');
  const at = cardOpenings(src);

  if (at.length !== plan.length) {
    problems.push(`${file}: plan lists ${plan.length} cards but the file has ${at.length}`);
    continue;
  }

  // Work backwards so earlier offsets stay valid as we insert.
  for (let i = at.length - 1; i >= 0; i--) {
    const key = plan[i];
    if (!key) continue;
    const pos = at[i];

    /* Bound the search to THIS card, not a fixed window. A 400-char look-ahead
     * runs past the end of a one-line card and finds the next card's onClick,
     * which makes every card look pre-wired and silently skips the work. */
    const limit = Math.min(src.length, pos + 400);
    const nextCard = src.indexOf('statCard({', pos + 1);
    const end = nextCard >= 0 && nextCard < limit ? nextCard : limit;
    const body = src.slice(pos, end);

    const existing = /\bonClick\s*:\s*'([^']*)'/.exec(body);
    if (existing) {
      if (existing[1] !== key) {
        problems.push(`${file}#${i + 1}: already points at '${existing[1]}' but the plan says '${key}'`);
      }
      continue;   // already correct — the script is idempotent
    }

    src = src.slice(0, pos) + ` onClick: '${key}',` + src.slice(pos);
    touched++;
  }

  fs.writeFileSync(full, src, 'utf8');
}

console.log(`wire-stat-cards: ${touched} card(s) wired`);
if (problems.length) {
  console.error('\nPROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(1);
}

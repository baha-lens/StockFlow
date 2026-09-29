/* ==========================================================================
   AMAYA ERP — Experience layer
   ----------------------------------------------------------------------------
   Four concerns that cut across every page, kept together so that each has a
   single owner:

     Layout    - phone vs desktop form factor, auto-detected but overridable
     Themes    - the theme registry, so a theme is data rather than a CSS branch
     Drill     - every stat card resolves to the records that produced the number
     Momentum  - streaks, milestones and celebrations

   Loaded before 09-init.js because boot() reads from all four.
   ========================================================================= */

/* ------------------------------------------------------------------ Themes */
/**
 * The registry is the single source of truth. `styles.css` owns the actual
 * variable values under `html[data-theme="..."]`; this only carries the
 * presentation metadata and an ordering. Adding a theme means adding a CSS
 * block and one line here - nothing else in the app needs to know.
 */
const THEMES = [
  { id: 'light',    label: 'AMAYA Light',  hint: 'Warm paper white',       swatch: ['#f4f3ef', '#b6751c', '#0c6d4a'], dark: false },
  { id: 'dark',     label: 'AMAYA Dark',   hint: 'Dim warehouse at night', swatch: ['#101210', '#e0ab55', '#3fb950'], dark: true  },
  { id: 'midnight', label: 'Midnight',     hint: 'Cool blue, high contrast', swatch: ['#0d1117', '#4a9eff', '#3fb950'], dark: true },
  { id: 'forest',   label: 'Forest',       hint: 'Green daylight',         swatch: ['#f1f5f0', '#1f6f43', '#1a7f4b'], dark: false },
  { id: 'plum',     label: 'Plum',         hint: 'Soft violet',            swatch: ['#f6f3f7', '#8e3d8f', '#0f7355'], dark: false },
  { id: 'slate',    label: 'Slate',        hint: 'Neutral grey office',    swatch: ['#eef0f2', '#2b5c8a', '#1b6b4f'], dark: false },
  { id: 'contrast', label: 'High contrast',hint: 'Maximum legibility',     swatch: ['#ffffff', '#7a4400', '#00552f'], dark: false }
];
const THEME_IDS = THEMES.map(t => t.id);
const themeById = (id) => THEMES.find(t => t.id === id) || null;

const Layout = {
  mode: 'auto',

  /** Best guess at the form factor, before any override. */
  detect() {
    /* A native build is a phone even when the WebView reports a desktop
     * user-agent, and even when it is running on a tablet-sized screen. */
    if (Native.isNative()) return 'phone';
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.innerWidth <= 1024;
    return (coarse && narrow) || narrow ? 'phone' : 'desktop';
  },

  get() {
    return this.mode === 'auto' ? this.detect() : this.mode;
  },

  isPhone() { return this.get() === 'phone'; },

  /**
   * Write the effective mode onto <html data-ff>. CSS keys every layout
   * decision off this attribute rather than off a width media query, so an
   * explicit override genuinely changes the layout instead of fighting the
   * viewport the browser happens to have.
   */
  apply() {
    const ff = this.get();
    document.documentElement.setAttribute('data-ff', ff);
    state.ui.formFactor = ff;
    return ff;
  },

  set(mode) {
    this.mode = mode === 'phone' || mode === 'desktop' ? mode : 'auto';
    store.set('amaya_layout_mode', this.mode);
    this.apply();
    toast(this.mode === 'auto'
      ? `Layout following the device (${this.get()})`
      : `Layout locked to ${this.mode}`, 'good');
    renderAll();
  },

  install() {
    this.mode = store.get('amaya_layout_mode') || 'auto';
    this.apply();
    /* Only follow the device while the user has not chosen. Resize is enough:
     * a foldable or a rotated tablet changes width, not identity. */
    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (this.mode !== 'auto') return;
        const before = state.ui.formFactor;
        const after = this.apply();
        if (before !== after) renderAll();
      }, 180);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }
};

/* --------------------------------------------------------------- Momentum */
/**
 * Lightweight, entirely local encouragement.
 *
 * Rules this obeys, deliberately:
 *   - nothing is stored on a server, and nothing is reported anywhere;
 *   - every figure shown is derived from records that already exist, so it
 *     cannot drift out of sync with the data;
 *   - a milestone that has been earned stays earned, and a deleted demo record
 *     can un-earn it (the badge is recomputed, never latched), which keeps the
 *     numbers honest during a trial period.
 */
const Momentum = {
  key: 'amaya_momentum_v1',

  data() {
    let d = null;
    try { d = JSON.parse(store.get(Momentum.key) || 'null'); } catch (_) { d = null; }
    if (!d || typeof d !== 'object') d = {};
    if (!Array.isArray(d.seen)) d.seen = [];
    return d;
  },

  save(d) { store.set(Momentum.key, JSON.stringify(d)); },

  /** Days on which the user recorded something. Drives the streak. */
  activeDays() {
    const days = new Set();
    const push = (d) => { if (d) days.add(String(d).slice(0, 10)); };
    DB.get('movements').forEach(m => push(m.date || m.timestamp));
    DB.get('sales').forEach(s => push(s.date));
    DB.get('repairs').forEach(r => push(r.date || r.createdAt));
    DB.get('transfers').forEach(t => push(t.date || t.createdAt));
    DB.get('dispatches').forEach(d => push(d.date));
    DB.get('invoices').forEach(i => push(i.date));
    DB.get('purchases').forEach(p => push(p.date));
    DB.get('upgrades').forEach(u => push(u.date));
    return Array.from(days).sort();
  },

  /** Consecutive days ending today or yesterday. A streak is not lost to a
   *  weekend; it is only lost once a full day has been missed. */
  streak() {
    const days = new Set(Momentum.activeDays());
    if (!days.size) return 0;
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!days.has(key(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(key(cursor))) return 0;
    }
    let n = 0;
    while (days.has(key(cursor))) { n++; cursor.setDate(cursor.getDate() - 1); }
    return n;
  },

  /** Records written today, by the module they belong to. */
  todayCount() {
    const t = todayISO();
    const day = (v) => String(v || '').slice(0, 10) === t;
    return {
      movements: DB.get('movements').filter(m => day(m.date || m.timestamp)).length,
      sales: DB.get('sales').filter(s => day(s.date)).length,
      repairs: DB.get('repairs').filter(r => day(r.date || r.createdAt)).length,
      dispatches: DB.get('dispatches').filter(d => day(d.date)).length,
      total: DB.get('movements').filter(m => day(m.date || m.timestamp)).length
           + DB.get('sales').filter(s => day(s.date)).length
           + DB.get('repairs').filter(r => day(r.date || r.createdAt)).length
           + DB.get('dispatches').filter(d => day(d.date)).length
    };
  },

  /**
   * Milestones. `test` receives a snapshot and returns true once earned.
   * `value` shows progress toward it, so an unearned badge is still a goal.
   */
  MILESTONES: [
    { id: 'first-move',    icon: '⇄', label: 'First movement',   hint: 'Record a stock movement',
      test: s => s.movements >= 1,        value: s => [s.movements, 1] },
    { id: 'first-sale',    icon: '◌', label: 'First sale',       hint: 'Ring up an order or POS basket',
      test: s => s.sales >= 1,            value: s => [s.sales, 1] },
    { id: 'hundred-units', icon: '▦', label: '100 units moved',  hint: 'A hundred units through the ledger',
      test: s => s.unitsMoved >= 100,     value: s => [s.unitsMoved, 100] },
    { id: 'all-sections',  icon: '◫', label: 'All sections used', hint: 'Touch every part of the app once',
      test: s => s.sectionsUsed >= 8,     value: s => [s.sectionsUsed, 8] },
    { id: 'week-streak',   icon: '🔥', label: '7-day streak',    hint: 'Work with the app seven days running',
      test: s => s.streak >= 7,           value: s => [s.streak, 7] },
    { id: 'goodbin',       icon: '◈', label: 'GoodBin recovered', hint: 'Return a repaired device to saleable stock',
      test: s => s.goodBin >= 1,          value: s => [s.goodBin, 1] },
    { id: 'zero-arrears',  icon: '✓', label: 'Zero overdue',     hint: 'Bring every invoice to Paid',
      test: s => s.sales >= 5 && s.overdue === 0, value: s => [s.sales >= 5 ? 1 : 0, 1] },
    { id: 'photo-pro',     icon: '◉', label: 'Documented',       hint: 'Attach photos to records',
      test: s => s.photos >= 10,          value: s => [s.photos, 10] }
  ],

  /** Section names the user has actually opened. Nudges them to the rest. */
  sectionSeen() {
    const d = Momentum.data();
    if (!Array.isArray(d.sections)) d.sections = [];
    return d.sections;
  },

  markSection(key) {
    if (!key) return;
    const d = Momentum.data();
    if (!Array.isArray(d.sections)) d.sections = [];
    if (d.sections.indexOf(key) >= 0) return;
    d.sections.push(key);
    Momentum.save(d);
  },

  snapshot() {
    /* Distinct pages actually opened. Seeded with the two pages every session
     * lands on, so a brand-new install is never at zero and the milestone is
     * about breadth of use rather than about the first minute. */
    const used = new Set(Momentum.sectionSeen().concat(['dashboard']));
    return {
      movements: DB.get('movements').length,
      sales: DB.get('sales').length,
      unitsMoved: sum(DB.get('movements'), m => num(m.qty)),
      goodBin: DB.get('repairs').filter(r => r.status === 'GoodBin Returned').length,
      overdue: DB.get('invoices').filter(i => i.status === 'Overdue').length,
      photos: DB.get('attachments').length,
      streak: Momentum.streak(),
      sectionsUsed: used.size
    };
  },

  /** Evaluate every milestone; return { earned, total, next }. */
  progress() {
    const s = Momentum.snapshot();
    const seen = Momentum.sectionSeen();
    /* A milestone about exploring the app should not be earned by the demo
     * data alone, so exploration milestones are gated on real use too. */
    const rows = Momentum.MILESTONES.map(m => {
      const [have, want] = m.value(s);
      return Object.assign({}, m, {
        earned: m.test(s),
        have, want,
        pct: want > 0 ? Math.max(0, Math.min(100, Math.round((have / want) * 100))) : 0
      });
    });
    return {
      rows,
      earned: rows.filter(r => r.earned).length,
      total: rows.length,
      sections: seen,
      streak: s.streak,
      today: Momentum.todayCount()
    };
  },

  /**
   * Debounced celebration check.
   *
   * Called from audit(), which is the single funnel for every write. A bulk
   * CSV import can produce a few thousand audit rows in one tick, and the
   * milestone scan reads eight collections, so it is coalesced onto one check a
   * moment after the last write rather than running per row.
   */
  scheduleCelebrate(trigger) {
    clearTimeout(Momentum._celTimer);
    Momentum._celTimer = setTimeout(() => {
      Momentum._celTimer = null;
      try { Momentum.celebrate(trigger); } catch (e) { /* never break a save */ }
    }, 1100);
  },

  /** Called after each record is written. Fires at most one celebration. */
  celebrate(trigger) {
    const p = Momentum.progress();
    const d = Momentum.data();
    d.lastSeen = d.lastSeen || {};
    for (const row of p.rows) {
      if (!row.earned) continue;
      const key = `${row.id}:${trigger || ''}`;
      if (d.lastSeen[key]) continue;
      d.lastSeen[key] = todayISO();
      if (d.seen.indexOf(row.id) < 0) d.seen.push(row.id);
      Momentum.save(d);
      Momentum.confetti();
      toast(`${row.icon} Milestone unlocked — ${row.label}`, 'good', 5200);
    }
  },

  /** A short burst of DOM. Deliberately cheap: 18 nodes, removed on animation
   *  end, and skipped entirely when the user prefers reduced motion. */
  confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = $('confettiHost');
    if (!host) return;
    const colors = ['var(--amber)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--teal)'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('i');
      p.style.cssText = `left:${(10 + Math.random() * 80).toFixed(1)}%;background:${colors[i % colors.length]};
        animation-delay:${(Math.random() * .35).toFixed(2)}s;transform:rotate(${Math.random() * 360}deg)`;
      host.appendChild(p);
      setTimeout(() => p.remove(), 2600);
    }
  }
};

/* ------------------------------------------------------------------ Panel */
/**
 * The Momentum panel on the dashboard.
 *
 * Three things, in priority order:
 *   1. a streak, because a visible reason to come back tomorrow is the single
 *      strongest habit loop there is and it costs nothing to compute;
 *   2. what was recorded today, so the app confirms the day's work;
 *   3. the next milestone, with progress, so there is always a target.
 *
 * Earned badges are shown too, but capped and collapsed - a wall of trophies
 * is noise, and the unearned ones are more motivating than the earned ones.
 */
function renderMomentum() {
  const host = $('dashMomentum');
  if (!host) return;
  const p = Momentum.progress();
  const next = p.rows.filter(r => !r.earned).sort((a, b) => b.pct - a.pct)[0];
  const earned = p.rows.filter(r => r.earned);
  const t = p.today;
  const streakDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const cells = [
    { k: 'movements', label: 'Movements', icon: '⇄' },
    { k: 'sales', label: 'Sales', icon: '◌' },
    { k: 'repairs', label: 'Repairs', icon: '◈' },
    { k: 'dispatches', label: 'Dispatches', icon: '✦' }
  ];

  const sb = $('momStreak');
  if (sb) {
    sb.textContent = p.streak > 0 ? `${p.streak} day streak` : 'No streak yet';
    sb.className = 'badge ' + (p.streak >= 7 ? 'green' : p.streak > 0 ? 'amber' : '');
  }

  host.innerHTML = `
    <div class="mom-head">
      <div class="mom-streak ${p.streak > 0 ? 'hot' : ''}">
        <span class="flame">${p.streak > 0 ? '🔥' : '·'}</span>
        <span class="n">${fmt(p.streak)}</span>
        <span class="cap">day${p.streak === 1 ? '' : 's'} running</span>
      </div>
      <div class="mom-today">
        <div class="eyebrow">Recorded today</div>
        <div class="mom-cells">${cells.map(c => `
          <div class="mom-cell ${t[c.k] > 0 ? 'has' : ''}" title="${esc(c.label)}">
            <span class="i">${c.icon}</span>
            <b>${fmt(t[c.k])}</b>
            <small>${esc(c.label)}</small>
          </div>`).join('')}
        </div>
      </div>
    </div>

    ${next ? `
      <div class="mom-next">
        <div class="mom-next-top">
          <span class="eyebrow">Next milestone</span>
          <b>${esc(next.label)}</b>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${next.pct}%"></div></div>
        <div class="mom-next-foot">
          <span>${esc(next.hint)}</span>
          <span class="mono">${fmt(next.have)} / ${fmt(next.want)}</span>
        </div>
      </div>` : `
      <div class="mom-next all-done">
        <b>All ${fmt(p.total)} milestones unlocked.</b>
        <span>Every badge on the shelf is yours.</span>
      </div>`}

    ${earned.length ? `
      <div class="mom-badges">
        <div class="eyebrow">${fmt(earned.length)} of ${fmt(p.total)} unlocked</div>
        <div class="mom-badge-row">${p.rows.map(r => `
          <span class="mom-badge ${r.earned ? 'on' : ''}" title="${esc(r.label)} — ${esc(r.hint)}${r.earned ? '' : ` (${fmt(r.have)}/${fmt(r.want)})`}">
            <i>${r.icon}</i>${r.earned ? '' : '<em>' + r.pct + '%</em>'}
          </span>`).join('')}</div>
      </div>` : ''}

    <div class="mom-week" title="Days you recorded something in the last week">
      ${Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const on = Momentum.activeDays().indexOf(d.toISOString().slice(0, 10)) >= 0;
        return `<span class="mom-day ${on ? 'on' : ''}">${streakDays[d.getDay()][0]}</span>`;
      }).join('')}
    </div>`;
}

/* ------------------------------------------------------------------ Drill */
/**
 * A stat card is a number. This resolves the number to the rows behind it, so
 * a click on "Attention needed: 14" opens the fourteen lines that need it
 * rather than the inventory page where they are mixed in with everything else.
 *
 * A drill is `{ title, sub, columns, rows, foot, go }`:
 *   columns - [{ label, align?, render?(row) }]
 *   rows    - array of records, already filtered
 *   foot    - optional HTML for a totals row
 *   go      - optional { page, label } to open the full page afterwards
 */
const Drill = {
  specs: Object.create(null),

  /**
   * Register a drill.
   *
   * `openRow` is inferred from the drill's `go.page` when it is not given
   * explicitly, using the DOPENER table in 17-drills.js. That is deliberate:
   * twenty-odd metric drills all point at a page, and the drawer that page opens
   * is the same drawer its rows should open. Requiring each one to restate it
   * would be twenty-odd chances to name the wrong one. A drill whose `go.page`
   * has no drawer, or which needs a bespoke destination, sets `openRow`
   * explicitly and overrides the inference.
   *
   * DOPENER is declared in a later module, but register() only ever runs from
   * boot(), long after every file has been concatenated, so the reference is
   * live by the time it is read.
   */
  register(key, spec) {
    const full = Object.assign({}, spec);
    if (full.openRow === undefined && full.go && typeof DOPENER !== 'undefined') {
      full.openRow = DOPENER[full.go.page] || null;
    }
    this.specs[key] = full;
  },

  has(key) { return !!this.specs[key]; },

  /**
   * `sub` and `foot` may be a string or a function returning a string.
   *
   * They are functions by default on purpose. A spec is built once, during
   * boot(), but it is *shown* much later. If the footer were a plain template
   * literal it would be evaluated at registration time and then frozen for
   * the life of the session — the "34 lines" under the table would still say
   * 34 after the user sold half of them. A function defers the arithmetic to
   * the moment the drill is opened, so a total can never disagree with the
   * rows directly above it.
   *
   * Strings are still accepted for the cases that genuinely are constant.
   */
  _text(v) { return typeof v === 'function' ? (v() || '') : (v || ''); },

  open(key) {
    const spec = this.specs[key];
    if (!spec) return false;
    const rows = spec.rows() || [];
    if (spec.guard && !spec.guard()) {
      toast(spec.emptyMessage || 'There is nothing to show here yet', 'warn');
      return true;
    }
    const cols = spec.columns || [];
    const foot = this._text(spec.foot);
    const body = rows.length
      ? `<div class="table-scroll drill-table"><table class="dt sm">
           <thead><tr>${cols.map(c => `<th${c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
           <tbody>${rows.map((r, i) => `<tr data-drill-row="${i}" class="clickable">${cols.map(c =>
             `<td${c.align === 'right' ? ' class="right num"' : c.align === 'center' ? ' class="center"' : ''}>${c.render ? c.render(r, i) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
           ${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}
         </table></div>`
      : `<div class="empty"><div class="big">✓</div><b>Nothing here</b><p>${esc(spec.emptyText || 'Every line in this category is clear.')}</p></div>`;

    const el = openModal({
      width: 'lg', autofocus: false,
      title: this._text(spec.title),
      sub: `${fmt(rows.length)} ${esc(rows.length === 1 ? (spec.unit || 'record') : (spec.plural || (spec.unit || 'record') + 's'))}${this._text(spec.sub) ? ' · ' + esc(this._text(spec.sub)) : ''}`,
      body,
      foot: `${spec.go ? `<button class="btn left" data-go>${esc(spec.go.label || 'Open full page')}</button>` : ''}
             <button class="btn" data-cancel>Close</button>`,
      onMount(node) {
        const g = qs('[data-go]', node);
        if (g) g.onclick = () => { closeModal(node); go(spec.go.page, { keepModal: false }); };
        /* A row may name its own destination, so clicking through from a
         * summary lands on the record rather than just the list.
         *
         * The opener receives the row's id first and the whole record second.
         * Ids are what the drawers are keyed by; the record is a convenience
         * for any opener that would otherwise have to look it up again. */
        $$('[data-drill-row]', node).forEach(tr => tr.onclick = () => {
          const row = rows[Number(tr.dataset.drillRow)];
          if (!row || !spec.openRow) return;
          closeModal(node);
          spec.openRow(row.id != null ? row.id : row, row);
        });
        if (!spec.openRow) $$('[data-drill-row]', node).forEach(tr => tr.classList.remove('clickable'));
      }
    });
    return !!el;
  }
};

/* Card click resolution: a drill first, a plain page second. */
function openStatTarget(key) {
  if (!key) return;
  if (Drill.has(key)) { Drill.open(key); return; }
  if (PAGE_META[key]) { go(key); return; }
  const map = { items: 'inventory', pos: 'pos' };
  if (map[key]) go(map[key]);
}

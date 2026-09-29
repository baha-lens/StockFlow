/* ==========================================================================
   AMAYA ERP — UI framework: nav, router, tables, toasts, modals
   ========================================================================== */

/* ------------------------------------------------------------- Navigation */
const NAV = [
  { group: 'Overview', items: [
    { key: 'dashboard', label: 'Dashboard', icon: '◫' }
  ]},
  { group: 'Operations', items: [
    { key: 'inventory',  label: 'Inventory',       icon: '▣' },
    { key: 'movements',  label: 'Stock Movement',  icon: '⇄' },
    { key: 'transfers',  label: 'Transfers',       icon: '⇋' },
    { key: 'purchases',  label: 'Purchases',       icon: '⌂' },
    { key: 'sales',      label: 'Sales',           icon: '◌' },
    { key: 'pos',        label: 'Retail POS',      icon: '▤' },
    { key: 'dispatch',   label: 'Dispatch',        icon: '✦' },
    { key: 'upgrades',   label: 'Trade-in Desk',   icon: '⇄' },
    { key: 'repairs',    label: 'BadBin / Repairs', icon: '◈' }
  ]},
  { group: 'Business', items: [
    { key: 'customers',    label: 'Customers',     icon: '◎' },
    { key: 'suppliers',    label: 'Suppliers',     icon: '▦' },
    { key: 'invoices',     label: 'Invoices',      icon: '◫' },
    { key: 'whatsappCrm',  label: 'WhatsApp CRM',  icon: '💬' },
    { key: 'personalLog',   label: 'Personal Log',  icon: '📝' }
  ]},
  { group: 'People', items: [
    { key: 'live',       label: 'Live Attendance', icon: '▣' },
    { key: 'employees',  label: 'Employees',  icon: '◉' },
    { key: 'payroll',    label: 'Payroll',    icon: '₳' },
    { key: 'leave',      label: 'Leave',      icon: '⊚' },
    { key: 'attendance', label: 'Attendance', icon: '✓' }
  ]},
  { group: 'Intelligence', items: [
    { key: 'finance',    label: 'Finance',   icon: '◍' },
    { key: 'analytics',  label: 'Analytics', icon: '◆' },
    { key: 'reports',    label: 'Reports',   icon: '▤' },
    { key: 'audit',      label: 'Audit Log', icon: '◷' }
  ]},
  { group: 'System', items: [
    { key: 'settings',   label: 'Settings', icon: '⚙' },
    { key: 'admin',      label: 'Admin',    icon: '♙', adminOnly: true }
  ]}
];

const PAGE_META = {
  dashboard:  ['Dashboard',        'Central operations'],
  inventory:  ['Inventory',        'Master stock register'],
  movements:  ['Stock Movement',   'Controlled ledger entry'],
  transfers:  ['Transfers',        'Inter-facility workflow'],
  purchases:  ['Purchases',        'Supplier procurement'],
  sales:      ['Sales',            'Order management'],
  pos:        ['Retail POS',       'Counter checkout'],
  dispatch:   ['Dispatch',         'Outbound logistics'],
  upgrades:   ['Trade-in Desk',    'Customer device exchange'],
  repairs:    ['BadBin & Repairs', 'After-sales operations'],
  customers:  ['Customers',        'Business directory'],
  suppliers:  ['Suppliers',        'Business directory'],
  invoices:   ['Invoices',         'Accounts receivable'],
  whatsappCrm:['WhatsApp CRM',     'Customer messaging & live chat'],
  personalLog:['Personal Log',     'Private encrypted work notes'],
  live:       ['Live Attendance',  'Terminal feed'],
  employees:  ['Employees',        'People operations'],
  payroll:    ['Payroll',          'Compensation'],
  leave:      ['Leave Requests',   'Time off'],
  attendance: ['Attendance',       'Time & attendance'],
  finance:    ['Finance',          'Money in, money out'],
  analytics:  ['Analytics',        'Deep metrics'],
  reports:    ['Reports',          'Consolidated intelligence'],
  audit:      ['Audit Log',        'Accountability trail'],
  settings:   ['Settings',         'Infrastructure'],
  admin:      ['Admin Control',    'Restricted workspace']
};

const MOBILE_NAV = ['dashboard', 'inventory', 'movements', 'sales', 'pos'];

function navCounts() {
  const openTransfers = DB.get('transfers').filter(t => !['Complete', 'Cancelled'].includes(t.status)).length;
  const openRepairs = DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status)).length;
  const pendingPO = DB.get('purchases').filter(p => ['Pending', 'In Transit'].includes(p.status)).length;
  const activeDisp = DB.get('dispatches').filter(d => !['Delivered', 'Handed Over', 'Cancelled'].includes(d.status)).length;
  return {
    inventory: DB.get('inventory').length,
    transfers: openTransfers,
    repairs: openRepairs,
    purchases: pendingPO,
    dispatch: activeDisp,
    upgrades: DB.get('upgrades').filter(u => ['Valued', 'Agreed', 'Issued'].includes(u.status)).length,
    sales: DB.get('sales').filter(s => s.status !== 'Paid').length,
    invoices: DB.get('invoices').filter(i => i.status !== 'Paid').length,
    leave: DB.get('leaves').filter(l => l.status === 'Pending').length,
    payroll: DB.get('payroll').filter(p => p.status === 'Pending').length
  };
}

function renderNav() {
  const counts = navCounts();
  const host = $('navScroll');
  host.innerHTML = NAV.map(g => {
    const items = g.items.filter(i => canSee(i.key) && (!i.adminOnly || isAdmin()));
    if (!items.length) return '';
    return `<div class="nav-group">
      <div class="nav-label">${esc(g.group)}</div>
      ${items.map(i => {
        const c = counts[i.key];
        return `<button class="nav-item ${state.route === i.key ? 'active' : ''}" data-page="${i.key}">
          <span class="gi">${i.icon}</span>
          <span class="nav-label-text">${esc(i.label)}</span>
          ${c ? `<span class="nav-count ${['repairs','leave','payroll'].includes(i.key) ? 'alert' : ''}">${c > 999 ? '999+' : c}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }).join('');

  $('mobileNav').innerHTML = MOBILE_NAV.map(k => {
    const meta = NAV.flatMap(g => g.items).find(i => i.key === k);
    return `<button class="${state.route === k ? 'on' : ''}" data-page="${k}"><span class="gi">${meta.icon}</span>${k === 'dashboard' ? 'Home' : k === 'inventory' ? 'Stock' : k === 'movements' ? 'Move' : k === 'sales' ? 'Sales' : 'POS'}</button>`;
  }).join('') + `<button class="fab" data-quick="movement" aria-label="Record stock movement">＋</button>`;

  $$('[data-page]', host).forEach(b => b.onclick = () => { go(b.dataset.page); document.body.classList.remove('nav-open'); });
  $$('[data-page]', $('mobileNav')).forEach(b => b.onclick = () => go(b.dataset.page));
}

/** Page-level create/act buttons, mapped to the module that grants them. */
const WRITE_BUTTONS = {
  btnAddItem: 'inventory', btnReconcile: 'movements', btnNewTransfer: 'transfers',
  btnNewPO: 'purchases', btnNewSale: 'sales', btnNewDispatch: 'dispatch',
  btnNewTrade: 'upgrades', btnNewRepair: 'repairs', btnNewCustomer: 'customers', btnNewSupplier: 'suppliers',
  btnNewInvoice: 'invoices', btnNewEmployee: 'employees', btnRunPayroll: 'payroll',
  btnNewLeave: 'leave', btnNewAtt: 'attendance', btnImportAtt: 'attendance',
  btnAddLocation: 'admin', btnClearAudit: 'admin'
};

/** Disables page actions the signed-in role is not allowed to perform. */
function applyPermissions() {
  Object.entries(WRITE_BUTTONS).forEach(([id, mod]) => {
    const el = $(id);
    if (!el) return;
    const ok = canWrite(mod);
    el.disabled = !ok;
    el.title = ok ? '' : 'Your role does not permit this action';
    el.style.opacity = ok ? '' : '.45';
  });
  $$('[data-requires-admin]').forEach(el => { el.disabled = !isAdmin(); });
}

function go(page, opts = {}) {
  if (!PAGE_META[page]) page = 'dashboard';
  if (!canSee(page)) {
    /* Re-render so the nav never keeps items the current role cannot open. */
    renderNav();
    toast(`Your role cannot open ${PAGE_META[page][0]}`, 'bad');
    return;
  }
  const prev = state.route;
  state.route = page;
  /* Record the move so the Android back button can retrace it. Re-entering the
   * same page must not grow the stack, and a back-initiated move must not push
   * the page it just came from. */
  if (typeof BackNav !== 'undefined') {
    if (opts.fromHistory) BackNav.history[BackNav.history.length - 1] = page;
    else if (prev !== page) BackNav.track(page);
  }
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  const [title, sub] = PAGE_META[page];
  $('topTitle').textContent = title;
  $('topSub').textContent = sub;
  renderNav();
  renderPage(page);
  location.hash = '#/' + page;
  const content = $('content');
  if (content && !opts.noScroll) content.scrollTop = 0;
  if (state.modalStack.length && !opts.keepModal) closeAllModals();
  /* Breadth of use, for the "all sections" milestone. Recorded on every route
   * change including a back-navigation retrace, because the user genuinely has
   * seen that page again. */
  if (typeof Momentum !== 'undefined' && !opts.silent) Momentum.markSection(page);
  /* Back and Home buttons are derived from the route and the modal stack, so
   * they are repainted here rather than from each of their own call sites. */
  if (typeof BackNav !== 'undefined') BackNav.paint();
}

function renderPage(page) {
  const map = {
    dashboard: renderDashboard, live: renderLive, inventory: renderInventory, movements: renderMovements,
    transfers: renderTransfers, purchases: renderPurchases, sales: renderSales, pos: renderPOS,
    dispatch: renderDispatch, upgrades: renderUpgrades, repairs: renderRepairs, customers: renderCustomers,
    suppliers: renderSuppliers, invoices: renderInvoices, whatsappCrm: renderWhatsappCrm, personalLog: renderPersonalLog,
    employees: renderEmployees, payroll: renderPayroll, leave: renderLeave, attendance: renderAttendance,
    finance: renderFinance, analytics: renderAnalytics, reports: renderReports,
    audit: renderAudit, settings: renderSettings, admin: renderAdmin
  };
  try { (map[page] || (() => {}))(); }
  catch (e) { console.error('Render failed for', page, e); }
}

function renderAll() {
  if (!state.session) return;
  const u = state.session.user;
  $('sideUserName').textContent = u.name;
  $('sideUserRole').textContent = `${u.role} · ${u.location || 'Central'}`;
  $('sideAvatar').textContent = initials(u.name);
  renderNav();
  renderPage(state.route);
  applyPermissions();
}

/* ----------------------------------------------------------------- Toasts */
function toast(text, kind = 'good', ms = 3400) {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="mark">${kind === 'good' ? '✓' : kind === 'bad' ? '✕' : '!'}</span><span>${esc(text)}</span>`;
  host.appendChild(el);
  const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  setTimeout(kill, ms);
  el.onclick = kill;
}

/* ----------------------------------------------------------------- Modals */
function openModal(spec) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay open' + (spec.drawer ? ' drawer-overlay' : '');
  const width = spec.width ? ` w-${spec.width}` : '';
  const body = typeof spec.body === 'function' ? spec.body() : (spec.body || '');
  overlay.innerHTML = spec.drawer
    ? `<div class="drawer">
         <div class="modal-head"><div><h2>${esc(spec.title)}</h2>${spec.sub ? `<p>${esc(spec.sub)}</p>` : ''}</div>
         <button class="icon-btn" data-x>✕</button></div>
         <div class="modal-body scroll-y">${body}</div>
         ${spec.foot ? `<div class="modal-foot">${spec.foot}</div>` : ''}
       </div>`
    : `<div class="modal${width}">
         <div class="modal-head"><div><h2>${esc(spec.title)}</h2>${spec.sub ? `<p>${esc(spec.sub)}</p>` : ''}</div>
         <button class="icon-btn" data-x>✕</button></div>
         <div class="modal-body scroll-y">${body}</div>
         ${spec.foot ? `<div class="modal-foot">${spec.foot}</div>` : ''}
       </div>`;

  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(overlay); });
  $('modalHost').appendChild(overlay);
  const entry = { el: overlay, spec };
  state.modalStack.push(entry);
  document.body.style.overflow = 'hidden';

  $$('[data-x]', overlay).forEach(b => b.onclick = () => closeModal(overlay));
  $$('[data-cancel]', overlay).forEach(b => b.onclick = () => closeModal(overlay));
  if (spec.onMount) spec.onMount(overlay);
  const focusable = overlay.querySelector('input:not([type=hidden]),select,textarea');
  if (focusable && spec.autofocus !== false) setTimeout(() => focusable.focus(), 60);
  /* A modal is the top of the back stack, so the back button must be live. */
  if (typeof BackNav !== 'undefined') BackNav.paint();
  return overlay;
}
function closeModal(target) {
  const entry = state.modalStack.find(s => s.el === target) || state.modalStack[state.modalStack.length - 1];
  if (!entry) return;
  if (entry.spec && entry.spec.onClose) entry.spec.onClose(entry.el);
  entry.el.remove();
  state.modalStack = state.modalStack.filter(s => s.el !== entry.el);
  if (!state.modalStack.length) document.body.style.overflow = '';
  if (typeof BackNav !== 'undefined') BackNav.paint();
}
function closeAllModals() {
  state.modalStack.forEach(s => { if (s.spec.onClose) s.spec.onClose(s.el); s.el.remove(); });
  state.modalStack = [];
  document.body.style.overflow = '';
  if (typeof BackNav !== 'undefined') BackNav.paint();
}
/* Escape is owned by BackNav now, which closes the top modal as its first step
   and then steps back through pages. A second handler here would consume the
   same keypress and navigate on top of the close. */

/** Promise-based confirm dialog replacing window.confirm. */
function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false, detail = '' }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); closeModal(overlay); };
    const overlay = openModal({
      width: 'sm', autofocus: false,
      title,
      body: `<div class="callout ${danger ? 'danger' : 'warn'}">
               <span class="lead">${danger ? '⚠' : '?'}</span>
               <div class="body">${message ? `<b>${esc(message)}</b>` : ''}${detail ? `<div>${detail}</div>` : ''}</div>
             </div>`,
      /* `detail` is HTML by contract and `message` is plain text. Escape only
       * the plain-text half, otherwise a caller that embeds <br> in `message`
       * shows the tag literally. */
      foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button>`,
      onMount(el) {
        qs('[data-yes]', el).onclick = () => finish(true);
        qs('[data-no]', el).onclick = () => finish(false);
      },
      onClose() { finish(false); }
    });
  });
}
function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); closeModal(overlay); };
    const overlay = openModal({
      width: 'sm', title,
      body: `<div class="field"><label>${esc(label)}</label><input class="input" id="__promptIn" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(confirmLabel)}</button>`,
      onMount(el) {
        const inp = $('__promptIn', el);
        inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(inp.value); } };
        qs('[data-yes]', el).onclick = () => finish(inp.value);
        qs('[data-no]', el).onclick = () => finish(null);
      },
      onClose() { finish(null); }
    });
  });
}

/* ------------------------------------------------------------- Table engine */
const Pagers = {
  state: {},
  get(key, def = {}) {
    if (!Pagers.state[key]) Pagers.state[key] = Object.assign({ page: 1, per: 25, sort: null, dir: 1 }, def);
    return Pagers.state[key];
  },
  /**
   * @param {string} key      stable pager key
   * @param {object} opts     { mount, foot, columns, rows, empty, onRow, footRow, pageSize, dense,
   *                            selectable, bulkActions, onSelectionChange }
   *
   * Selection: pass `selectable: true` to get a checkbox column plus a bulk
   * action bar. `bulkActions` is a list of
   *   { key, label, icon, danger?, needsConfirm?, run(rows, ids) }
   * and receives the selected rows. Selection is keyed on the pager key and
   * survives re-renders and page changes; it is pruned to ids that still exist.
   */
  render(key, opts) {
    const st = Pagers.get(key, { per: opts.pageSize || 25 });
    const sel = opts.selectable ? Sel.get(key) : null;
    let rows = opts.rows || [];

    if (st.sort) {
      const col = opts.columns.find(c => c.key === st.sort);
      if (col) rows = sortBy(rows, col.sortVal || (r => r[col.key]), st.dir);
    }
    const total = rows.length;
    const per = st.per;
    const pages = Math.max(1, Math.ceil(total / per));
    if (st.page > pages) st.page = pages;
    const start = (st.page - 1) * per;
    const slice = per >= 9999 ? rows : rows.slice(start, start + per);

    /* Drop selections for rows that no longer exist, otherwise a stale id
     * would let a later "delete selected" hit the wrong record. */
    if (sel) {
      const live = new Set(rows.map(r => r.id));
      let dropped = false;
      for (const id of Array.from(sel)) if (!live.has(id)) { sel.delete(id); dropped = true; }
      if (dropped && opts.onSelectionChange) opts.onSelectionChange(sel, rows);
    }

    const host = $(opts.mount);
    if (!host) return;
    if (!total) {
      host.innerHTML = `<div class="empty">
        <div class="big">▤</div>
        <b>${esc(opts.emptyTitle || 'Nothing here yet')}</b>
        <p>${esc(opts.emptyText || 'Records will appear here once they are created.')}</p>
      </div>`;
      const f = $(opts.foot); if (f) f.innerHTML = '';
      return;
    }

    const head = (sel ? `<th class="sel-col"><input type="checkbox" data-selall aria-label="Select all rows on this page"></th>` : '') +
      opts.columns.map(c => {
        const isSorted = st.sort === c.key;
        const alignCls = c.align === 'right' ? ' right num' : c.align === 'center' ? ' center' : '';
        return `<th class="${c.sortable === false ? '' : 'sortable'} ${isSorted ? 'sorted' : ''}${alignCls}"
          ${c.width ? `style="width:${c.width}"` : ''} data-sort="${c.sortable === false ? '' : c.key}">${esc(c.label)}${c.sortable === false ? '' : `<span class="sort-ind">${isSorted ? (st.dir === 1 ? '▲' : '▼') : '▲'}</span>`}</th>`;
      }).join('');

    const pageIds = slice.map(r => r.id);
    const pageSelCount = sel ? pageIds.filter(id => sel.has(id)).length : 0;

    const body = slice.map((row, i) => {
      const tds = opts.columns.map(c => {
        const v = c.render ? c.render(row, i + start) : esc(row[c.key] ?? '—');
        return `<td${c.align === 'right' ? ' class="right num"' : c.align === 'center' ? ' class="center"' : ''}>${v}</td>`;
      }).join('');
      const isSel = sel && sel.has(row.id);
      const selCell = sel ? `<td class="sel-col"><input type="checkbox" data-sel="${esc(row.id)}"${isSel ? ' checked' : ''} aria-label="Select ${esc(row.id)}"></td>` : '';
      return `<tr data-id="${esc(row.id)}" class="${opts.onRow ? 'clickable' : ''}${isSel ? ' sel-row' : ''}">${selCell}${tds}</tr>`;
    }).join('');

    const footRow = opts.footRow
      ? `<tfoot><tr>${sel ? '<td></td>' : ''}${opts.columns.map((c, i) =>
          `<td${c.align === 'right' ? ' class="right"' : ''}>${i === 0 ? opts.footRow(c, rows) : (opts.footRowCells ? (opts.footRowCells[i] || '') : '')}</td>`).join('')}</tr></tfoot>`
      : '';

    host.innerHTML = `<table class="dt ${opts.dense ? 'sm' : ''}">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>${footRow}</table>`;

    if (sel) {
      const all = qs('[data-selall]', host);
      if (all) {
        all.checked = pageIds.length > 0 && pageSelCount === pageIds.length;
        all.indeterminate = pageSelCount > 0 && pageSelCount < pageIds.length;
        all.onclick = e => {
          e.stopPropagation();
          if (all.checked) pageIds.forEach(id => sel.add(id)); else pageIds.forEach(id => sel.delete(id));
          Pagers.render(key, opts);
        };
      }
      $$('[data-sel]', host).forEach(cb => cb.onclick = e => {
        e.stopPropagation();
        const id = cb.dataset.sel;
        if (cb.checked) sel.add(id); else sel.delete(id);
        cb.closest('tr').classList.toggle('sel-row', cb.checked);
        const a = qs('[data-selall]', host);
        if (a) {
          const n = slice.filter(r => sel.has(r.id)).length;
          a.checked = n === slice.length && slice.length > 0;
          a.indeterminate = n > 0 && n < slice.length;
        }
        Sel.paint(key, opts);
        if (opts.onSelectionChange) opts.onSelectionChange(sel, rows);
      });
    }

    if (opts.onRow) {
      $$('tbody tr[data-id]', host).forEach(tr => tr.onclick = e => {
        if (e.target.closest('button, a')) return;
        const row = rows.find(r => r.id === tr.dataset.id);
        if (row) opts.onRow(row, e);
      });
    }
    $$('[data-sort]', host).forEach(th => th.onclick = () => {
      const k = th.dataset.sort;
      if (!k) return;
      if (st.sort === k) st.dir = st.dir === 1 ? -1 : 1; else { st.sort = k; st.dir = 1; }
      Pagers.render(key, opts);
    });

    const f = $(opts.foot);
    if (f) {
      /* Bulk bar sits above the pager and only appears once something is
       * selected, so an idle table keeps the space it had. */
      const bar = sel ? Sel.barHtml(key, opts, rows) : '';
      const win = [];
      const cur = st.page;
      const push = n => { if (n >= 1 && n <= pages && !win.includes(n)) win.push(n); };
      push(1); push(2); push(cur - 1); push(cur); push(cur + 1); push(pages - 1); push(pages);
      win.sort((a, b) => a - b);
      let html = '', last = 0;
      win.forEach(n => {
        if (n - last > 1) html += `<button disabled>…</button>`;
        html += `<button class="${n === cur ? 'on' : ''}" data-pg="${n}">${n}</button>`;
        last = n;
      });
      f.innerHTML = `${bar}
        <span class="toolbar-count">Showing <b>${start + 1}–${Math.min(start + per, total)}</b> of <b>${fmt(total)}</b> ${opts.unit || 'records'}</span>
        <div class="row-wrap">
          <select class="select" style="height:30px;min-width:88px;font-size:11.5px" data-per>
            ${[10, 25, 50, 100, 250].map(n => `<option value="${n}" ${n === per ? 'selected' : ''}>${n} / page</option>`).join('')}
            ${per > 250 ? `<option value="${per}" selected>${per} / page</option>` : ''}
          </select>
          <div class="pager">
            <button data-pg="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹</button>
            ${html}
            <button data-pg="${cur + 1}" ${cur === pages ? 'disabled' : ''}>›</button>
          </div>
        </div>`;
      $$('[data-pg]', f).forEach(b => b.onclick = () => { st.page = Number(b.dataset.pg); Pagers.render(key, opts); });
      const perSel = qs('[data-per]', f);
      if (perSel) perSel.onchange = () => { st.per = Number(perSel.value); st.page = 1; Pagers.render(key, opts); };
      Sel.wire(key, opts, rows);
    } else if (sel) {
      Sel.wire(key, opts, rows);
    }
  }
};

/* ------------------------------------------------------------- Form helpers */
function field(label, control, opts = {}) {
  return `<div class="field ${opts.span === 2 ? 'span-2' : opts.span === 'all' ? 'span-all' : ''}">
    <label>${esc(label)}${opts.required ? ' <span style="color:var(--red)">*</span>' : ''}</label>
    ${control}
    ${opts.hint ? `<div class="form-hint">${opts.hint}</div>` : ''}
  </div>`;
}
/**
 * Renders a <select>. If `value` is not among `options` it is appended, so a
 * default never silently falls through to the first (placeholder) option.
 */
function selectControl(id, options, value, attrs = '') {
  const opts = options.map(o => (Array.isArray(o) ? o : [o, o]));
  if (value !== undefined && value !== null && String(value) !== '' && !opts.some(o => String(o[0]) === String(value))) {
    opts.push([value, value]);
  }
  return `<select class="select" id="${id}" ${attrs}>${opts.map(o =>
    `<option value="${esc(o[0])}" ${String(o[0]) === String(value) ? 'selected' : ''}>${esc(o[1])}</option>`
  ).join('')}</select>`;
}
function readForm(root) {
  const out = {};
  $$('[name]', root).forEach(el => { out[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  $$('[id]', root).forEach(el => { if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') out[el.id] = el.value; });
  return out;
}
function fillForm(root, data, map) {
  Object.entries(map || {}).forEach(([key, id]) => {
    const el = $(id, root);
    if (el && data[key] !== undefined && data[key] !== null) el.value = data[key];
  });
}
/** Validates required text inputs; returns false and marks offenders. */
function validate(root, requiredIds) {
  let ok = true;
  (requiredIds || []).forEach(id => {
    const el = $(id, root);
    if (!el) return;
    const bad = !String(el.value || '').trim();
    el.classList.toggle('err', bad);
    if (bad && ok) { el.focus(); ok = false; }
  });
  return ok;
}
function optionsFromList(list, selected, labelFn, placeholder) {
  const opts = placeholder !== undefined ? [['', placeholder]] : [];
  list.forEach(x => opts.push([x.id ?? x, labelFn(x)]));
  return opts;
}
/**
 * Facility options. The value is the facility *name*, because that is what
 * stock lines, transfers and users all key on.
 */
function housesOptions(selected, placeholder) {
  const opts = placeholder !== undefined ? [['', placeholder]] : [];
  DB.get('locations').filter(l => l.active !== false).forEach(l => opts.push([l.name, l.type ? `${l.name} — ${l.type}` : l.name]));
  if (selected && !opts.some(o => o[0] === selected)) opts.push([selected, selected]);
  return opts;
}
function brandOptions() { return uniq(DB.get('items').map(i => i.brand).filter(Boolean)).sort(); }
function techOptions() { return uniq(DB.get('employees').filter(e => /tech|service/i.test(e.department + ' ' + e.role)).map(e => e.name)); }
function customerOptions() { return optionsFromList(DB.get('customers').filter(c => c.status === 'Active'), '', c => c.name); }
function supplierOptions() { return optionsFromList(DB.get('suppliers').filter(s => s.status === 'Active'), '', s => s.name); }
function employeeOptions() { return optionsFromList(DB.get('employees').filter(e => e.status !== 'Inactive'), '', e => `${e.name} (${e.code})`); }
function itemOptions() { return optionsFromList(DB.get('items'), '', i => `${i.model} — ${i.brand}`); }

/* ----------------------------------------------------------- Small helpers */
/**
 * A KPI tile.
 *
 * `onClick` is a target key, not a DOM handler. It is resolved by
 * `openStatTarget()`: a registered drill opens the records behind the number,
 * a plain page key navigates. That is why the card is emitted as a <button>
 * rather than a <div> - a div with a click handler is unreachable by keyboard
 * and invisible to a screen reader as a control, and this app has to be usable
 * on a desktop keyboard as well as a phone.
 */
function statCard({ icon, label, value, meta, color = 'var(--amber)', trend = null, onClick = null }) {
  const tintVar = { amber: 'var(--amber-soft)', green: 'var(--green-soft)', red: 'var(--red-soft)', blue: 'var(--blue-soft)', purple: 'var(--purple-soft)', teal: 'var(--teal-soft)' }[color] || 'var(--amber-soft)';
  const strongVar = { amber: 'var(--amber-strong)', green: 'var(--green)', red: 'var(--red)', blue: 'var(--blue)', purple: 'var(--purple)', teal: 'var(--teal)' }[color] || 'var(--amber)';
  const open = !!onClick;
  const tag = open ? 'button' : 'div';
  return `<${tag} class="stat${open ? ' stat-open' : ''}" style="--stat-tint:${tintVar};--stat-color:${strongVar}"
    ${open ? `type="button" data-stat="${esc(onClick)}" title="Show the records behind this number"` : ''}>
    <div class="stat-top">
      <div class="stat-icon">${icon}</div>
      ${trend ? `<span class="trend ${trend.dir}">${trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '•'} ${esc(trend.text)}</span>` : ''}
      ${open ? '<span class="stat-go" aria-hidden="true">›</span>' : ''}
    </div>
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value" style="color:${strongVar}">${value}</div>
    <div class="stat-meta">${meta || ''}</div>
  </${tag}>`;
}
function barRow(name, value, max, cls = '', suffix = '') {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar-row">
    <span class="nm" title="${esc(name)}">${esc(name)}</span>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
    <span class="bar-val">${suffix ? esc(suffix) : fmt(value)}</span>
  </div>`;
}
function emptyState(title, text, actionLabel, actionFn) {
  return `<div class="empty"><div class="big">▤</div><b>${esc(title)}</b><p>${esc(text)}</p>${actionLabel ? `<button class="btn primary" data-empty="${actionFn}">${esc(actionLabel)}</button>` : ''}</div>`;
}
function statusBadge(status) {
  const map = {
    'Active': 'green', 'Inactive': 'grey', 'On Leave': 'amber',
    'Paid': 'green', 'Pending': 'amber', 'Processing': 'blue', 'Shipped': 'purple',
    'Overdue': 'red', 'Approved': 'blue', 'Draft': 'grey', 'Cancelled': 'red', 'Scrap': 'red',
    'Received': 'green', 'In Transit': 'purple', 'Dispatched': 'blue', 'Complete': 'green', 'Completed': 'green',
    'Replied': 'blue', 'Open': 'amber', 'Done': 'green', 'Closed': 'grey',
    'Diagnosing': 'amber', 'Awaiting Part': 'purple', 'In Repair': 'blue',
    'Repaired': 'green', 'GoodBin Returned': 'teal', 'Scrapped': 'red', 'Returned to Customer': 'blue',
    'Present': 'green', 'Late': 'amber', 'Absent': 'red', 'On Duty': 'green', 'Off Duty': 'grey',
    'Packed': 'amber', 'Courier': 'blue', 'Delivered': 'green', 'Handed Over': 'teal',
    'Partially Received': 'purple', 'Rejected': 'red', 'Healthy': 'green', 'Low': 'amber',
    'Critical': 'red', 'Out of stock': 'red', 'Regular': 'blue', 'LMP': 'purple',
    'Refurbished': 'amber', 'Repair': 'red', 'GoodBin': 'teal', 'Regular ': 'blue'
  };
  const cls = map[status] || (/delivered|paid|complete|approved|active|received|processed|repaired|goodbin|present|on time/i.test(status) ? 'green'
    : /pending|low|partially|processing|packed|late|awaiting|open|diagnos/i.test(status) ? 'amber'
    : /cancel|overdue|rejected|absent|scrapped|out of stock|critical|failed|late$/i.test(status) ? 'red' : 'grey');
  return `<span class="badge ${cls}">${esc(status || '—')}</span>`;
}
function healthBadge(line) {
  const l = stockLevel(line);
  const n = inHand(line);
  return `<span class="badge ${l.color}">${n > 0 ? n + ' · ' + l.label : 'Out of stock'}</span>`;
}
function avatarNode(name, size = 26) {
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .37)}px">${esc(initials(name))}</span>`;
}
function typeBadge(t) {
  const map = { 'Regular': 'blue', 'LMP': 'purple', 'Refurbished': 'amber', 'Repair': 'red' };
  return `<span class="badge ${map[t] || 'grey'}">${esc(t || '—')}</span>`;
}
function fillSelect(id, values, placeholder) {
  const el = $(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '')
    + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (values.includes(cur)) el.value = cur;
}
function nextNumber(prefix, list, field = 'orderId', width = 4) {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${String(year).slice(2)}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const nums = list.map(x => String(x[field] || '')).filter(s => s.startsWith(stem))
    .map(s => parseInt(s.slice(stem.length), 10)).filter(n => Number.isFinite(n));
  return `${stem}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(width, '0')}`;
}
/** IMEI / serial duplicate detection across movements, repairs and the registry. */
function findImei(imei) {
  const q = norm(imei);
  if (!q) return null;
  const reg = DB.get('imeis').find(i => norm(i.imei) === q);
  if (reg) return { source: 'registry', record: reg };
  const rep = DB.get('repairs').find(r => norm(r.imei) === q || norm(r.imei2) === q || norm(r.serialNumber) === q);
  if (rep) return { source: 'repair', record: rep };
  const mv = DB.get('movements').find(m => (m.imeis || []).some(x => norm(x.imei) === q));
  if (mv) return { source: 'movement', record: mv };
  return null;
}
function imeiDigits(v) { return String(v || '').replace(/\D/g, ''); }

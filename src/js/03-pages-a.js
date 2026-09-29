/* ==========================================================================
   AMAYA ERP — Pages A: Dashboard, Inventory, Movements, Transfers
   ========================================================================== */

/* ------------------------------------------------------------- Dashboard */
function renderDashboard() {
  const s = state.db.settings;
  $('dashSubtitle').textContent = state.sync.lastSync
    ? `Last synchronised ${relTime(state.sync.lastSync)} · ${DB.get('items').length} catalogue lines across ${DB.get('locations').filter(l => l.active !== false).length} facilities.`
    : `Real-time consolidated figures across ${DB.get('locations').filter(l => l.active !== false).length} facilities, the retail counter and the service lab.`;

  /* Quick actions */
  $('dashQuick').innerHTML = [
    { icon: '⇄', lbl: 'Record movement', hint: 'Receive or issue stock', go: 'movements' },
    { icon: '⇋', lbl: 'New transfer',    hint: 'Move between facilities', go: 'transfers' },
    { icon: '◌', lbl: 'New sale',        hint: 'Create an order', go: 'sales' },
    { icon: '▤', lbl: 'Open POS',        hint: 'Counter checkout', go: 'pos' },
    { icon: '⌂', lbl: 'Purchase order',  hint: 'Raise a supplier PO', go: 'purchases' },
    { icon: '◈', lbl: 'Repair ticket',   hint: 'BadBin intake', go: 'repairs' },
    { icon: '▣', lbl: 'Add item',        hint: 'New catalogue line', action: 'item' },
    { icon: '✦', lbl: 'New dispatch',    hint: 'Send a consignment', go: 'dispatch' }
  ].filter(q => canWrite(q.go) || q.action === 'item' || canWrite('inventory')).map(q => `
    <button class="action-card" ${q.go ? `data-page="${q.go}"` : `data-quick-action="${q.action}"`}>
      <span class="qicon">${q.icon}</span>
      <span><span class="lbl">${esc(q.lbl)}</span><span class="hint">${esc(q.hint)}</span></span>
    </button>`).join('');
  $$('[data-page]', $('dashQuick')).forEach(b => b.onclick = () => go(b.dataset.page));
  $$('[data-quick-action]', $('dashQuick')).forEach(b => b.onclick = () => Modals.itemForm());

  /* KPI set */
  const inv = DB.get('inventory');
  const units = totalUnits();
  const value = inventoryValue();
  const outLines = inv.filter(l => inHand(l) <= 0).length;
  const lowLines = inv.filter(l => { const n = inHand(l); return n > 0 && n <= threshold(); }).length;
  const tISO = todayISO();
  /* Direction comes from the shared table, so this card cannot disagree with
   * inHand(). A customer return is stock arriving, not leaving. */
  const inToday = sum(DB.get('movements').filter(m => m.date === tISO && movementSign(m.type) > 0), m => m.qty);
  const outToday = sum(DB.get('movements').filter(m => m.date === tISO && movementSign(m.type) < 0), m => m.qty);
  const monthSales = DB.get('sales').filter(x => monthKey(x.date) === monthKey(new Date()));
  const revenue = sum(monthSales, x => x.total);
  const openRepairs = DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status)).length;
  const pendingTrf = DB.get('transfers').filter(t => !['Complete', 'Cancelled'].includes(t.status)).length;
  const overdue = DB.get('invoices').filter(i => i.status === 'Overdue').length;
  const openTrades = DB.get('upgrades').filter(u => OPEN_TRADE_STAGES.includes(u.status)).length;
  const openInvoices = DB.get('invoices').filter(i => i.status !== 'Paid' && i.status !== 'Cancelled').length;
  /* "Money owed" is receivables only. Payables are money leaving, not owed to
   * us, and folding the two together would overstate what customers owe. */
  const receivable = sum(DB.get('invoices').filter(i => i.type !== 'Purchase' && i.status !== 'Paid' && i.status !== 'Cancelled'),
    i => num(i.amount) - num(i.paid));

  $('dashStats').innerHTML = [
    statCard({ icon: '▦', label: 'Units in hand', value: fmt(units), meta: `${inv.length} stock lines`, color: 'amber', onClick: 'dash:units' }),
    statCard({ icon: '◫', label: 'Stock value', value: money(value), meta: `At landed cost · ${s.currency}`, color: 'green', onClick: 'inv:value' }),
    statCard({ icon: '⚠', label: 'Attention needed', value: fmt(outLines + lowLines), meta: `${outLines} out · ${lowLines} low`, color: outLines ? 'red' : 'amber', onClick: 'dash:attention' }),
    statCard({ icon: '◌', label: 'Revenue this month', value: money(revenue), meta: `${monthSales.length} orders`, color: 'blue', onClick: 'dash:revenue' }),
    statCard({ icon: '◈', label: 'Open repairs', value: fmt(openRepairs), meta: 'In the service lab', color: 'purple', onClick: 'dash:repairs' }),
    statCard({ icon: '⇋', label: 'Transfers in flight', value: fmt(pendingTrf), meta: `${overdue} overdue invoices`, color: pendingTrf > 4 ? 'red' : 'teal', onClick: 'dash:transfers' }),
    statCard({ icon: '⇄', label: 'Open trade-ins', value: fmt(openTrades), meta: 'At the exchange desk', color: 'teal', onClick: 'upgrades:open' }),
    statCard({ icon: '◍', label: 'Money owed', value: money(receivable), meta: `${openInvoices} invoices unpaid`, color: 'red', onClick: 'inv:receivable' })
  ].join('');

  /* Trend chart */
  const days = Number($('dashTrendSeg')?.querySelector('button.on')?.dataset.days || 7);
  renderRevenueChart(days);

  /* Alerts. Each one carries the drill key for the records it is counting, so
   * an alert opens the list that is actually short rather than the whole page. */
  const alerts = buildAlerts();
  $('alertCount').textContent = alerts.length;
  $('dashAlerts').innerHTML = alerts.length ? alerts.slice(0, 9).map(a => `
    <button class="list-row clickable" data-alert-go="${a.drill || a.page}">
      <span class="lead" style="background:${a.bg};color:${a.fg}">${a.icon}</span>
      <span class="body"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span>
      <span class="trail"><span class="badge ${a.cls}">${esc(a.count)}</span></span>
    </button>`).join('') : `<div class="empty" style="padding:26px"><div class="big">✓</div><b>All clear</b><p>No critical conditions right now.</p></div>`;
  $$('[data-alert-go]', $('dashAlerts')).forEach(el => el.onclick = () => openStatTarget(el.dataset.alertGo));

  /* Momentum — the encouragement panel. */
  renderMomentum();

  /* Facilities */
  const lines = DB.get('inventory');
  const byHouse = groupBy(lines, l => l.house || 'Unassigned');
  const facRows = Object.entries(byHouse).map(([h, ls]) => ({ h, units: sum(ls, inHand), value: sum(ls, lineValue) }))
    .sort((a, b) => b.units - a.units);
  const maxF = Math.max(1, ...facRows.map(r => r.units));
  $('dashFacilities').innerHTML = facRows.length ? facRows.map(r =>
    barRow(r.h, r.units, maxF, r.units === 0 ? 'r' : '', fmt(r.units))).join('')
    + `<div class="kv mt-12"><div class="kv-row"><span class="k">Total facilities</span><span class="v">${facRows.length}</span></div>
       <div class="kv-row"><span class="k">Combined value</span><span class="v">${money(sum(facRows, r => r.value))}</span></div></div>`
    : '<div class="empty" style="padding:24px"><b>No stock lines</b><p>Add a catalogue item to start tracking.</p></div>';

  /* Activity feed */
  const feed = DB.get('audit').slice(0, 40);
  $('dashFeed').innerHTML = feed.length ? feed.map(a => `
    <div class="list-row">
      <span class="lead" style="background:${actionColor(a.action).bg};color:${actionColor(a.action).fg}">${actionColor(a.action).icon}</span>
      <span class="body"><b>${esc(a.details || a.action)}</b><small>${esc(a.user)} · ${esc(a.module)}</small></span>
      <span class="trail"><span class="fs-11 text-3 nowrap">${relTime(a.timestamp)}</span></span>
    </div>`).join('') : '<div class="empty" style="padding:24px"><b>No activity yet</b></div>';

  /* Composition donut */
  renderDonut('dashDonut', groupBy(lines, l => l.type || 'Regular'), inHand,
    (t) => ({ c: { Regular: 'var(--blue)', LMP: 'var(--purple)', Refurbished: 'var(--amber)', Repair: 'var(--red)' }[t] || 'var(--text-3)' }), 'Total units');

  /* Brands */
  const byBrand = groupBy(lines.filter(l => inHand(l) > 0), l => l.brand || 'Unbranded');
  const brandRows = Object.entries(byBrand).map(([b, ls]) => ({ b, units: sum(ls, inHand) })).sort((a, b) => b.units - a.units);
  const maxB = Math.max(1, ...brandRows.map(r => r.units));
  $('dashBrands').innerHTML = brandRows.length ? brandRows.map(r => barRow(r.b, r.units, maxB, '', fmt(r.units))).join('')
    : '<div class="empty" style="padding:24px"><b>No branded stock</b></div>';
}

function renderRevenueChart(days) {
  const host = $('dashChart');
  if (!host) return;
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({
      key,
      label: days <= 7 ? d.toLocaleDateString('en-GB', { weekday: 'short' }) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      sales: sum(DB.get('sales').filter(s => s.date === key), s => s.total),
      dispatches: DB.get('dispatches').filter(x => x.date === key).length
    });
  }
  const max = Math.max(1, ...buckets.map(b => b.sales));
  host.innerHTML = `<div class="cols">${buckets.map(b => `
    <div class="col" title="${esc(fmtDate(b.key))} — ${money(b.sales)} · ${b.dispatches} dispatches">
      <b>${b.sales ? money(b.sales) : ''}</b>
      <div class="stack"><div style="height:${Math.max(2, (b.sales / max) * 100)}%"></div></div>
      <span>${esc(b.label)}</span>
    </div>`).join('')}</div>
    <div class="row-wrap mt-12 fs-11 text-3" style="gap:14px">
      <span class="row gap-4"><span class="chip-dot" style="background:var(--amber)"></span>Revenue</span>
      <span class="row gap-4"><span class="chip-dot" style="background:var(--green)"></span>${DB.get('dispatches').filter(d => buckets.some(b => b.key === d.date)).length} dispatches in window</span>
      <span class="grow right">Peak ${money(max)}</span>
    </div>`;
}

function buildAlerts() {
  const out = [];
  const inv = DB.get('inventory');
  const outStock = inv.filter(l => inHand(l) <= 0);
  const low = inv.filter(l => { const n = inHand(l); return n > 0 && n <= threshold(); });
  const neg = inv.filter(l => inHand(l) < 0);
  const pendTrf = DB.get('transfers').filter(t => t.status === 'Pending');
  const inFlight = DB.get('transfers').filter(t => ['Dispatched', 'In Transit'].includes(t.status));
  const overdue = DB.get('invoices').filter(i => i.status === 'Overdue');
  const repParts = DB.get('repairs').filter(r => r.status === 'Awaiting Part');
  const repOld = DB.get('repairs').filter(r => !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status) && daysBetween(r.intakeDate, todayISO()) > 7);
  const pendLeave = DB.get('leaves').filter(l => l.status === 'Pending');
  const pendPay = DB.get('payroll').filter(p => p.status === 'Pending');
  const dupImei = findDuplicateImeis();
  const slowDispatch = DB.get('dispatches').filter(d => !['Delivered','Handed Over','Cancelled'].includes(d.status) && daysBetween(d.date, todayISO()) > 5);

  const add = (o) => out.push(o);
  if (outStock.length) add({ icon: '×', bg: 'var(--red-soft)', fg: 'var(--red)', cls: 'red', title: 'Out of stock lines', sub: 'No units available to sell', count: outStock.length, page: 'inventory', drill: 'inv:out' });
  if (low.length) add({ icon: '!', bg: 'var(--amber-soft)', fg: 'var(--amber-strong)', cls: 'amber', title: 'Below reorder point', sub: `At or under ${threshold()} units`, count: low.length, page: 'inventory', drill: 'inv:attention' });
  if (neg.length) add({ icon: '⚠', bg: 'var(--red-soft)', fg: 'var(--red)', cls: 'red', title: 'Negative stock detected', sub: 'Ledger integrity issue', count: neg.length, page: 'inventory', drill: 'inv:negative' });
  if (dupImei.length) add({ icon: '⧉', bg: 'var(--purple-soft)', fg: 'var(--purple)', cls: 'purple', title: 'Duplicate IMEI records', sub: 'Same identifier registered twice', count: dupImei.length, page: 'repairs', drill: 'rep:dupImei' });
  if (pendTrf.length) add({ icon: '⇋', bg: 'var(--amber-soft)', fg: 'var(--amber-strong)', cls: 'amber', title: 'Transfers awaiting approval', sub: 'Pending authorisation', count: pendTrf.length, page: 'transfers', drill: 'trf:pending' });
  if (inFlight.length) add({ icon: '✦', bg: 'var(--blue-soft)', fg: 'var(--blue)', cls: 'blue', title: 'Consignments in transit', sub: 'Not yet received', count: inFlight.length, page: 'dispatch', drill: 'dsp:open' });
  if (slowDispatch.length) add({ icon: '◴', bg: 'var(--amber-soft)', fg: 'var(--amber-strong)', cls: 'amber', title: 'Dispatches held over 5 days', sub: 'Follow up with the courier', count: slowDispatch.length, page: 'dispatch', drill: 'dsp:slow' });
  if (overdue.length) add({ icon: '◍', bg: 'var(--red-soft)', fg: 'var(--red)', cls: 'red', title: 'Overdue invoices', sub: 'Payment past the due date', count: overdue.length, page: 'invoices', drill: 'inv:overdue' });
  if (repParts.length) add({ icon: '◈', bg: 'var(--purple-soft)', fg: 'var(--purple)', cls: 'purple', title: 'Repairs awaiting parts', sub: 'Blocked on component supply', count: repParts.length, page: 'repairs', drill: 'rep:parts' });
  if (repOld.length) add({ icon: '◴', bg: 'var(--red-soft)', fg: 'var(--red)', cls: 'red', title: 'Repairs over 7 days old', sub: 'SLA breach risk', count: repOld.length, page: 'repairs', drill: 'rep:stale' });
  if (pendLeave.length) add({ icon: '⊚', bg: 'var(--blue-soft)', fg: 'var(--blue)', cls: 'blue', title: 'Leave requests pending', sub: 'Awaiting HR approval', count: pendLeave.length, page: 'leave', drill: 'leave:pending' });
  if (pendPay.length) add({ icon: '₳', bg: 'var(--amber-soft)', fg: 'var(--amber-strong)', cls: 'amber', title: 'Payslips not processed', sub: 'Payroll run incomplete', count: pendPay.length, page: 'payroll', drill: 'pay:pending' });
  const dupOrders = findDuplicateOrders();
  if (dupOrders.length) add({ icon: '⧉', bg: 'var(--red-soft)', fg: 'var(--red)', cls: 'red', title: 'Duplicate order numbers', sub: 'Reference collision detected', count: dupOrders.length, page: 'sales', drill: 'sale:duplicates' });
  /* Open trade-ins are the newest module and the easiest to forget mid-week,
   * so they get an alert of their own. */
  const pendTrade = DB.get('upgrades').filter(u => u.status === 'Issued');
  if (pendTrade.length) add({ icon: '⇄', bg: 'var(--teal-soft)', fg: 'var(--teal)', cls: 'blue', title: 'Trade-ins awaiting receipt', sub: 'New device issued, old one not in yet', count: pendTrade.length, page: 'upgrades', drill: 'upgrades:awaiting' });
  return out;
}

function findDuplicateImeis() {
  const seen = new Map(); const dups = new Set();
  DB.get('imeis').forEach(r => { const k = norm(r.imei); if (!k) return; if (seen.has(k)) dups.add(k); else seen.set(k, r); });
  DB.get('repairs').forEach(r => {
    [r.imei, r.imei2].forEach(v => {
      const k = norm(v); if (!k) return;
      if (seen.has(k)) dups.add(k); else seen.set(k, r);
    });
  });
  return [...dups];
}
function findDuplicateOrders() {
  const seen = new Set(); const dups = new Set();
  DB.get('sales').forEach(s => { const k = norm(s.orderId); if (!k) return; if (seen.has(k)) dups.add(k); else seen.add(k); });
  return [...dups];
}
function actionColor(action) {
  const a = String(action || '').toUpperCase();
  if (/DELETE|REMOVE|FAIL|ERROR/.test(a)) return { bg: 'var(--red-soft)', fg: 'var(--red)', icon: '✕' };
  if (/CREATE|ADD|NEW/.test(a)) return { bg: 'var(--green-soft)', fg: 'var(--green)', icon: '＋' };
  if (/APPROVE|PAY|PROCESS|COMPLETE|CLOSE/.test(a)) return { bg: 'var(--blue-soft)', fg: 'var(--blue)', icon: '✓' };
  if (/MOVE|IN|OUT|RECEIVE|DISPATCH|TRANSFER/.test(a)) return { bg: 'var(--amber-soft)', fg: 'var(--amber-strong)', icon: '⇄' };
  if (/EXPORT|PRINT|REPORT/.test(a)) return { bg: 'var(--purple-soft)', fg: 'var(--purple)', icon: '▤' };
  if (/LOGIN|LOGOUT|SWITCH/.test(a)) return { bg: 'var(--grey-soft)', fg: 'var(--text-2)', icon: '◉' };
  return { bg: 'var(--grey-soft)', fg: 'var(--text-2)', icon: '•' };
}
function renderDonut(hostId, grouped, valFn, colorFn, centerLabel) {
  const host = $(hostId);
  if (!host) return;
  const rows = Object.entries(grouped).map(([k, arr]) => ({ k, v: sum(arr, valFn) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const total = sum(rows, r => r.v);
  if (!total) { host.innerHTML = `<div class="empty" style="padding:26px"><b>No data</b><p>Nothing to chart yet.</p></div>`; return; }
  let acc = 0;
  const stops = rows.map(r => {
    const from = (acc / total) * 360; acc += r.v;
    return `${colorFn(r.k)} ${from}deg ${(acc / total) * 360}deg`;
  }).join(', ');
  host.innerHTML = `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(${stops})">
      <div class="donut-center"><b>${fmt(total)}</b><small>${esc(centerLabel)}</small></div>
    </div>
    <div class="legend">
      ${rows.map(r => `<div class="legend-row">
        <span class="chip-dot" style="background:${colorFn(r.k)}"></span>
        <span class="nm">${esc(r.k)}</span>
        <b>${fmt(r.v)}</b>
        <span class="text-3" style="min-width:44px;text-align:right">${Math.round(r.v / total * 100)}%</span>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ------------------------------------------------------------- Inventory */
function invFilters() {
  return {
    q: norm($('invSearch')?.value),
    type: $('invType')?.value || '',
    brand: $('invBrand')?.value || '',
    house: $('invHouse')?.value || '',
    status: $('invStatus')?.value || ''
  };
}
function renderInventory() {
  fillSelect('invType', STOCK_TYPES, 'All categories');
  fillSelect('invBrand', brandOptions(), 'All brands');
  fillSelect('invHouse', DB.get('locations').map(l => l.name), 'All facilities');

  const inv = DB.get('inventory');
  const f = invFilters();
  $('invStats').innerHTML = [
    statCard({ onClick: 'inv:units', icon: '▦', label: 'Total units', value: fmt(totalUnits()), meta: 'Available to sell', color: 'amber' }),
    statCard({ onClick: 'inv:value', icon: '◫', label: 'Stock value', value: money(inventoryValue()), meta: 'Landed cost basis', color: 'green' }),
    statCard({ onClick: 'inv:catalogue', icon: '◉', label: 'Catalogue lines', value: fmt(DB.get('items').length), meta: `${inv.length} stock lines`, color: 'blue' }),
    statCard({ onClick: 'inv:attention', icon: '⚠', label: 'Needs attention', value: fmt(inv.filter(l => inHand(l) <= threshold()).length), meta: 'At or below reorder point', color: 'red' })
  ].join('');

  const view = $('invViewSeg')?.querySelector('button.on')?.dataset.view || 'lines';

  if (view === 'items') {
    let items = DB.get('items');
    if (f.q) items = items.filter(i => [i.model, i.sku, i.brand, i.type, i.config, i.note].join(' ').toLowerCase().includes(f.q));
    if (f.type) items = items.filter(i => i.type === f.type);
    if (f.brand) items = items.filter(i => i.brand === f.brand);
    const availFor = (item) => sum(inv.filter(l => l.itemId === item.id || norm(l.sku) === norm(item.model)), inHand);
    Pagers.render('invItems', {
      mount: 'invTable', foot: 'invFoot', rows: items, unit: 'lines',
      emptyTitle: 'No catalogue lines match', emptyText: 'Adjust the filters, or add a new item to the catalogue.',
      columns: [
        { key: 'model', label: 'Model / SKU', render: r => `<b>${esc(r.model)}</b><span class="row-sub">${esc(r.config || '—')}</span>` },
        { key: 'brand', label: 'Brand', render: r => esc(r.brand || '—') },
        { key: 'type', label: 'Category', render: r => typeBadge(r.type) },
        { key: 'available', label: 'Available', align: 'right', sortVal: availFor, render: r => `<b>${fmt(availFor(r))}</b>` },
        { key: 'cost', label: 'Cost', align: 'right', render: r => money(r.cost) },
        { key: 'price', label: 'Margin', align: 'right', sortVal: r => num(r.price) - num(r.cost), render: r => {
          const m = num(r.price) - num(r.cost);
          const pct = num(r.cost) > 0 ? (m / num(r.cost) * 100) : 0;
          return `<b class="${m >= 0 ? 'c-green' : 'c-red'}">${money(m)}</b><span class="row-sub">${pct.toFixed(1)}%</span>`;
        }},
        { key: 'warrantyMonths', label: 'Warranty', align: 'center', render: r => r.warrantyMonths ? `<span class="badge grey">${r.warrantyMonths} mo</span>` : '—' },
        { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
          <div class="actions">
            <button class="btn xs" data-item-view="${r.id}">View</button>
            <button class="btn xs" data-item-edit="${r.id}">Edit</button>
          </div>` }
      ],
      onRow: r => openItemDrawer(r.id)
    });
    $('invCount').textContent = `${items.length} catalogue lines`;
    bindTableButtons('invTable', { 'item-edit': id => Modals.itemForm(DB.byId('items', id)), 'item-view': id => openItemDrawer(id) });
    return;
  }

  let rows = inv;
  if (f.q) {
    rows = rows.filter(l => {
      const hay = [l.sku, l.brand, l.house, l.color, l.type].join(' ').toLowerCase();
      if (hay.includes(f.q)) return true;
      const q = imeiDigits(f.q);
      if (q.length >= 6) return DB.get('imeis').some(i => imeiDigits(i.imei).includes(q) && (norm(i.sku) === norm(l.sku) || !i.sku));
      return false;
    });
  }
  if (f.type) rows = rows.filter(l => l.type === f.type);
  if (f.brand) rows = rows.filter(l => l.brand === f.brand);
  if (f.house) rows = rows.filter(l => l.house === f.house);
  if (f.status) rows = rows.filter(l => {
    const n = inHand(l);
    if (f.status === 'healthy') return n > threshold();
    if (f.status === 'low') return n > 0 && n <= threshold();
    if (f.status === 'critical') return n > 0 && n <= 5;
    if (f.status === 'out') return n <= 0;
    return true;
  });

  $('invCount').textContent = `${fmt(rows.length)} stock lines`;
  const filtered = rows;

  Pagers.render('invLines', {
    mount: 'invTable', foot: 'invFoot', rows, unit: 'lines',
    selectable: true,
    bulkActions: [
      Sel.act.status('inventory', 'status', [
        { label: 'Mark healthy', value: 'healthy' },
        { label: 'Mark low', value: 'low' },
        { label: 'Mark critical', value: 'critical' },
        { label: 'Mark out', value: 'out' }
      ], 'status'),
      Sel.act.edit('inventory', 'unitCost', 'Cost', 'number'),
      Sel.act.edit('inventory', 'unitPrice', 'Price', 'number'),
      Sel.act.delete('inventory')
    ],
    emptyTitle: 'No stock lines match', emptyText: 'Adjust your filters or add a catalogue item first.',
    columns: [
      { key: 'sku', label: 'SKU / Model', render: r => `<b>${esc(r.sku)}</b><span class="row-sub">${esc(r.color || '—')}</span>` },
      { key: 'brand', label: 'Brand' },
      { key: 'type', label: 'Category', render: r => typeBadge(r.type) },
      { key: 'house', label: 'Facility' },
      { key: 'openingQty', label: 'Open', align: 'right' },
      { key: 'inQty', label: 'IN', align: 'right', render: r => `<b class="c-green">+${fmt(r.inQty)}</b>` },
      { key: 'outQty', label: 'OUT', align: 'right', render: r => `<b class="c-red">−${fmt(r.outQty)}</b>` },
      { key: 'transferInQty', label: 'Transfer', align: 'right', render: r => `<span class="fs-11 text-3">+${fmt(r.transferInQty)} / −${fmt(r.transferOutQty)}</span>` },
      { key: 'soldQty', label: 'Sold', align: 'right', render: r => `<span class="c-blue">${fmt(r.soldQty)}</span>` },
      { key: 'available', label: 'In hand', align: 'right', sortVal: inHand, render: r => {
        const n = inHand(r);
        return `<b style="font-size:14px;color:${n <= 0 ? 'var(--red)' : n <= threshold() ? 'var(--amber)' : 'var(--green)'}">${fmt(n)}</b>`;
      }},
      { key: 'value', label: 'Value', align: 'right', sortVal: lineValue, render: r => money(lineValue(r)) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-line-move="${r.id}" title="Record movement">⇄</button>
          <button class="btn xs" data-line-adj="${r.id}" title="Reconcile">⚖</button>
          <button class="btn xs" data-line-imei="${r.id}" title="IMEIs on this line">▣</button>
        </div>` }
    ],
    footRow: (c, all) => c.key === 'sku' ? 'Totals' : '',
    footRowCells: ['Totals', '', '', '', fmt(sum(filtered, r => r.openingQty)), fmt(sum(filtered, r => r.inQty)), fmt(sum(filtered, r => r.outQty)), '', fmt(sum(filtered, r => r.soldQty)), fmt(sum(filtered, inHand)), money(sum(filtered, lineValue)), ''],
    onRow: r => openItemDrawer(null, r.id)
  });

  bindTableButtons('invTable', {
    'line-move': id => Modals.movementForm(DB.byId('inventory', id)),
    'line-adj': id => Modals.reconcileForm(DB.byId('inventory', id)),
    'line-imei': id => openLineImeis(id)
  });
}

function bindTableButtons(mountId, map) {
  Object.entries(map).forEach(([attr, fn]) => {
    $$(`[data-${attr}]`, $(mountId)).forEach(b => b.onclick = e => { e.stopPropagation(); fn(b.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())]); });
  });
}

function openLineImeis(lineId) {
  const line = DB.byId('inventory', lineId);
  if (!line) return;
  const rows = DB.get('imeis').filter(i => norm(i.sku) === norm(line.sku) && (!i.color || norm(i.color) === norm(line.color)));
  openModal({
    width: 'lg', title: 'IMEI registry — ' + line.sku,
    sub: `${line.color} · ${line.house} · ${fmt(inHand(line))} units available`,
    body: rows.length ? `<div class="table-scroll"><table class="dt">
      <thead><tr><th>IMEI</th><th>Status</th><th>Facility</th><th>Reference</th><th>Recorded</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="mono">${esc(r.imei)}</td><td>${statusBadge(r.status)}</td>
        <td>${esc(r.house || '—')}</td><td>${esc(r.ticketNo || r.note || '—')}</td>
        <td class="text-3 fs-11">${esc(fmtDate(r.addedAt))}</td></tr>`).join('')}</tbody>
      </table></div>`
      : `<div class="empty"><div class="big">▣</div><b>No serials registered</b><p>Attach IMEIs by recording a movement with serial numbers for this line.</p></div>`,
    foot: `<button class="btn" data-x>Close</button><button class="btn primary" data-scan>▣ Scan IMEIs</button>`,
    onMount(el) {
      qs('[data-scan]', el).onclick = () => { closeModal(el); openScanner(v => Modals.movementForm(line, { imeis: [v] })); };
    }
  });
}

function openItemDrawer(itemId, lineId) {
  let item = itemId ? DB.byId('items', itemId) : null;
  let line = lineId ? DB.byId('inventory', lineId) : null;
  if (!item && line) item = DB.get('items').find(i => i.id === line.itemId || norm(i.model) === norm(line.sku)) || null;

  /* Both ids can miss. A record can be deleted between a summary being drawn
   * and the row being clicked, and a drill can hand this function an id of the
   * wrong kind. Either way `line` ends up null while `item` is also null, and
   * the lookups below would dereference it. Say so and stop, rather than
   * throwing halfway through building the markup — a thrown error here leaves
   * the drill's modal already closed and the user with nothing at all. */
  if (!item && !line) {
    toast('That record is no longer available', 'warn');
    return null;
  }

  const lines = line ? DB.get('inventory').filter(l => l.id === line.id) : DB.get('inventory').filter(l => (item && (l.itemId === item.id || norm(l.sku) === norm(item.model))));
  const available = sum(lines, inHand);
  const mv = DB.get('movements').filter(m => (item ? norm(m.sku) === norm(item.model) : lines.some(l => norm(l.sku) === norm(m.sku)))).slice(0, 25);
  const imeis = DB.get('imeis').filter(i => (item ? norm(i.sku) === norm(item.model) : norm(i.sku) === norm(line.sku)));
  const rep = DB.get('repairs').filter(r => (item ? norm(r.model) === norm(item.model) : norm(r.model) === norm(line.sku)));

  const breakdown = [
    ['Opening', num(lines[0] && lines[0].openingQty), 'grey'],
    ['Received in', sum(lines, l => l.inQty), 'green'],
    ['Issued out', -sum(lines, l => l.outQty), 'red'],
    ['Transfers in', sum(lines, l => l.transferInQty), 'green'],
    ['Transfers out', -sum(lines, l => l.transferOutQty), 'red'],
    ['Returned', sum(lines, l => l.returnQty), 'green'],
    ['Sold', -sum(lines, l => l.soldQty), 'red'],
    ['Adjustments', sum(lines, l => l.adjustedQty), 'blue']
  ];

  openModal({
    drawer: true, autofocus: false,
    title: line ? `${line.sku}` : (item ? item.model : 'Item'),
    sub: line ? `${line.brand} · ${line.color} · ${line.house}` : (item ? `${item.brand} · ${item.config || '—'}` : ''),
    body: `
      <div class="stats" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'inv:units', icon: '▦', label: 'Available', value: fmt(available), meta: `${lines.length} stock line(s)`, color: 'amber' })}
        ${statCard({ onClick: 'inv:value', icon: '◫', label: 'Value', value: money(sum(lines, lineValue)), meta: `Cost ${money(item ? item.cost : (line ? line.unitCost : 0))}`, color: 'green' })}
      </div>
      ${item ? `<div class="section-title">Catalogue</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Category</span><span class="v">${typeBadge(item.type)}</span></div>
        <div class="kv-row"><span class="k">Configuration</span><span class="v">${esc(item.config || '—')}</span></div>
        <div class="kv-row"><span class="k">Unit cost</span><span class="v">${money(item.cost)}</span></div>
        <div class="kv-row"><span class="k">Retail price</span><span class="v">${money(item.price)}</span></div>
        <div class="kv-row"><span class="k">Warranty</span><span class="v">${item.warrantyMonths || 0} months</span></div>
        <div class="kv-row"><span class="k">Reorder point</span><span class="v">${fmt(item.reorderPoint)}</span></div>
        ${item.note ? `<div class="kv-row"><span class="k">Note</span><span class="v" style="font-weight:600">${esc(item.note)}</span></div>` : ''}
      </div>` : ''}
      <div class="section-title">Ledger breakdown</div>
      <div class="kv mb-16">${breakdown.map(([k, v, c]) => `<div class="kv-row"><span class="k">${k}</span><span class="v ${v < 0 ? 'c-red' : v > 0 ? 'c-green' : ''}">${v > 0 && c === 'green' ? '+' : ''}${fmt(v)}</span></div>`).join('')}
        <div class="kv-row" style="border-top:2px solid var(--line)"><span class="k"><b>Available balance</b></span><span class="v" style="font-size:16px;color:${available <= 0 ? 'var(--red)' : 'var(--green)'}"><b>${fmt(available)}</b></span></div>
      </div>
      ${lines.length > 1 ? `<div class="section-title">Across facilities</div>
      <div class="mb-16">${lines.map(l => {
        const n = inHand(l);
        return barRow(l.house, n, Math.max(1, ...lines.map(inHand)), n <= 0 ? 'r' : n <= threshold() ? '' : 'g', fmt(n));
      }).join('')}</div>` : ''}
      ${imeis.length ? `<div class="section-title">IMEI registry (${imeis.length})</div>
      <div class="row-wrap mb-16" style="max-height:120px;overflow-y:auto">${imeis.slice(0, 40).map(i => `<span class="tag-pill mono">${esc(i.imei)}</span>`).join('')}</div>` : ''}
      ${rep.length ? `<div class="section-title">Related repairs (${rep.length})</div><div class="mb-16">${rep.slice(0, 6).map(r => `<div class="list-row"><span class="body"><b>${esc(r.ticketNo)}</b><small>${esc(r.defectType)} · ${esc(r.technician || 'Unassigned')}</small></span><span class="trail">${statusBadge(r.status)}</span></div>`).join('')}</div>` : ''}
      <div class="section-title">Photos</div>
      <div class="mb-16" id="attHost"></div>
      <div class="section-title">Recent movements</div>
      ${mv.length ? mv.map(m => {
        /* Sign and magnitude are taken from the row itself rather than assumed
         * from the type, because an ADJUST carries its direction in its own
         * quantity. `fmt` on a negative would print "-5" behind an explicit
         * sign, giving "--5". */
        const eff = movementEffect(m);
        const in_ = eff > 0;
        return `<div class="list-row">
        <span class="lead" style="background:${in_ ? 'var(--green-soft)' : 'var(--red-soft)'};color:${in_ ? 'var(--green)' : 'var(--red)'}">${in_ ? '↓' : '↑'}</span>
        <span class="body"><b>${esc(m.trxRef)}</b><small>${esc(m.house)} · ${esc(m.note || m.source || '-')}</small></span>
        <span class="trail"><b class="${in_ ? 'c-green' : 'c-red'}">${in_ ? '+' : '-'}${fmt(Math.abs(eff))}</b><br><span class="fs-11 text-3">${esc(fmtDate(m.date))}</span></span>
      </div>`;
      }).join('') : '<p class="text-3 fs-12">No movements recorded for this line.</p>'}`,
    foot: `${canWrite('inventory') ? `<button class="btn left" data-move>⇄ Movement</button>` : ''}
           ${canWrite('inventory') ? `<button class="btn left" data-adj>⚖ Reconcile</button>` : ''}
           ${Attachments.buttons(canWrite('inventory'))}
           <button class="btn" data-x>Close</button>
           ${item && canWrite('inventory') ? `<button class="btn primary" data-edit>Edit item</button>` : ''}`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const mv2 = qs('[data-move]', el); if (mv2) mv2.onclick = () => { closeModal(el); Modals.movementForm(line || lines[0]); };
      const aj = qs('[data-adj]', el); if (aj) aj.onclick = () => { closeModal(el); Modals.reconcileForm(line || lines[0]); };
      const ed = qs('[data-edit]', el); if (ed) ed.onclick = () => { closeModal(el); Modals.itemForm(item); };

      /* Photos hang off the stock line, so a line-less item view attaches to
       * the first line and falls back to the catalogue id. */
      const attId = (line || lines[0] || {}).id || (item && item.id);
      if (attId) Attachments.mount(qs('#attHost', el), 'inventory', attId);
    }
  });
}

/* ------------------------------------------------------------- Movements */
function renderMovements() {
  const mv = DB.get('movements');
  const q = norm($('mvSearch')?.value);
  const type = $('mvType')?.value || '';
  const house = $('mvHouse')?.value || '';
  const days = $('mvDays')?.value || '';

  fillSelect('mvType', ['IN','OUT','SALE','RETURN','ADJUST','TRANSFER IN','TRANSFER OUT'], 'All types');
  fillSelect('mvHouse', DB.get('locations').map(l => l.name), 'All facilities');

  let rows = mv;
  if (q) rows = rows.filter(m => [m.sku, m.trxRef, m.user, m.note, m.house, m.brand].join(' ').toLowerCase().includes(q));
  if (type) rows = rows.filter(m => m.type === type);
  if (house) rows = rows.filter(m => m.house === house);
  if (days) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(days));
    rows = rows.filter(m => new Date(m.date) >= cutoff);
  }

  Pagers.render('mv', {
    mount: 'mvTable', foot: 'mvFoot', rows, unit: 'movements',
    selectable: true,
    bulkActions: [
      Sel.act.exportRows('movements', 'movements', sel => {
        const hdr = ['trxRef','date','type','sku','color','house','qty','source','note','user','imeis'];
        return [hdr].concat(sel.map(r => [r.trxRef,r.date,r.type,r.sku,r.color||'',r.house,r.qty,r.source||'',r.note||'',r.user,(r.imeis||[]).map(x=>x.imei).join('|')]));
      })
    ],
    emptyTitle: 'No movements recorded', emptyText: 'Use “Record movement” to receive or issue stock.',
    columns: [
      { key: 'trxRef', label: 'Reference', render: r => `<b class="mono">${esc(r.trxRef)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'type', label: 'Type', render: r => `<span class="badge ${r.type === 'IN' ? 'green' : ['OUT','SALE'].includes(r.type) ? 'red' : r.type === 'ADJUST' ? 'blue' : 'amber'}">${esc(r.type)}</span>` },
      { key: 'sku', label: 'Item', render: r => `<b>${esc(r.sku)}</b><span class="row-sub">${esc(r.color || '')}</span>` },
      { key: 'house', label: 'Facility' },
      { key: 'qty', label: 'Qty', align: 'right', render: r => {
        /* Sign from the row's own effect, magnitude from its absolute value, so
         * a negative adjustment prints "-3" and not "--3". */
        const eff = movementEffect(r);
        const cls = r.type === 'ADJUST' ? 'c-blue' : eff > 0 ? 'c-green' : 'c-red';
        return `<b class="${cls}">${eff > 0 ? '+' : eff < 0 ? '−' : ''}${fmt(Math.abs(eff))}</b>`;
      } },
      { key: 'source', label: 'Source / Destination' },
      { key: 'note', label: 'Note', render: r => `<span class="fs-12 text-2">${esc(r.note || '—')}</span>` },
      { key: 'imeis', label: 'Serials', align: 'center', sortVal: r => (r.imeis || []).length, render: r => (r.imeis || []).length ? `<span class="badge purple" title="${esc((r.imeis || []).map(x => x.imei).join(', '))}">${(r.imeis).length}</span>` : '—' },
      { key: 'user', label: 'By', render: r => `<span class="fs-12">${esc(r.user)}</span>` }
    ]
  });

  /* Summary panel */
  const tISO = todayISO();
  const thisMonth = monthKey(new Date());
  /* Customer returns were previously in neither total, so goods coming back
   * were invisible here while inHand() counted them. Shared sign table. */
  const inM = mv.filter(m => movementSign(m.type) > 0 && monthKey(m.date) === thisMonth);
  const outM = mv.filter(m => movementSign(m.type) < 0 && monthKey(m.date) === thisMonth);
  const tIn = sum(mv.filter(m => movementSign(m.type) > 0 && m.date === tISO), m => m.qty);
  const tOut = sum(mv.filter(m => movementSign(m.type) < 0 && m.date === tISO), m => m.qty);
  const topMovers = Object.entries(groupBy(mv.filter(m => monthKey(m.date) === thisMonth), m => m.sku))
    .map(([sku, list]) => ({ sku, qty: sum(list, m => m.qty) }))
    .sort((a, b) => b.qty - a.qty).slice(0, 8);
  const maxM = Math.max(1, ...topMovers.map(m => m.qty));

  $('mvSummary').innerHTML = `
    <div class="eyebrow" style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);font-weight:800;">Ledger snapshot</div>
    <h3 style="font-size:19px;margin:6px 0 14px;letter-spacing:-.035em">Today</h3>
    <div class="kv">
      <div class="kv-row"><span class="k">Received</span><span class="v c-green">+${fmt(tIn)}</span></div>
      <div class="kv-row"><span class="k">Issued</span><span class="v c-red">−${fmt(tOut)}</span></div>
      <div class="kv-row"><span class="k">Net</span><span class="v">${tIn - tOut >= 0 ? '+' : ''}${fmt(tIn - tOut)}</span></div>
      <div class="kv-row"><span class="k">Entries today</span><span class="v">${mv.filter(m => m.date === tISO).length}</span></div>
    </div>
    <div class="section-title mt-16">${esc(monthLabel(thisMonth))} movement</div>
    <div class="kv">
      <div class="kv-row"><span class="k">Received</span><span class="v c-green">+${fmt(sum(inM, m => m.qty))}</span></div>
      <div class="kv-row"><span class="k">Issued</span><span class="v c-red">−${fmt(sum(outM, m => m.qty))}</span></div>
      <div class="kv-row"><span class="k">Entries</span><span class="v">${inM.length + outM.length}</span></div>
    </div>
    <div class="section-title mt-16">Top movers this month</div>
    ${topMovers.length ? topMovers.map(m => barRow(m.sku, m.qty, maxM, 'b', fmt(m.qty))).join('') : '<p class="text-3 fs-12">No movement this month.</p>'}
    <button class="btn primary block mt-16" data-new-move>+ Record movement</button>`;
  const nm = qs('[data-new-move]', $('mvSummary'));
  if (nm) nm.onclick = () => { if (requireWrite('movements', 'record movements')) Modals.movementForm(); };
}

/* ------------------------------------------------------------- Transfers */
function transferTabs() { return state.ui.trfTab || 'Active'; }
function renderTransfers() {
  const all = DB.get('transfers');
  const buckets = {
    Active: all.filter(t => !['Complete', 'Cancelled'].includes(t.status)),
    Pending: all.filter(t => t.status === 'Pending'),
    'In Transit': all.filter(t => ['Approved', 'Dispatched', 'In Transit'].includes(t.status)),
    Complete: all.filter(t => t.status === 'Complete'),
    All: all
  };
  const labels = { Active: 'Active', Pending: 'Awaiting approval', 'In Transit': 'In transit', Complete: 'Completed', All: 'All' };
  $('trfTabs').innerHTML = Object.keys(buckets).map(k =>
    `<button data-trf-tab="${k}" class="${transferTabs() === k ? 'on' : ''}">${labels[k]} <span class="tab-n">${buckets[k].length}</span></button>`).join('');
  $$('[data-trf-tab]', $('trfTabs')).forEach(b => b.onclick = () => { state.ui.trfTab = b.dataset.trfTab; renderTransfers(); });

  let rows = sortBy(buckets[transferTabs()] || [], t => t.date, -1);
  const q = norm($('trfSearch')?.value);
  if (q) rows = rows.filter(t => [t.transferRef, t.fromLocation, t.toLocation, t.carrier, t.requestedBy].join(' ').toLowerCase().includes(q));

  Pagers.render('trf', {
    mount: 'trfTable', foot: 'trfFoot', rows, unit: 'transfers',
    selectable: true,
    bulkActions: [
      /* Only statuses that are pure bookkeeping are offered. Approving or
       * dispatching moves stock, and each of those needs its own per-transfer
       * confirmation — a bulk button that silently relocates inventory is a
       * footgun, not a feature. */
      Sel.act.status('transfers', 'status', [
        { label: 'Approve', value: 'Approved' },
        { label: 'Mark dispatched', value: 'Dispatched' },
        { label: 'Mark complete', value: 'Complete' },
        { label: 'Cancel', value: 'Cancelled' }
      ], 'status'),
      Sel.act.exportRows('transfers', 'transfers', selRows => [
        ['Ref', 'Date', 'From', 'To', 'Units', 'Carrier', 'Tracking', 'Requested by', 'Approved by', 'Status'],
        ...selRows.map(t => [t.transferRef, t.date, t.fromLocation, t.toLocation, num(t.totalUnits),
          t.carrier, t.tracking, t.requestedBy, t.approvedBy, t.status])
      ])
    ],
    emptyTitle: 'No transfers in this view', emptyText: 'Create a transfer request to move stock between facilities.',
    columns: [
      { key: 'transferRef', label: 'Transfer ref', render: r => `<b class="mono">${esc(r.transferRef)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'fromLocation', label: 'From', render: r => `<span class="row gap-4">${esc(r.fromLocation)}<span class="text-3">→</span></span>` },
      { key: 'toLocation', label: 'To', render: r => `<b>${esc(r.toLocation)}</b>` },
      { key: 'items', label: 'Items', sortable: false, render: r => `<span class="fs-12">${esc((r.items || []).map(i => `${i.sku} (${i.color}) ×${i.qty}`).join(', '))}</span><span class="row-sub">${fmt(r.totalUnits)} units total</span>` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'requestedBy', label: 'Requested', render: r => `<span class="fs-12">${esc(r.requestedBy || '—')}</span><span class="row-sub">${r.approvedBy ? 'Appr. ' + esc(r.approvedBy) : 'Not approved'}</span>` },
      { key: 'carrier', label: 'Carrier', render: r => `<span class="fs-12">${esc(r.carrier || '—')}</span>${r.tracking ? `<span class="row-sub mono">${esc(r.tracking)}</span>` : ''}` },
      { key: 'totalUnits', label: 'Units', align: 'right', render: r => `<b>${fmt(r.totalUnits)}</b>` },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => transferActions(r) }
    ]
  });
  bindTableButtons('trfTable', {
    'trf-approve': ref => advanceTransfer(ref, 'Approved'),
    'trf-dispatch': ref => advanceTransfer(ref, 'Dispatched'),
    'trf-transit': ref => advanceTransfer(ref, 'In Transit'),
    'trf-receive': ref => advanceTransfer(ref, 'Received'),
    'trf-complete': ref => advanceTransfer(ref, 'Complete'),
    'trf-cancel': ref => cancelTransfer(ref),
    'trf-print': ref => Docs.gatePass(ref)
  });
}
function transferActions(t) {
  const can = canWrite('transfers');
  const u = state.session.user;
  const b = [];
  if (can && t.status === 'Pending') b.push(`<button class="btn xs success" data-trf-approve="${t.transferRef}">Approve</button>`);
  if (can && t.status === 'Approved') b.push(`<button class="btn xs primary" data-trf-dispatch="${t.transferRef}">Dispatch</button>`);
  if (can && t.status === 'Dispatched') b.push(`<button class="btn xs primary" data-trf-transit="${t.transferRef}">In transit</button>`);
  if (can && ['Dispatched','In Transit'].includes(t.status)) b.push(`<button class="btn xs success" data-trf-receive="${t.transferRef}">Receive</button>`);
  if (can && t.status === 'Received') b.push(`<button class="btn xs success" data-trf-complete="${t.transferRef}">Complete</button>`);
  b.push(`<button class="btn xs" data-trf-print="${t.transferRef}" title="Print gate pass">🖨</button>`);
  if (can && !['Complete'].includes(t.status)) b.push(`<button class="btn xs danger" data-trf-cancel="${t.transferRef}" title="Cancel">✕</button>`);
  return `<div class="actions">${b.join('')}</div>`;
}
async function advanceTransfer(ref, next) {
  const t = DB.get('transfers').find(x => x.transferRef === ref);
  if (!t) return;
  const u = state.session.user;
  if (next === 'Approved') t.approvedBy = u.name;
  if (next === 'Dispatched') { t.dispatchedBy = u.name; t.dispatchedDate = todayISO(); }
  if (next === 'Received') t.receivedBy = u.name;
  if (next === 'Complete') t.completedDate = todayISO();

  /* Apply the physical movement of stock, and record one ledger row per line
   * item.
   *
   * The old code posted a SINGLE row for the whole transfer, carrying the first
   * item's SKU and the transfer's TOTAL unit count. A gate pass for three
   * models totalling 20 units was therefore logged as 20 units of whichever
   * model happened to be first in the list: the ledger claimed stock moved that
   * never moved, and the on-hand figures it was supposed to explain disagreed
   * with it by construction. One row per item is what makes the audit trail
   * reconcile.
   *
   * The line it also removed, `DB.update('movements', DB.get('movements')[0].id, {})`,
   * rewrote the OLDEST movement in the database with an empty patch on every
   * single transfer. It did nothing useful and it touched an unrelated record. */
  const moveItems = next === 'Dispatched' || next === 'Complete';
  if (moveItems) {
    const outbound = next === 'Dispatched';
    (t.items || []).forEach(it => {
      const qty = num(it.qty);
      if (qty <= 0) return;
      const house = outbound ? t.fromLocation : t.toLocation;
      if (outbound) {
        const src = findLine(it.sku, t.fromLocation, it.color);
        if (!src) {
          toast(`No ${it.sku} line at ${t.fromLocation} — nothing moved`, 'warn');
          return;
        }
        bumpLine(src, 'transferOutQty', qty);
      } else {
        const dst = resolveLine({ sku: it.sku, house: t.toLocation, color: it.color });
        bumpLine(dst, 'transferInQty', qty);
      }
      DB.insert('movements', {
        trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
        type: outbound ? 'TRANSFER OUT' : 'TRANSFER IN',
        sku: it.sku, brand: '', itemType: '',
        house, color: it.color || '', qty, date: todayISO(),
        note: `Transfer ${t.transferRef} → ${next}`, source: t.carrier || 'Internal',
        user: u.name, role: u.role, timestamp: nowISO(), imeis: [],
        transferRef: t.transferRef
      });
    });
  }
  const nextIdx = TRANSFER_STAGES.indexOf(next);
  const nextStage = (nextIdx >= 0 && nextIdx < TRANSFER_STAGES.length - 1) ? TRANSFER_STAGES[nextIdx + 1] : 'Complete';
  /* Spread first, then the overrides — otherwise `t` reverts the new status. */
  DB.update('transfers', t.id, Object.assign({}, t, { status: next, nextStage }));
  audit('TRANSFER', 'Transfers', t.transferRef, `${t.fromLocation} → ${t.toLocation} marked ${next}`);
  toast(`Transfer ${t.transferRef} → ${next}`, 'good');
  renderAll();
}
async function cancelTransfer(ref) {
  const ok = await confirmDialog({
    title: 'Cancel transfer?', danger: true, confirmLabel: 'Cancel transfer',
    message: `Transfer ${ref} will be voided.`,
    detail: 'Stock already dispatched will not be automatically returned — issue a compensating movement if required.'
  });
  if (!ok) return;
  const t = DB.get('transfers').find(x => x.transferRef === ref);
  DB.update('transfers', t.id, { status: 'Cancelled', cancelledBy: state.session.user.name, cancelledDate: todayISO() });
  audit('CANCEL', 'Transfers', ref, 'Transfer cancelled');
  toast('Transfer cancelled', 'warn');
  renderTransfers(); renderNav();
}

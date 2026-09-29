/* ==========================================================================
   AMAYA ERP — Data reference (drill registry)
   ----------------------------------------------------------------------------
   Every stat card, alert row and summary number in the app should answer a
   second question: "which records is that?" This module is the answer.

   Two tiers, so no card is a dead end:

     1. A page drill. Every PAGE_META key has one. It lists that page's own
        records in a compact table. This is the floor: a card that names a page
        always resolves to data, even if no bespoke drill was written for it.

     2. A bespoke drill. `inv:low`, `fin:overdue`, `rep:overdue` and friends
        resolve to the *filtered subset* that the number was actually computed
        from, which is the thing the user was really asking about.

   Keys are namespaced `page[:metric]`. `openStatTarget()` in 16-experience.js
   prefers a drill and falls back to plain navigation, so adding a card never
   requires touching this file to stay functional.
   ========================================================================= */

/** Compact column sets reused by several drills. */
const DC = {
  item:   { label: 'Item', render: r => `<b>${esc(r.sku || r.model || '—')}</b><span class="row-sub">${esc(r.color || r.config || r.type || '')}</span>` },
  brand:  { label: 'Brand', render: r => esc(r.brand || '—') },
  house:  { label: 'Facility', render: r => esc(r.house || r.toLocation || '—') },
  date:   { label: 'Date', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.date || r.createdAt))}</span>` },
  status: { label: 'Status', render: r => statusBadge(r.status) },
  who:    { label: 'By', render: r => `<span class="fs-12">${esc(r.user || r.employeeName || r.customerName || '—')}</span>` },
  money:  { label: 'Amount', align: 'right', render: r => `<b>${money(r.total != null ? r.total : (r.amount != null ? r.amount : 0))}</b>` },
  qty:    { label: 'Qty', align: 'right', render: r => `<b>${fmt(r.qty)}</b>` },
  inHand: { label: 'In hand', align: 'right', render: r => `<b class="${inHand(r) <= 0 ? 'c-red' : inHand(r) <= threshold() ? 'c-amber' : ''}">${fmt(inHand(r))}</b>` },
  value:  { label: 'Value', align: 'right', render: r => money(lineValue(r)) }
};

/** Revenue contribution per model, used by both the analytics page and the
 *  analytics drill so the two can never disagree. */
function topSellingItems(limit = 12) {
  const byItem = {};
  DB.get('sales').forEach(s => (s.items || []).forEach(i => {
    const k = i.sku;
    byItem[k] = byItem[k] || { id: k, sku: k, units: 0, value: 0, profit: 0 };
    byItem[k].units += num(i.qty);
    byItem[k].value += num(i.qty) * num(i.price);
    byItem[k].profit += num(i.qty) * (num(i.price) - num(i.cost));
  }));
  return Object.values(byItem).sort((a, b) => b.value - a.value).slice(0, limit);
}

/* The openers. A drill row click should land on the real record, not just a
 * list, so each page names the drawer that opens it. A page with no drawer
 * simply has no opener and its rows are not clickable — better than opening
 * the wrong thing. */
const DOPENER = {
  inventory: (id) => openItemDrawer(null, id),
  purchases: (id) => openPODrawer(id),
  sales:     (id) => openSaleDrawer(id),
  repairs:   (id) => openRepairDrawer(id),
  customers: (id) => openCustomerLedger(id),
  suppliers: (id) => openSupplierLedger(id),
  employees: (id) => openEmployeeDrawer(id)
};

/** Register the default drill for a page: its own records. */
function drillPage(key, spec) {
  const opener = spec.openRow !== undefined ? spec.openRow : (DOPENER[key] || null);
  Drill.register(key, Object.assign({
    title: `${PAGE_META[key] ? PAGE_META[key][0] : key} — all records`,
    sub: 'Every record in this module',
    unit: 'record',
    go: { page: key, label: `Open ${PAGE_META[key] ? PAGE_META[key][0].toLowerCase() : key}` },
    openRow: opener
  }, spec));
}

/* ------------------------------------------------------------ Page drills */
function registerPageDrills() {
  const invCols = [
    DC.item, DC.brand, DC.house,
    { label: 'In hand', align: 'right', render: r => `<b>${fmt(inHand(r))}</b>` },
    { label: 'Level', render: r => healthBadge(r) },
    DC.value
  ];
  drillPage('inventory', {
    title: 'Stock lines', sub: 'Facility × colour × category',
    columns: invCols,
    rows: () => DB.get('inventory').slice().sort((a, b) => inHand(a) - inHand(b)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').length)} lines</b></td><td class="right"><b>${fmt(totalUnits())}</b></td><td></td><td class="right"><b>${money(inventoryValue())}</b></td>`
  });
  Drill.register('inventory:lines', Drill.specs.inventory);

  drillPage('movements', {
    title: 'Stock movements', sub: 'The full ledger',
    columns: [
      { label: 'Reference', render: r => `<b class="mono">${esc(r.trxRef)}</b>` },
      { label: 'Type', render: r => `<span class="badge ${r.type === 'IN' ? 'green' : ['OUT', 'SALE'].includes(r.type) ? 'red' : 'blue'}">${esc(r.type)}</span>` },
      DC.item, DC.house, DC.qty, DC.date
    ],
    rows: () => DB.get('movements'),
    unit: 'entry',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('movements').length)} entries</b></td><td class="right"><b>${fmt(sum(DB.get('movements'), m => num(m.qty)))}</b></td><td></td>`
  });

  drillPage('transfers', {
    title: 'Warehouse transfers', sub: 'Every movement request',
    columns: [
      { label: 'Reference', render: r => `<b class="mono">${esc(r.transferRef)}</b>` },
      { label: 'From → To', render: r => `<span class="fs-12">${esc(r.fromLocation)} → <b>${esc(r.toLocation)}</b></span>` },
      { label: 'Units', align: 'right', render: r => `<b>${fmt(r.totalUnits)}</b>` },
      DC.status, DC.date
    ],
    rows: () => DB.get('transfers'),
    unit: 'transfer',
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('transfers').length)} transfers</b></td><td class="right"><b>${fmt(sum(DB.get('transfers'), t => num(t.totalUnits)))}</b></td><td></td><td></td>`
  });

  drillPage('purchases', {
    title: 'Purchase orders', sub: 'Supplier procurement',
    columns: [
      { label: 'PO', render: r => `<b class="mono">${esc(r.poNumber)}</b>` },
      { label: 'Supplier', render: r => `<b>${esc(r.supplier)}</b>` },
      { label: 'Item', render: r => `<span>${esc(r.item || '—')}</span><span class="row-sub">${esc(r.type || '')}</span>` },
      { label: 'Qty', align: 'right', render: r => `${fmt(r.qty)}<span class="row-sub">${fmt(r.receivedQty || 0)} in</span>` },
      { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      DC.status
    ],
    rows: () => DB.get('purchases'),
    unit: 'order',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('purchases').length)} orders</b></td><td class="right"><b>${money(sum(DB.get('purchases'), p => num(p.total)))}</b></td><td></td>`
  });

  drillPage('sales', {
    title: 'Sales orders', sub: 'Every order placed',
    columns: [
      { label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customerName)}</b>` },
      { label: 'Items', sortable: false, render: r => `<span class="fs-12">${esc((r.items || []).map(i => `${i.sku} ×${i.qty}`).join(', ') || '—')}</span>` },
      { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      DC.status, DC.date
    ],
    rows: () => DB.get('sales'),
    unit: 'order',
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('sales').length)} orders</b></td><td class="right"><b>${money(sum(DB.get('sales'), s => num(s.total)))}</b></td><td></td><td></td>`
  });

  drillPage('pos', {
    title: 'Sellable stock', sub: 'Everything the counter can ring up',
    columns: [
      DC.item, DC.brand, DC.house,
      { label: 'Sellable', align: 'right', render: r => `<b>${fmt(inHand(r))}</b>` },
      { label: 'Price', align: 'right', render: r => money(r.unitPrice) }
    ],
    rows: () => DB.get('inventory').filter(l => l.type !== 'Repair' && inHand(l) > 0),
    unit: 'line',
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => l.type !== 'Repair' && inHand(l) > 0).length)} lines</b></td><td class="right"><b>${fmt(sum(DB.get('inventory').filter(l => l.type !== 'Repair' && inHand(l) > 0), inHand))}</b></td><td></td>`
  });

  drillPage('dispatch', {
    title: 'Dispatch consignments', sub: 'Outbound logistics',
    columns: [
      { label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customer)}</b>` },
      { label: 'Courier', render: r => `<span>${esc(r.courier)}</span>${r.tracking ? `<span class="row-sub mono">${esc(r.tracking)}</span>` : ''}` },
      { label: 'Charge', align: 'right', render: r => money(r.cost) },
      DC.status, DC.date
    ],
    rows: () => DB.get('dispatches'),
    unit: 'consignment',
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('dispatches').length)} consignments</b></td><td class="right"><b>${money(sum(DB.get('dispatches'), d => num(d.cost)))}</b></td><td></td><td></td>`
  });

  drillPage('repairs', {
    title: 'Repair tickets', sub: 'BadBin intake through GoodBin recovery',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'IMEI', render: r => `<span class="mono fs-12">${esc(r.imei || '—')}</span>` },
      { label: 'Model', render: r => `<b>${esc(r.model || '—')}</b>` },
      { label: 'Defect', render: r => `<span class="badge red">${esc(r.defectType || '—')}</span>` },
      { label: 'Technician', render: r => `<span class="fs-12">${esc(r.technician || '—')}</span>` },
      DC.status
    ],
    rows: () => DB.get('repairs'),
    unit: 'ticket',
    foot:  () => `<td colspan="5"><b>${fmt(DB.get('repairs').length)} tickets</b></td><td></td>`
  });

  drillPage('customers', {
    title: 'Customers', sub: 'Retail, trade and corporate accounts',
    columns: [
      { label: 'Customer', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.phone || '')}</span></span></div>` },
      { label: 'City', render: r => esc(r.city || '—') },
      { label: 'Balance', align: 'right', render: r => `<b class="${num(r.balance) > 0 ? 'c-red' : ''}">${money(r.balance)}</b>` },
      { label: 'Lifetime', align: 'right', sortVal: r => sum(DB.get('sales').filter(s => s.customerId === r.id), s => num(s.total)), render: r => money(sum(DB.get('sales').filter(s => s.customerId === r.id), s => num(s.total))) },
      DC.status
    ],
    rows: () => DB.get('customers'),
    unit: 'customer',
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('customers').length)} customers</b></td><td class="right"><b>${money(sum(DB.get('customers'), c => num(c.balance)))}</b></td><td></td><td></td>`
  });

  drillPage('suppliers', {
    title: 'Suppliers', sub: 'Distributors and manufacturers',
    columns: [
      { label: 'Supplier', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.city || '')}</span></span></div>` },
      { label: 'Terms', render: r => `<span class="badge blue">${esc(r.paymentTerms || '—')}</span>` },
      { label: 'Payable', align: 'right', render: r => `<b class="${num(r.balance) > 0 ? 'c-amber' : ''}">${money(r.balance)}</b>` },
      DC.status
    ],
    rows: () => DB.get('suppliers'),
    unit: 'supplier',
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('suppliers').length)} suppliers</b></td><td class="right"><b>${money(sum(DB.get('suppliers'), s => num(s.balance)))}</b></td><td></td>`
  });

  drillPage('invoices', {
    title: 'Invoices', sub: 'Receivables and payables',
    columns: [
      { label: 'Invoice', render: r => `<b class="mono">${esc(r.invoiceNo)}</b>` },
      { label: 'Type', render: r => `<span class="badge ${r.type === 'Sale' ? 'green' : r.type === 'Purchase' ? 'amber' : 'blue'}">${esc(r.type)}</span>` },
      { label: 'Party', render: r => `<b>${esc(r.partyName)}</b>` },
      { label: 'Amount', align: 'right', render: r => `<b>${money(r.amount)}</b>` },
      { label: 'Due', align: 'right', render: r => money(num(r.amount) - num(r.paid)) },
      DC.status
    ],
    rows: () => DB.get('invoices'),
    unit: 'invoice',
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('invoices').length)} invoices</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.amount) - num(i.paid)))}</b></td><td></td>`
  });

  drillPage('employees', {
    title: 'Employees', sub: 'Staff directory',
    columns: [
      { label: 'Employee', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b><span class="row-sub mono">${esc(r.code || '')}</span></span></div>` },
      { label: 'Department', render: r => `<span class="badge blue">${esc(r.department || '—')}</span>` },
      { label: 'Designation', render: r => esc(r.role || '—') },
      { label: 'Facility', render: r => esc(r.location || '—') },
      { label: 'Salary', align: 'right', render: r => money(r.salary) },
      DC.status
    ],
    rows: () => DB.get('employees'),
    unit: 'employee',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('employees').length)} staff</b></td><td class="right"><b>${money(sum(DB.get('employees'), e => num(e.salary)))}</b></td><td></td>`
  });

  drillPage('payroll', {
    title: 'Payslips', sub: 'Monthly salary statements',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName)}</b>` },
      { label: 'Month', render: r => `<b>${esc(monthLabel(r.month))}</b>` },
      { label: 'Base', align: 'right', render: r => money(r.baseSalary) },
      { label: 'Overtime', align: 'right', render: r => num(r.overtimeHours) ? money(num(r.overtimeHours) * num(r.overtimeRate)) : '—' },
      { label: 'Deductions', align: 'right', render: r => num(r.deductions) ? `<span class="c-red">−${money(r.deductions)}</span>` : '—' },
      { label: 'Net', align: 'right', render: r => `<b>${money(r.netSalary)}</b>` },
      DC.status
    ],
    rows: () => DB.get('payroll'),
    unit: 'payslip',
    foot:  () => `<td colspan="5"><b>${fmt(DB.get('payroll').length)} payslips</b></td><td class="right"><b>${money(sum(DB.get('payroll'), p => num(p.netSalary)))}</b></td><td></td>`
  });

  drillPage('leave', {
    title: 'Leave requests', sub: 'Submitted and decided',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName)}</b>` },
      { label: 'Type', render: r => `<span class="badge blue">${esc(r.type)}</span>` },
      { label: 'From', align: 'center', render: r => esc(fmtDate(r.startDate)) },
      { label: 'To', align: 'center', render: r => esc(fmtDate(r.endDate)) },
      { label: 'Days', align: 'right', render: r => `<b>${fmt(r.days)}</b>` },
      DC.status
    ],
    rows: () => DB.get('leaves'),
    unit: 'request',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('leaves').length)} requests</b></td><td class="right"><b>${fmt(sum(DB.get('leaves'), l => num(l.days)))}</b></td><td></td>`
  });

  drillPage('attendance', {
    title: 'Attendance register', sub: 'Every punch captured',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Device', render: r => `<span class="badge grey">${esc(r.deviceId || 'Manual')}</span>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      { label: 'In', align: 'center', render: r => `<b>${esc(fmtTime(r.checkTime))}</b>` },
      DC.status
    ],
    rows: () => DB.get('attendance'),
    unit: 'punch',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('attendance').length)} punches</b></td><td></td>`
  });

  drillPage('finance', {
    title: 'Ledger', sub: 'Every financial document',
    columns: [
      { label: 'Invoice', render: r => `<b class="mono">${esc(r.invoiceNo)}</b>` },
      { label: 'Type', render: r => `<span class="badge ${r.type === 'Sale' ? 'green' : r.type === 'Purchase' ? 'amber' : 'blue'}">${esc(r.type)}</span>` },
      { label: 'Party', render: r => `<b>${esc(r.partyName)}</b>` },
      { label: 'Amount', align: 'right', render: r => `<b>${money(r.amount)}</b>` },
      { label: 'Settled', align: 'right', render: r => money(r.paid) },
      DC.status
    ],
    rows: () => DB.get('invoices'),
    unit: 'entry',
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('invoices').length)} entries</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.paid)))}</b></td><td></td>`
  });

  drillPage('analytics', {
    title: 'Revenue contribution', sub: 'Ranked by sales value',
    openRow: null,
    columns: [
      { label: 'Model', render: r => `<b>${esc(r.sku)}</b>` },
      { label: 'Units sold', align: 'right', render: r => `<b>${fmt(r.units)}</b>` },
      { label: 'Revenue', align: 'right', render: r => `<b>${money(r.value)}</b>` },
      { label: 'Profit', align: 'right', render: r => `<b class="${r.profit >= 0 ? 'c-green' : 'c-red'}">${money(r.profit)}</b>` }
    ],
    rows: () => topSellingItems(40),
    unit: 'model',
    guard: () => topSellingItems(40).length > 0,
    emptyMessage: 'No sales recorded yet — revenue contribution appears once orders exist',
    foot:  () => `<td><b>${fmt(topSellingItems(40).length)} models</b></td><td class="right"><b>${fmt(sum(topSellingItems(40), r => r.units))}</b></td><td class="right"><b>${money(sum(topSellingItems(40), r => r.value))}</b></td><td class="right"><b>${money(sum(topSellingItems(40), r => r.profit))}</b></td>`
  });

  drillPage('reports', {
    title: 'Stock valuation', sub: 'Held units valued at landed cost',
    columns: [
      DC.item, DC.brand, DC.house,
      { label: 'Units', align: 'right', render: r => `<b>${fmt(r.units)}</b>` },
      { label: 'At cost', align: 'right', render: r => money(r.cost) },
      { label: 'At retail', align: 'right', render: r => money(r.retail) }
    ],
    rows: () => {
      const inv = DB.get('inventory');
      return DB.get('locations').map(l => {
        const lines = inv.filter(x => x.house === l.name);
        return {
          h: l.name,
          units: sum(lines, inHand),
          cost: sum(lines, lineValue),
          retail: sum(lines, x => inHand(x) * num(x.unitPrice))
        };
      }).filter(r => r.units !== 0);
    },
    unit: 'facility',
    go: { page: 'reports', label: 'Open reports' },
    foot:  () => `<td colspan="3"><b>${fmt(totalUnits())} units</b></td><td></td><td class="right"><b>${money(inventoryValue())}</b></td><td class="right"><b>${money(sum(DB.get('inventory'), l => inHand(l) * num(l.unitPrice)))}</b></td>`
  });

  drillPage('audit', {
    title: 'Audit log', sub: 'Every recorded action',
    columns: [
      { label: 'When', render: r => `<span class="fs-12">${esc(fmtDateTime(r.timestamp))}</span>` },
      { label: 'User', render: r => `<b>${esc(r.user)}</b>` },
      { label: 'Action', render: r => `<span class="badge ${/DELETE|WIPE/i.test(r.action) ? 'red' : /CREATE|LOGIN/i.test(r.action) ? 'green' : 'blue'}">${esc(r.action)}</span>` },
      { label: 'Module', render: r => esc(r.module || '—') },
      { label: 'Reference', render: r => `<span class="mono fs-12">${esc(r.recordId || '—')}</span>` }
    ],
    rows: () => DB.get('audit'),
    unit: 'entry',
    foot:  () => `<td colspan="5"><b>${fmt(DB.get('audit').length)} entries</b></td>`
  });

  drillPage('settings', {
    title: 'Facilities', sub: 'Warehouses, counters and service points',
    columns: [
      { label: 'Facility', render: r => `<b>${esc(r.name)}</b>` },
      { label: 'Type', render: r => `<span class="badge blue">${esc(r.type || '—')}</span>` },
      { label: 'City', render: r => esc(r.city || '—') },
      { label: 'Active', align: 'center', render: r => r.active === false ? '<span class="badge grey">Inactive</span>' : '<span class="badge green">Active</span>' }
    ],
    rows: () => DB.get('locations'),
    unit: 'facility',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('locations').length)} facilities</b></td>`
  });

  drillPage('admin', {
    title: 'User accounts', sub: 'Who can sign in',
    columns: [
      { label: 'User', render: r => `<div class="row gap-6">${avatarNode(r.name, 26)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.email)}</span></span></div>` },
      { label: 'Role', render: r => `<span class="badge ${r.role === 'Super Admin' || r.role === 'Admin' ? 'amber' : 'blue'}">${esc(r.role)}</span>` },
      { label: 'Facility', render: r => esc(r.location || '—') },
      DC.status
    ],
    rows: () => DB.get('users'),
    unit: 'account',
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('users').length)} accounts</b></td>`
  });
}

/* -------------------------------------------------------- Bespoke drills */
/**
 * The cards whose number is a filtered subset. Each one names exactly the
 * predicate its stat card used, so the two can never disagree silently.
 */
function registerMetricDrills() {
  /* No `const t = threshold()` here. These specs are built once, during boot,
   * and opened much later; caching the reorder point in a closure would pin
   * every "at or below reorder point" drill to the value the setting had when
   * the app loaded, so a user who raises the threshold would keep seeing the
   * old set. threshold() is cheap, so it is read at the moment of use. */

  /* ---- Dashboard ---- */
  Drill.register('dash:units', {
    title: 'Every stock line', unit: 'line',
    sub: 'Sorted by available units', go: { page: 'inventory', label: 'Open inventory' },
    columns: [DC.item, DC.brand, DC.house,
      { label: 'In hand', align: 'right', render: r => `<b>${fmt(inHand(r))}</b>` },
      { label: 'Level', render: r => healthBadge(r) }],
    rows: () => DB.get('inventory').filter(l => inHand(l) !== 0).sort((a, b) => inHand(b) - inHand(a)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => inHand(l) !== 0).length)} lines with stock</b></td><td class="right"><b>${fmt(totalUnits())}</b></td><td></td>`
  });

  Drill.register('dash:attention', {
    title: 'Lines needing a decision', unit: 'line',
    sub: 'Out of stock, or at or below the reorder point', go: { page: 'inventory', label: 'Open inventory' },
    emptyText: 'Every line is above its reorder point.',
    columns: [DC.item, DC.brand, DC.house,
      { label: 'In hand', align: 'right', render: r => `<b class="${inHand(r) <= 0 ? 'c-red' : 'c-amber'}">${fmt(inHand(r))}</b>` },
      { label: 'Reorder at', align: 'right', render: r => fmt(num(r.reorderPoint) || threshold()) },
      { label: 'Level', render: r => healthBadge(r) },
      { label: 'Value', align: 'right', render: r => money(lineValue(r)) }],
    rows: () => DB.get('inventory').filter(l => inHand(l) <= threshold()).sort((a, b) => inHand(a) - inHand(b)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => inHand(l) <= threshold()).length)} lines</b></td><td></td><td></td><td></td><td class="right"><b>${money(sum(DB.get('inventory').filter(l => inHand(l) <= threshold()), lineValue))}</b></td>`
  });

  Drill.register('dash:revenue', {
    title: 'Sales this month', unit: 'order',
    sub: monthLabel(monthKey(new Date())), go: { page: 'sales', label: 'Open sales' },
    columns: [
      { label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customerName)}</b>` },
      { label: 'Items', render: r => `<span class="fs-12">${esc((r.items || []).map(i => `${i.sku} ×${i.qty}`).join(', ') || '—')}</span>` },
      { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      { label: 'Margin', align: 'right', render: r => {
        const c = sum(r.items || [], i => num(i.cost) * num(i.qty));
        return `<b class="${num(r.total) - c >= 0 ? 'c-green' : 'c-red'}">${money(num(r.total) - c)}</b>`;
      } },
      DC.status],
    rows: () => DB.get('sales').filter(x => monthKey(x.date) === monthKey(new Date())),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('sales').filter(x => monthKey(x.date) === monthKey(new Date())).length)} orders</b></td><td class="right"><b>${money(sum(DB.get('sales').filter(x => monthKey(x.date) === monthKey(new Date())), s => num(s.total)))}</b></td><td></td><td></td>`
  });

  Drill.register('dash:repairs', {
    title: 'Open repair tickets', unit: 'ticket',
    sub: 'In the service lab now', go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'The service lab is clear.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => `<b>${esc(r.model || '—')}</b><span class="row-sub mono">${esc(r.imei || '')}</span>` },
      { label: 'Defect', render: r => `<span class="badge red">${esc(r.defectType || '—')}</span>` },
      { label: 'Technician', render: r => esc(r.technician || 'Unassigned') },
      { label: 'Promised', align: 'center', render: r => {
        const late = r.promisedDate && r.promisedDate < todayISO();
        return `<span class="badge ${late ? 'red' : 'grey'}">${esc(fmtDate(r.promisedDate))}</span>`;
      } },
      DC.status],
    rows: () => DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status)),
    foot:  () => `<td colspan="5"><b>${fmt(DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status)).length)} open</b></td><td></td>`
  });

  Drill.register('dash:transfers', {
    title: 'Transfers in flight', unit: 'transfer',
    sub: 'Not yet complete', go: { page: 'transfers', label: 'Open transfers' },
    emptyText: 'No transfers are in flight.',
    columns: [
      { label: 'Reference', render: r => `<b class="mono">${esc(r.transferRef)}</b>` },
      { label: 'From → To', render: r => `<span class="fs-12">${esc(r.fromLocation)} → <b>${esc(r.toLocation)}</b></span>` },
      { label: 'Units', align: 'right', render: r => `<b>${fmt(r.totalUnits)}</b>` },
      { label: 'Carrier', render: r => esc(r.carrier || '—') },
      DC.status],
    rows: () => DB.get('transfers').filter(t => !['Complete', 'Cancelled'].includes(t.status)),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('transfers').filter(t => !['Complete', 'Cancelled'].includes(t.status)).length)} in flight</b></td><td class="right"><b>${fmt(sum(DB.get('transfers').filter(t => !['Complete', 'Cancelled'].includes(t.status)), t => num(t.totalUnits)))}</b></td><td></td><td></td>`
  });

  /* ---- Inventory ---- */
  const stockCols = () => [DC.item, DC.brand, DC.house];

  Drill.register('inv:out', {
    title: 'Out of stock lines', unit: 'line', sub: 'Nothing available to sell',
    go: { page: 'inventory', label: 'Open inventory' },
    emptyText: 'Every line has stock on hand.',
    columns: stockCols().concat([
      { label: 'In hand', align: 'right', render: r => `<b class="c-red">${fmt(inHand(r))}</b>` },
      { label: 'Reorder at', align: 'right', render: r => fmt(num(r.reorderPoint) || threshold()) },
      { label: 'Last cost', align: 'right', render: r => money(r.unitCost) }]),
    rows: () => DB.get('inventory').filter(l => inHand(l) <= 0).sort((a, b) => num(a.unitCost) - num(b.unitCost)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => inHand(l) <= 0).length)} lines</b></td><td></td><td></td><td class="right"><b>${money(sum(DB.get('inventory').filter(l => inHand(l) <= 0), l => num(l.unitCost) * Math.max(0, threshold())))}</b> to restock</td>`
  });

  Drill.register('inv:negative', {
    title: 'Negative stock', unit: 'line', sub: 'More was issued than ever received',
    go: { page: 'inventory', label: 'Open inventory' },
    emptyText: 'The ledger balances — no line is negative.',
    columns: stockCols().concat([
      { label: 'In hand', align: 'right', render: r => `<b class="c-red">${fmt(inHand(r))}</b>` },
      { label: 'Issued out', align: 'right', render: r => fmt(r.outQty) },
      { label: 'Received in', align: 'right', render: r => fmt(r.inQty) },
      { label: 'Value', align: 'right', render: r => money(lineValue(r)) }]),
    rows: () => DB.get('inventory').filter(l => inHand(l) < 0).sort((a, b) => inHand(a) - inHand(b)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => inHand(l) < 0).length)} lines</b></td><td></td><td></td><td></td><td class="right"><b>${money(sum(DB.get('inventory').filter(l => inHand(l) < 0), lineValue))}</b></td>`
  });

  Drill.register('inv:attention', {
    title: 'Lines at or below reorder point', unit: 'line',
    sub:  () => `Reorder point ${threshold()} units`, go: { page: 'inventory', label: 'Open inventory' },
    emptyText: 'Nothing is below its reorder point.',
    columns: [DC.item, DC.brand, DC.house,
      { label: 'In hand', align: 'right', render: r => `<b class="${inHand(r) <= 0 ? 'c-red' : 'c-amber'}">${fmt(inHand(r))}</b>` },
      { label: 'Reorder at', align: 'right', render: r => fmt(num(r.reorderPoint) || threshold()) },
      { label: 'Level', render: r => healthBadge(r) }],
    rows: () => DB.get('inventory').filter(l => inHand(l) <= threshold()).sort((a, b) => inHand(a) - inHand(b)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').filter(l => inHand(l) <= threshold()).length)} lines</b></td><td></td><td></td><td></td>`
  });
  Drill.register('inv:units', {
    title: 'All stock lines', unit: 'line',
    columns: [DC.item, DC.brand, DC.house, { label: 'In hand', align: 'right', render: r => `<b>${fmt(inHand(r))}</b>` }, DC.value],
    rows: () => DB.get('inventory'),
    go: { page: 'inventory', label: 'Open inventory' },
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('inventory').length)} lines</b></td><td class="right"><b>${fmt(totalUnits())}</b></td><td class="right"><b>${money(inventoryValue())}</b></td>`
  });
  Drill.register('inv:value', Drill.specs['inv:units']);
  Drill.register('inv:catalogue', {
    title: 'Catalogue', unit: 'line', sub: 'Every model AMAYA Industries carries',
    go: { page: 'inventory', label: 'Open inventory' },
    /* Explicit, because the inference would get it wrong. These rows are
     * catalogue *items*, not stock lines, so the inventory opener — which is
     * written as openItemDrawer(null, lineId) — would look up a line by an item
     * id, find nothing, and dereference a null line. The first argument is the
     * item, which is what these rows actually are. */
    openRow: id => openItemDrawer(id),
    columns: [
      { label: 'Model', render: r => `<b>${esc(r.model)}</b><span class="row-sub">${esc(r.config || '')}</span>` },
      { label: 'Brand', render: r => esc(r.brand || '—') },
      { label: 'Category', render: r => typeBadge(r.type) },
      { label: 'Cost', align: 'right', render: r => money(r.cost) },
      { label: 'Price', align: 'right', render: r => money(r.price) },
      { label: 'Warranty', align: 'center', render: r => r.warrantyMonths ? `<span class="badge grey">${r.warrantyMonths} mo</span>` : '—' }],
    rows: () => DB.get('items'),
    foot:  () => `<td colspan="5"><b>${fmt(DB.get('items').length)} catalogue lines</b></td><td></td>`
  });

  /* ---- Sales / dispatch ---- */
  Drill.register('sale:outstanding', {
    title: 'Unpaid orders', unit: 'order', go: { page: 'sales', label: 'Open sales' },
    sub: 'Not yet marked paid',
    columns: [
      { label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customerName)}</b><span class="row-sub">${esc(r.customerPhone || '')}</span>` },
      { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      { label: 'Payment', render: r => `<span class="badge ${r.paymentMethod === 'Cash' ? 'green' : 'blue'}">${esc(r.paymentMethod)}</span>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      DC.status],
    rows: () => DB.get('sales').filter(s => s.status !== 'Paid' && s.status !== 'Cancelled'),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('sales').filter(s => s.status !== 'Paid' && s.status !== 'Cancelled').length)} orders</b></td><td class="right"><b>${money(sum(DB.get('sales').filter(s => s.status !== 'Paid' && s.status !== 'Cancelled'), s => num(s.total)))}</b></td><td></td><td></td><td></td>`
  });
  Drill.register('sale:thisMonth', Drill.specs['dash:revenue']);

  Drill.register('dsp:open', {
    title: 'Open consignments', unit: 'consignment', go: { page: 'dispatch', label: 'Open dispatch' },
    sub: 'Not yet delivered or handed over',
    columns: [
      { label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customer)}</b>` },
      { label: 'Courier', render: r => esc(r.courier) },
      { label: 'Tracking', render: r => `<span class="mono fs-12">${esc(r.tracking || '—')}</span>` },
      { label: 'Charge', align: 'right', render: r => money(r.cost) },
      DC.status],
    rows: () => DB.get('dispatches').filter(d => !['Delivered', 'Handed Over', 'Cancelled', 'Returned'].includes(d.status)),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('dispatches').filter(d => !['Delivered', 'Handed Over', 'Cancelled', 'Returned'].includes(d.status)).length)} open</b></td><td class="right"><b>${money(sum(DB.get('dispatches').filter(d => !['Delivered', 'Handed Over', 'Cancelled', 'Returned'].includes(d.status)), d => num(d.cost)))}</b></td><td></td>`
  });

  /* ---- Repairs ---- */
  Drill.register('rep:overdue', {
    title: 'Overdue repair jobs', unit: 'ticket', sub: 'Past the promised date',
    go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'No job is past its promised date.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => `<b>${esc(r.model || '—')}</b>` },
      { label: 'Customer', render: r => esc(r.customerName || '—') },
      { label: 'Promised', align: 'center', render: r => `<span class="badge red">${esc(fmtDate(r.promisedDate))}</span>` },
      { label: 'Days late', align: 'right', render: r => `<b class="c-red">${fmt(Math.max(0, daysBetween(r.promisedDate, todayISO())))}</b>` },
      DC.status],
    rows: () => DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status) && r.promisedDate && r.promisedDate < todayISO()),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status) && r.promisedDate && r.promisedDate < todayISO()).length)} overdue</b></td><td></td><td></td>`
  });

  /* ---- Invoices / finance ---- */
  const openInv = () => DB.get('invoices').filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
  const invCols = (extra) => ([
    { label: 'Invoice', render: r => `<b class="mono">${esc(r.invoiceNo)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
    { label: 'Type', render: r => `<span class="badge ${r.type === 'Sale' ? 'green' : r.type === 'Purchase' ? 'amber' : 'blue'}">${esc(r.type)}</span>` },
    { label: 'Party', render: r => `<b>${esc(r.partyName)}</b>` },
    { label: 'Amount', align: 'right', render: r => `<b>${money(r.amount)}</b>` },
    { label: 'Outstanding', align: 'right', render: r => `<b class="c-red">${money(num(r.amount) - num(r.paid))}</b>` },
    { label: 'Due', align: 'center', render: r => `<span class="badge ${r.status === 'Overdue' ? 'red' : 'grey'}">${esc(fmtDate(r.dueDate))}</span>` }
  ].concat(extra || []));

  Drill.register('inv:receivable', {
    title: 'Receivables', unit: 'invoice', sub: 'Money owed to AMAYA Industries',
    go: { page: 'invoices', label: 'Open invoices' },
    emptyText: 'Nothing is outstanding.',
    columns: invCols([DC.status]),
    rows: () => openInv().filter(i => i.type !== 'Purchase'),
    foot:  () => `<td colspan="3"><b>${fmt(openInv().filter(i => i.type !== 'Purchase').length)} invoices</b></td><td class="right"><b>${money(sum(openInv().filter(i => i.type !== 'Purchase'), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(openInv().filter(i => i.type !== 'Purchase'), i => num(i.amount) - num(i.paid)))}</b></td><td></td><td></td>`
  });
  Drill.register('inv:payable', {
    title: 'Payables', unit: 'invoice', sub: 'Money AMAYA Industries owes',
    go: { page: 'invoices', label: 'Open invoices' },
    emptyText: 'Nothing is outstanding.',
    columns: invCols([DC.status]),
    rows: () => openInv().filter(i => i.type === 'Purchase'),
    foot:  () => `<td colspan="3"><b>${fmt(openInv().filter(i => i.type === 'Purchase').length)} invoices</b></td><td class="right"><b>${money(sum(openInv().filter(i => i.type === 'Purchase'), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(openInv().filter(i => i.type === 'Purchase'), i => num(i.amount) - num(i.paid)))}</b></td><td></td><td></td>`
  });
  Drill.register('inv:overdue', {
    title: 'Overdue invoices', unit: 'invoice', sub: 'Past the due date and unpaid',
    go: { page: 'invoices', label: 'Open invoices' },
    emptyText: 'Nothing is overdue. Well chased.',
    columns: invCols([DC.status]),
    rows: () => DB.get('invoices').filter(i => i.status === 'Overdue' || (i.status !== 'Paid' && i.dueDate && i.dueDate < todayISO())),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('invoices').filter(i => i.status === 'Overdue' || (i.status !== 'Paid' && i.dueDate && i.dueDate < todayISO())).length)} overdue</b></td><td class="right"><b>${money(sum(DB.get('invoices').filter(i => i.status === 'Overdue' || (i.status !== 'Paid' && i.dueDate && i.dueDate < todayISO())), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(DB.get('invoices').filter(i => i.status === 'Overdue' || (i.status !== 'Paid' && i.dueDate && i.dueDate < todayISO())), i => num(i.amount) - num(i.paid)))}</b></td><td></td><td></td>`
  });

  /* ---- Attendance / leave ---- */
  Drill.register('att:late', {
    title: 'Late arrivals', unit: 'punch', sub:  () => `After the ${state.db.settings.shiftStart || '09:00'} shift start`,
    go: { page: 'attendance', label: 'Open attendance' },
    emptyText: 'Nobody was late.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      { label: 'In', align: 'center', render: r => `<b class="c-amber">${esc(fmtTime(r.checkTime))}</b>` },
      { label: 'Source', render: r => `<span class="badge grey">${esc(r.deviceId || 'Manual')}</span>` }],
    rows: () => DB.get('attendance').filter(a => a.status === 'Late'),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('attendance').filter(a => a.status === 'Late').length)} late punches</b></td><td></td>`
  });
  Drill.register('att:absent', {
    title: 'Absences', unit: 'punch', go: { page: 'attendance', label: 'Open attendance' },
    emptyText: 'No absences recorded.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      { label: 'Note', render: r => `<span class="fs-12">${esc(r.note || '—')}</span>` }],
    rows: () => DB.get('attendance').filter(a => a.status === 'Absent')
  });
  Drill.register('leave:pending', {
    title: 'Leave awaiting approval', unit: 'request', go: { page: 'leave', label: 'Open leave' },
    emptyText: 'No request is waiting.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName)}</b>` },
      { label: 'Type', render: r => `<span class="badge blue">${esc(r.type)}</span>` },
      { label: 'From', align: 'center', render: r => esc(fmtDate(r.startDate)) },
      { label: 'To', align: 'center', render: r => esc(fmtDate(r.endDate)) },
      { label: 'Days', align: 'right', render: r => `<b>${fmt(r.days)}</b>` }],
    rows: () => DB.get('leaves').filter(l => l.status === 'Pending'),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('leaves').filter(l => l.status === 'Pending').length)} pending</b></td><td class="right"><b>${fmt(sum(DB.get('leaves').filter(l => l.status === 'Pending'), l => num(l.days)))} days</b></td>`
  });

  /* ---- Purchases ---- */
  Drill.register('po:open', {
    title: 'Open purchase orders', unit: 'order', sub: 'Not yet fully received',
    go: { page: 'purchases', label: 'Open purchases' },
    emptyText: 'Nothing is on order.',
    columns: [
      { label: 'PO', render: r => `<b class="mono">${esc(r.poNumber)}</b>` },
      { label: 'Supplier', render: r => `<b>${esc(r.supplier)}</b>` },
      { label: 'Item', render: r => `<span>${esc(r.item || '—')}</span>` },
      { label: 'Qty', align: 'right', render: r => `${fmt(r.qty)}<span class="row-sub">${fmt(r.receivedQty || 0)} in</span>` },
      { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      { label: 'ETA', align: 'center', render: r => {
        const late = r.eta && r.eta < todayISO();
        return `<span class="badge ${late ? 'red' : 'grey'}">${esc(fmtDate(r.eta))}</span>`;
      } },
      DC.status],
    rows: () => DB.get('purchases').filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status)),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('purchases').filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status)).length)} open</b></td><td class="right"><b>${money(sum(DB.get('purchases').filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status)), p => num(p.total)))}</b></td><td></td><td></td>`
  });
  Drill.register('po:late', {
    title: 'Purchase orders past ETA', unit: 'order', go: { page: 'purchases', label: 'Open purchases' },
    emptyText: 'Every delivery is on schedule.',
    columns: [
      { label: 'PO', render: r => `<b class="mono">${esc(r.poNumber)}</b>` },
      { label: 'Supplier', render: r => `<b>${esc(r.supplier)}</b>` },
      { label: 'Item', render: r => `<span>${esc(r.item || '—')}</span>` },
      { label: 'ETA', align: 'center', render: r => `<span class="badge red">${esc(fmtDate(r.eta))}</span>` },
      { label: 'Days late', align: 'right', render: r => `<b class="c-red">${fmt(Math.max(0, daysBetween(r.eta, todayISO())))}</b>` }],
    rows: () => DB.get('purchases').filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status) && p.eta && p.eta < todayISO())
  });

  /* ---- Payroll ---- */
  Drill.register('pay:pending', {
    title: 'Payroll awaiting processing', unit: 'payslip', go: { page: 'payroll', label: 'Open payroll' },
    emptyText: 'Payroll is up to date.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName)}</b>` },
      { label: 'Month', render: r => `<b>${esc(monthLabel(r.month))}</b>` },
      { label: 'Net pay', align: 'right', render: r => `<b>${money(r.netSalary)}</b>` }],
    rows: () => DB.get('payroll').filter(p => p.status === 'Pending'),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('payroll').filter(p => p.status === 'Pending').length)} payslips</b></td><td class="right"><b>${money(sum(DB.get('payroll').filter(p => p.status === 'Pending'), p => num(p.netSalary)))}</b></td>`
  });

  /* ---- Customers / suppliers ---- */
  Drill.register('cust:debtors', {
    title: 'Customers with a balance', unit: 'customer', go: { page: 'customers', label: 'Open customers' },
    emptyText: 'No customer owes anything.',
    columns: [
      { label: 'Customer', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.phone || '')}</span></span></div>` },
      { label: 'Balance', align: 'right', render: r => `<b class="c-red">${money(r.balance)}</b>` },
      { label: 'Credit limit', align: 'right', render: r => money(r.creditLimit) },
      { label: 'Used', align: 'right', render: r => num(r.creditLimit) ? `${Math.round(num(r.balance) / num(r.creditLimit) * 100)}%` : '—' }],
    rows: () => DB.get('customers').filter(c => num(c.balance) > 0),
    foot:  () => `<td><b>${fmt(DB.get('customers').filter(c => num(c.balance) > 0).length)} customers</b></td><td class="right"><b>${money(sum(DB.get('customers').filter(c => num(c.balance) > 0), c => num(c.balance)))}</b></td><td></td><td></td>`
  });
  Drill.register('sup:creditors', {
    title: 'Suppliers to be paid', unit: 'supplier', go: { page: 'suppliers', label: 'Open suppliers' },
    emptyText: 'Nothing is owed to any supplier.',
    columns: [
      { label: 'Supplier', render: r => `<b>${esc(r.name)}</b>` },
      { label: 'Terms', render: r => `<span class="badge blue">${esc(r.paymentTerms || '—')}</span>` },
      { label: 'Payable', align: 'right', render: r => `<b class="c-amber">${money(r.balance)}</b>` }],
    rows: () => DB.get('suppliers').filter(s => num(s.balance) > 0),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('suppliers').filter(s => num(s.balance) > 0).length)} suppliers</b></td><td class="right"><b>${money(sum(DB.get('suppliers').filter(s => num(s.balance) > 0), s => num(s.balance)))}</b></td>`
  });

  /* ---- Repair detail drills (tab-scoped) ---- */
  Drill.register('rep:imei', {
    title: 'IMEI registry', unit: 'device', sub: 'Every serial on record',
    go: { page: 'repairs', label: 'Open IMEI registry' },
    columns: [
      { label: 'IMEI', render: r => `<b class="mono">${esc(r.imei)}</b>` },
      { label: 'Product', render: r => `<b>${esc(r.sku || '—')}</b><span class="row-sub">${esc(r.color || '')}</span>` },
      { label: 'Facility', render: r => esc(r.house || '—') },
      { label: 'State', render: r => statusBadge(r.status) }],
    rows: () => DB.get('imeis'),
    foot:  () => `<td><b>${fmt(DB.get('imeis').length)} serials</b></td><td></td><td></td><td></td>`
  });

  /* ---- Alert-driven drills ----
   * One per dashboard alert that is not already covered above, so every alert
   * row opens the exact records it is counting. */
  Drill.register('trf:pending', {
    title: 'Transfers awaiting approval', unit: 'transfer', sub: 'Not yet authorised',
    go: { page: 'transfers', label: 'Open transfers' },
    emptyText: 'No transfer is waiting on you.',
    columns: [
      { label: 'Reference', render: r => `<b class="mono">${esc(r.transferRef)}</b>` },
      { label: 'From → To', render: r => `<span class="fs-12">${esc(r.fromLocation)} → <b>${esc(r.toLocation)}</b></span>` },
      { label: 'Units', align: 'right', render: r => `<b>${fmt(r.totalUnits)}</b>` },
      { label: 'Requested', align: 'center', render: r => esc(fmtDate(r.date)) },
      DC.status],
    rows: () => DB.get('transfers').filter(t => t.status === 'Pending'),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('transfers').filter(t => t.status === 'Pending').length)} pending</b></td><td class="right"><b>${fmt(sum(DB.get('transfers').filter(t => t.status === 'Pending'), t => num(t.totalUnits)))}</b></td><td></td><td></td>`
  });

  Drill.register('dsp:slow', {
    title: 'Consignments held over 5 days', unit: 'consignment', sub: 'Not delivered or handed over',
    go: { page: 'dispatch', label: 'Open dispatch' },
    emptyText: 'Every consignment is moving on time.',
    columns: [
      { label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customer)}</b>` },
      { label: 'Courier', render: r => esc(r.courier) },
      { label: 'Days held', align: 'right', render: r => `<b class="c-amber">${fmt(Math.max(0, daysBetween(r.date, todayISO())))}</b>` },
      DC.status],
    rows: () => DB.get('dispatches').filter(d => !['Delivered', 'Handed Over', 'Cancelled'].includes(d.status) && daysBetween(d.date, todayISO()) > 5)
  });

  Drill.register('rep:parts', {
    title: 'Repairs awaiting parts', unit: 'ticket', sub: 'Blocked on component supply',
    go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'Nothing is waiting on a part.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => `<b>${esc(r.model || '—')}</b>` },
      { label: 'Defect', render: r => `<span class="badge purple">${esc(r.defectType || '—')}</span>` },
      { label: 'Technician', render: r => esc(r.technician || 'Unassigned') },
      { label: 'Waiting', align: 'right', render: r => `<b>${fmt(Math.max(0, daysBetween(r.statusDate || r.intakeDate, todayISO())))} d</b>` },
      DC.status],
    rows: () => DB.get('repairs').filter(r => r.status === 'Awaiting Part')
  });

  Drill.register('rep:stale', {
    title: 'Repairs open over 7 days', unit: 'ticket', sub: 'Service-level risk',
    go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'Every job is inside its service window.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => `<b>${esc(r.model || '—')}</b>` },
      { label: 'Technician', render: r => esc(r.technician || 'Unassigned') },
      { label: 'Age', align: 'right', render: r => `<b class="c-red">${fmt(Math.max(0, daysBetween(r.intakeDate, todayISO())))} d</b>` },
      DC.status],
    rows: () => DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status) && daysBetween(r.intakeDate, todayISO()) > 7)
  });

  Drill.register('rep:dupImei', {
    title: 'Duplicate IMEI records', unit: 'serial', sub: 'The same identifier appears more than once',
    emptyText: 'Every serial is unique.',
    columns: [
      { label: 'IMEI', render: r => `<b class="mono c-red">${esc(r.imei)}</b>` },
      { label: 'Where', render: r => `<span class="fs-12">${esc(r.where || '—')}</span>` },
      { label: 'Product', render: r => esc(r.sku || '—') },
      { label: 'Seen', align: 'right', render: r => `<b class="c-red">${fmt(r.times)}</b>` }],
    rows: () => duplicateImeiRows()
  });

  Drill.register('sale:duplicates', {
    title: 'Duplicate order numbers', unit: 'order', sub: 'Reference collision',
    emptyText: 'Every order reference is unique.',
    columns: [
      { label: 'Order', render: r => `<b class="mono c-red">${esc(r.ref)}</b>` },
      { label: 'Customers', render: r => `<span class="fs-12">${esc(r.names)}</span>` },
      { label: 'Seen', align: 'right', render: r => `<b class="c-red">${fmt(r.times)}</b>` }],
    rows: () => duplicateOrderRows()
  });

  /* ---- Trade-in desk ---- */
  const upgCols = [
    { label: 'Ref', render: r => `<b class="mono">${esc(r.ref)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
    { label: 'Customer', render: r => `<b>${esc(r.customerName || 'Walk-in')}</b><span class="row-sub">${esc(r.customerPhone || '')}</span>` },
    { label: 'Incoming', render: r => `<span>${esc(r.oldModel || '—')}</span><span class="row-sub">${esc(r.condition || '')}</span>` },
    { label: 'Outgoing', render: r => `<span>${esc(r.newModel || '—')}</span>` },
    { label: 'Credit', align: 'right', render: r => `<b class="c-purple">${money(r.credit)}</b>` },
    { label: 'Payable', align: 'right', render: r => `<b>${money(r.payable)}</b>` },
    { label: 'Margin', align: 'right', render: r => `<b class="${num(r.margin) >= 0 ? 'c-green' : 'c-red'}">${money(r.margin)}</b>` },
    { label: 'Stage', render: r => statusBadge(r.status) }
  ];
  drillPage('upgrades', {
    title: 'Trade-ins', sub: 'Every device exchange', openRow: id => openUpgradeDrawer(id),
    columns: upgCols, rows: () => DB.get('upgrades'), unit: 'trade-in',
    go: { page: 'upgrades', label: 'Open trade-in desk' }
  });
  Drill.register('upgrades:open', {
    title: 'Open trade-ins', unit: 'trade-in', sub: 'Started but not yet closed',
    go: { page: 'upgrades', label: 'Open trade-in desk' },
    emptyText: 'No trade-in is open.',
    openRow: id => openUpgradeDrawer(id),
    columns: upgCols,
    rows: () => DB.get('upgrades').filter(u => OPEN_TRADE_STAGES.includes(u.status))
  });
  Drill.register('upgrades:awaiting', {
    title: 'Trade-ins awaiting receipt', unit: 'trade-in', sub: 'New device issued, old one not in yet',
    go: { page: 'upgrades', label: 'Open trade-in desk' },
    emptyText: 'Every issued device has been taken back.',
    openRow: id => openUpgradeDrawer(id),
    columns: upgCols.concat([
      { label: 'Issued', align: 'center', render: r => `<span class="badge amber">${esc(r.issuedAt ? fmtDate(String(r.issuedAt).slice(0, 10)) : '—')}</span>` }]),
    rows: () => DB.get('upgrades').filter(u => u.status === 'Issued')
  });
  const closedUpg = () => DB.get('upgrades').filter(u => u.status === 'Closed');
  Drill.register('upgrades:closed', {
    title: 'Closed trade-ins', unit: 'trade-in', sub: 'Completed exchanges with the margin they actually retained',
    go: { page: 'upgrades', label: 'Open trade-in desk' },
    emptyText: 'No trade-in has been closed yet.',
    openRow: id => openUpgradeDrawer(id),
    columns: upgCols.concat([
      { label: 'Credit above worth', align: 'right', render: r => `<b class="${num(r.tradeGap) >= 0 ? 'c-green' : 'c-red'}">${money(r.tradeGap)}</b>` }]),
    rows: () => closedUpg(),
    foot:  () => `<td colspan="4"><b>${fmt(closedUpg().length)} closed</b></td><td class="right"><b>${money(sum(closedUpg(), u => num(u.credit)))}</b></td><td class="right"></td><td class="right"><b>${money(sum(closedUpg(), u => num(u.margin)))}</b></td><td></td><td class="right"><b>${money(sum(closedUpg(), u => num(u.tradeGap)))}</b></td>`
  });
}

/* ============================================================ Card drills
 *
 * A second pass, separate from registerMetricDrills(), because it answers a
 * different question.
 *
 * registerMetricDrills covers the dashboard and the alert rows — the numbers
 * somebody already decided were worth chasing. This covers the stat cards that
 * sit at the top of every working page and in every ledger drawer: inventory
 * totals, PO commitments, courier spend, payroll months, attendance rates.
 *
 * The rule for every drill in this block is that it must compute its number the
 * same way the card computes it, from the same records, with the same filter.
 * That is deliberately repetitive. The tempting shortcut is to reach for the
 * page's own aggregate or to re-derive the figure in a tidier way, and that is
 * exactly how a drill ends up disagreeing with the card that sent you there —
 * a "35" above a list of 34 rows, which destroys the user's trust in both.
 * So the predicate is written out again here, next to the columns it produces,
 * where a change to the card and a change to the drill sit side by side.
 */
function registerCardDrills() {
  /* Shared record sets. Named rather than inlined so the three places each one
   * is used (rows, and the count in the footer) cannot drift apart. */
  const openPo    = () => DB.get('purchases').filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status));
  const paidPo    = () => DB.get('purchases').filter(p => p.status === 'Received');
  const paidSale  = () => DB.get('sales').filter(s => s.status === 'Paid');
  const openSale  = () => DB.get('sales').filter(s => s.status !== 'Paid' && s.status !== 'Cancelled');
  const closedRep = () => DB.get('repairs').filter(r => ['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status));
  const openRep   = () => DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status));
  const paidRep   = () => closedRep().filter(r => r.paid);
  const settledDsp = () => DB.get('dispatches').filter(d => ['Delivered', 'Handed Over'].includes(d.status));
  const latestPayMonth = () => {
    const m = DB.get('payroll').map(p => p.month).filter(Boolean).sort();
    return m.length ? m[m.length - 1] : '';
  };
  const cogs = (list) => sum(list, s => sum(s.items || [], i => num(i.cost) * num(i.qty)));
  const grossOf = (list) => sum(list, s => s.total) - cogs(list);
  const saleCols = [
    { label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
    { label: 'Customer', render: r => `<b>${esc(r.customerName || '—')}</b>` },
    { label: 'Items', align: 'right', render: r => fmt(sum(r.items || [], i => num(i.qty))) },
    { label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` }
  ];
  const poCols = [
    { label: 'PO', render: r => `<b class="mono">${esc(r.poNumber)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
    { label: 'Supplier', render: r => `<b>${esc(r.supplier || '—')}</b>` },
    { label: 'Item', render: r => esc(r.item || r.sku || '—') },
    { label: 'Qty', align: 'right', render: r => `${fmt(num(r.receivedQty))} / ${fmt(num(r.qty))}` },
    { label: 'Value', align: 'right', render: r => `<b>${money(r.total)}</b>` }
  ];

  /* ---- Purchases ---- */
  Drill.register('po:committed', {
    title: 'Committed purchase value', unit: 'order', sub: 'Ordered but not yet received',
    go: { page: 'purchases', label: 'Open purchases' },
    emptyText: 'Nothing is on order.',
    columns: poCols.concat([DC.status]),
    rows: () => openPo(),
    foot:  () => `<td colspan="4"><b>${fmt(openPo().length)} open orders</b></td><td class="right"><b>${money(sum(openPo(), p => num(p.total)))}</b></td><td></td>`
  });
  Drill.register('po:received', {
    title: 'Received purchase value', unit: 'order', sub: 'Stock already in',
    go: { page: 'purchases', label: 'Open purchases' },
    emptyText: 'Nothing has been received yet.',
    columns: poCols.concat([DC.status]),
    rows: () => paidPo(),
    foot:  () => `<td colspan="4"><b>${fmt(paidPo().length)} received</b></td><td class="right"><b>${money(sum(paidPo(), p => num(p.total)))}</b></td><td></td>`
  });

  /* ---- Sales ---- */
  Drill.register('sale:paid', {
    title: 'Collected', unit: 'order', sub: 'Orders already paid for',
    go: { page: 'sales', label: 'Open sales' },
    emptyText: 'Nothing has been collected yet.',
    columns: saleCols.concat([DC.status]),
    rows: () => paidSale(),
    foot:  () => `<td colspan="3"><b>${fmt(paidSale().length)} paid orders</b></td><td class="right"><b>${money(sum(paidSale(), s => num(s.total)))}</b></td><td></td>`
  });

  /* ---- Dispatch ----
   * Courier cost is a real number on a consignment, so the charges drill is the
   * one place a user can see which lanes are eating the margin. */
  Drill.register('dsp:charges', {
    title: 'Courier charges', unit: 'consignment', sub: 'Every consignment that cost money to move',
    go: { page: 'dispatch', label: 'Open dispatch' },
    emptyText: 'No courier cost has been recorded.',
    columns: [
      { label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b>` },
      { label: 'Customer', render: r => esc(r.customer || '—') },
      { label: 'Courier', render: r => esc(r.courier || '—') },
      { label: 'Route', render: r => `<span class="fs-12 text-2">${esc(r.route || '—')}</span>` },
      { label: 'Charge', align: 'right', render: r => `<b>${money(r.cost)}</b>` },
      DC.status],
    rows: () => DB.get('dispatches').slice().sort((a, b) => num(b.cost) - num(a.cost)),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('dispatches').length)} consignments</b></td><td class="right"><b>${money(sum(DB.get('dispatches'), d => num(d.cost)))}</b></td><td></td>`
  });
  Drill.register('dsp:delivered', {
    title: 'Delivered value', unit: 'consignment', sub: 'Settled consignments, at the order value they carried',
    go: { page: 'dispatch', label: 'Open dispatch' },
    emptyText: 'Nothing has been delivered yet.',
    columns: [
      { label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b>` },
      { label: 'Customer', render: r => `<b>${esc(r.customer || '—')}</b>` },
      { label: 'Order', render: r => {
        const s = r.saleId ? DB.byId('sales', r.saleId) : null;
        return s ? `<b class="mono">${esc(s.orderId)}</b>` : '<span class="text-3">—</span>';
      } },
      { label: 'Delivered', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.date))}</span>` },
      { label: 'Value', align: 'right', render: r => {
        const s = r.saleId ? DB.byId('sales', r.saleId) : null;
        return `<b>${money(s ? s.total : 0)}</b>`;
      } },
      DC.status],
    rows: () => settledDsp(),
    foot:  () => `<td colspan="4"><b>${fmt(settledDsp().length)} settled</b></td><td class="right"><b>${money(sum(settledDsp(), d => { const s = d.saleId ? DB.byId('sales', d.saleId) : null; return s ? s.total : 0; }))}</b></td><td></td>`
  });

  /* ---- Repairs ---- */
  Drill.register('rep:tat', {
    title: 'Turnaround', unit: 'ticket', sub: 'Intake to completion, for closed jobs',
    go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'No job has been closed yet, so there is no turnaround to measure.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => esc(r.model || '—') },
      { label: 'In', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.intakeDate))}</span>` },
      { label: 'Out', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.completedDate))}</span>` },
      { label: 'Days', align: 'right', render: r => {
        const d = daysBetween(r.intakeDate, r.completedDate || todayISO());
        return `<b class="${d > 5 ? 'c-red' : 'c-green'}">${fmt(d)}</b>`;
      } },
      DC.status],
    rows: () => closedRep(),
    foot:  () => {
      const c = closedRep();
      const avg = c.length ? (sum(c, r => daysBetween(r.intakeDate, r.completedDate || todayISO())) / c.length) : 0;
      return `<td colspan="4"><b>${fmt(c.length)} closed</b></td><td class="right"><b>${avg ? avg.toFixed(1) : '0.0'} d avg</b></td><td></td>`;
    }
  });
  Drill.register('rep:income', {
    title: 'Repair income', unit: 'ticket', sub: 'Parts plus labour on paid jobs',
    go: { page: 'repairs', label: 'Open repairs' },
    emptyText: 'No completed job has been paid for yet.',
    columns: [
      { label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b>` },
      { label: 'Model', render: r => esc(r.model || '—') },
      { label: 'Customer', render: r => esc(r.customerName || '—') },
      { label: 'Parts', align: 'right', render: r => money(r.cost) },
      { label: 'Labour', align: 'right', render: r => money(r.labourCost) },
      { label: 'Total', align: 'right', render: r => `<b>${money(num(r.cost) + num(r.labourCost))}</b>` }],
    rows: () => paidRep(),
    foot:  () => `<td colspan="5"><b>${fmt(paidRep().length)} paid jobs</b></td><td class="right"><b>${money(sum(paidRep(), r => num(r.cost) + num(r.labourCost)))}</b></td>`
  });

  /* ---- Invoices ---- */
  Drill.register('inv:paid', {
    title: 'Collected', unit: 'invoice', sub: 'Cash actually received against invoices',
    go: { page: 'invoices', label: 'Open invoices' },
    emptyText: 'Nothing has been collected yet.',
    columns: [
      { label: 'Invoice', render: r => `<b class="mono">${esc(r.invoiceNo)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { label: 'Type', render: r => `<span class="badge ${r.type === 'Sale' ? 'green' : 'amber'}">${esc(r.type)}</span>` },
      { label: 'Party', render: r => `<b>${esc(r.partyName)}</b>` },
      { label: 'Amount', align: 'right', render: r => money(r.amount) },
      { label: 'Settled', align: 'right', render: r => `<b class="c-green">${money(r.paid)}</b>` },
      DC.status],
    rows: () => DB.get('invoices').filter(i => num(i.paid) > 0),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('invoices').filter(i => num(i.paid) > 0).length)} invoices with a payment</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.amount)))}</b></td><td class="right"><b>${money(sum(DB.get('invoices'), i => num(i.paid)))}</b></td><td></td>`
  });

  /* ---- Customers & suppliers ----
   * The drawer cards describe one customer, but a drill is module-level. These
   * rank every party by the figure, so the one in the drawer is visibly at its
   * true position rather than looking like the only value in existence. */
  const custLifetime = (id) => sum(DB.get('sales').filter(s => s.customerId === id), s => s.total);
  Drill.register('cust:lifetime', {
    title: 'Lifetime value by customer', unit: 'customer', sub: 'All-time order value, highest first',
    go: { page: 'customers', label: 'Open customers' },
    emptyText: 'No customer has ordered yet.',
    columns: [
      { label: 'Customer', render: r => `<b>${esc(r.name)}</b><span class="row-sub">${esc(r.phone || '')}</span>` },
      { label: 'City', render: r => esc(r.city || '—') },
      { label: 'Orders', align: 'right', render: r => fmt(DB.get('sales').filter(s => s.customerId === r.id).length) },
      { label: 'Lifetime', align: 'right', render: r => `<b>${money(custLifetime(r.id))}</b>` },
      { label: 'Owes', align: 'right', render: r => `<b class="${num(r.balance) > 0 ? 'c-red' : 'c-green'}">${money(r.balance)}</b>` }],
    rows: () => DB.get('customers').slice().sort((a, b) => custLifetime(b.id) - custLifetime(a.id)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('customers').length)} customers</b></td><td class="right"><b>${money(sum(DB.get('customers'), c => custLifetime(c.id)))}</b></td><td class="right"><b>${money(sum(DB.get('customers'), c => num(c.balance)))}</b></td>`
  });
  Drill.register('cust:credit', {
    title: 'Credit used', unit: 'customer', sub: 'Balance as a share of the credit limit',
    go: { page: 'customers', label: 'Open customers' },
    emptyText: 'No customer has a credit limit set.',
    columns: [
      { label: 'Customer', render: r => `<b>${esc(r.name)}</b>` },
      { label: 'Limit', align: 'right', render: r => money(r.creditLimit) },
      { label: 'Used', align: 'right', render: r => `<b>${money(r.balance)}</b>` },
      { label: 'Share', align: 'right', render: r => {
        const pct = num(r.creditLimit) ? Math.round(num(r.balance) / num(r.creditLimit) * 100) : 0;
        return `<b class="${pct > 100 ? 'c-red' : pct > 75 ? 'c-amber' : 'c-green'}">${pct}%</b>`;
      } },
      { label: 'Bar', render: r => {
        const pct = num(r.creditLimit) ? Math.min(100, Math.round(num(r.balance) / num(r.creditLimit) * 100)) : 0;
        return `<div class="bar-track" style="min-width:90px"><div class="bar-fill ${pct > 100 ? 'red' : pct > 75 ? 'amber' : 'green'}" style="width:${pct}%"></div></div>`;
      } }],
    rows: () => DB.get('customers').slice().sort((a, b) => (num(b.creditLimit) ? num(b.balance) / num(b.creditLimit) : 0) - (num(a.creditLimit) ? num(a.balance) / num(a.creditLimit) : 0)),
    foot:  () => `<td colspan="2"><b>${fmt(DB.get('customers').length)} customers</b></td><td class="right"><b>${money(sum(DB.get('customers'), c => num(c.balance)))}</b></td><td class="right"><b>${money(sum(DB.get('customers'), c => num(c.creditLimit)))}</b></td><td></td>`
  });
  const supPurchased = (id) => sum(DB.get('purchases').filter(p => p.supplierId === id), p => p.total);
  Drill.register('sup:purchased', {
    title: 'Purchased by supplier', unit: 'supplier', sub: 'All-time purchase order value, highest first',
    go: { page: 'suppliers', label: 'Open suppliers' },
    emptyText: 'Nothing has been purchased yet.',
    columns: [
      { label: 'Supplier', render: r => `<b>${esc(r.name)}</b><span class="row-sub">${esc(r.accountNo || '')}</span>` },
      { label: 'City', render: r => esc(r.city || '—') },
      { label: 'Orders', align: 'right', render: r => fmt(DB.get('purchases').filter(p => p.supplierId === r.id).length) },
      { label: 'Purchased', align: 'right', render: r => `<b>${money(supPurchased(r.id))}</b>` },
      { label: 'Owed', align: 'right', render: r => `<b class="${num(r.balance) > 0 ? 'c-red' : 'c-green'}">${money(r.balance)}</b>` }],
    rows: () => DB.get('suppliers').slice().sort((a, b) => supPurchased(b.id) - supPurchased(a.id)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('suppliers').length)} suppliers</b></td><td class="right"><b>${money(sum(DB.get('suppliers'), s => supPurchased(s.id)))}</b></td><td class="right"><b>${money(sum(DB.get('suppliers'), s => num(s.balance)))}</b></td>`
  });
  Drill.register('sup:received', {
    title: 'Units received by supplier', unit: 'supplier', sub: 'How much stock each supplier has actually delivered',
    go: { page: 'suppliers', label: 'Open suppliers' },
    emptyText: 'Nothing has been received yet.',
    columns: [
      { label: 'Supplier', render: r => `<b>${esc(r.name)}</b>` },
      { label: 'Ordered', align: 'right', render: r => fmt(sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => num(p.qty))) },
      { label: 'Received', align: 'right', render: r => `<b>${fmt(sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => num(p.receivedQty)))}</b>` },
      { label: 'Fill rate', align: 'right', render: r => {
        const ord = sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => num(p.qty));
        const rec = sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => num(p.receivedQty));
        const pct = ord ? Math.round(rec / ord * 100) : 0;
        return `<b class="${pct >= 95 ? 'c-green' : pct >= 70 ? 'c-amber' : 'c-red'}">${pct}%</b>`;
      } }],
    rows: () => DB.get('suppliers'),
    foot:  () => {
      const all = DB.get('purchases');
      return `<td colspan="2"><b>${fmt(DB.get('suppliers').length)} suppliers</b></td><td class="right"><b>${fmt(sum(all, p => num(p.receivedQty)))}</b></td><td class="right"><b>${fmt(sum(all, p => num(p.qty)) ? Math.round(sum(all, p => num(p.receivedQty)) / sum(all, p => num(p.qty)) * 100) : 0)}%</b></td>`;
    }
  });

  /* ---- Employees & attendance ---- */
  Drill.register('emp:salary', {
    title: 'Base salary by employee', unit: 'employee', sub: 'Monthly cost of the team',
    go: { page: 'employees', label: 'Open employees' },
    emptyText: 'No employee is on the roster.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.name)}</b><span class="row-sub">${esc(r.code || '')}</span>` },
      { label: 'Department', render: r => esc(r.department || '—') },
      { label: 'Location', render: r => esc(r.location || '—') },
      { label: 'Monthly', align: 'right', render: r => `<b>${money(r.salary)}</b>` },
      { label: 'Status', render: r => statusBadge(r.status) }],
    rows: () => DB.get('employees').slice().sort((a, b) => num(b.salary) - num(a.salary)),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('employees').length)} employees</b></td><td class="right"><b>${money(sum(DB.get('employees'), e => num(e.salary)))}</b></td><td></td>`
  });
  Drill.register('att:total', {
    title: 'Attendance punches', unit: 'punch', sub: 'Every captured record',
    go: { page: 'attendance', label: 'Open attendance' },
    emptyText: 'No punches have been captured.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b><span class="row-sub">${esc(r.code || '')}</span>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      { label: 'In', align: 'center', render: r => `<b>${esc(fmtTime(r.checkTime))}</b>` },
      { label: 'Department', render: r => esc(r.department || '—') },
      { label: 'Result', render: r => `<span class="badge ${r.status === 'Late' ? 'amber' : 'green'}">${esc(r.status)}</span>` }],
    rows: () => DB.get('attendance').slice().sort((a, b) => (b.date + (b.checkTime || '')).localeCompare(a.date + (a.checkTime || ''))),
    foot:  () => {
      const all = DB.get('attendance');
      return `<td colspan="2"><b>${fmt(all.length)} punches</b></td><td></td><td class="right"><b>${fmt(new Set(all.map(a => a.employeeId)).size)} staff</b></td><td class="right"><b>${fmt(all.filter(a => a.status === 'Present').length)} on time</b></td>`;
    }
  });
  Drill.register('att:staff', {
    title: 'Staff with recorded attendance', unit: 'employee', sub: 'Distinct employees in the punch log',
    go: { page: 'attendance', label: 'Open attendance' },
    emptyText: 'No punches have been captured.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Code', render: r => `<span class="mono fs-12">${esc(r.code || '—')}</span>` },
      { label: 'Department', render: r => esc(r.department || '—') },
      { label: 'Punches', align: 'right', render: r => `<b>${fmt(DB.get('attendance').filter(a => a.employeeId === r.employeeId).length)}</b>` },
      { label: 'Late', align: 'right', render: r => fmt(DB.get('attendance').filter(a => a.employeeId === r.employeeId && a.status === 'Late').length) }],
    rows: () => {
      const seen = new Map();
      DB.get('attendance').forEach(a => {
        if (a.employeeId && !seen.has(a.employeeId)) seen.set(a.employeeId, { id: a.employeeId, employeeId: a.employeeId, employeeName: a.employeeName, code: a.code, department: a.department });
      });
      return [...seen.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    },
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('employees').length)} on the roster</b></td><td class="right"><b>${fmt(DB.get('attendance').length)}</b></td><td class="right"><b>${fmt(DB.get('attendance').filter(a => a.status === 'Late').length)}</b></td>`
  });
  Drill.register('att:ontime', {
    title: 'On-time record', unit: 'punch', sub: 'Present against late, across the whole log',
    go: { page: 'attendance', label: 'Open attendance' },
    emptyText: 'No punches have been captured.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Date', align: 'center', render: r => esc(fmtDate(r.date)) },
      { label: 'In', align: 'center', render: r => `<b class="${r.status === 'Late' ? 'c-amber' : ''}">${esc(fmtTime(r.checkTime))}</b>` },
      { label: 'Late by', align: 'right', render: r => r.status === 'Late'
        ? `<b class="c-amber">${fmt(Math.max(0, (clockMinutes(localClockOf(r.checkTime)) ?? 0) - (clockMinutes(state.db.settings.shiftStart || '09:00') ?? 540)))} m</b>`
        : '<span class="text-3">on time</span>' },
      { label: 'Result', render: r => `<span class="badge ${r.status === 'Late' ? 'amber' : 'green'}">${esc(r.status)}</span>` }],
    rows: () => DB.get('attendance'),
    foot:  () => {
      const all = DB.get('attendance');
      const present = all.filter(a => a.status === 'Present').length;
      return `<td colspan="2"><b>${fmt(all.length)} punches</b></td><td></td><td class="right"><b>${all.length ? Math.round(present / all.length * 100) : 0}% on time</b></td><td class="right"><b>${fmt(present)} / ${fmt(all.length)}</b></td>`;
    }
  });

  /* ---- Leave ---- */
  const leaveCols = [
    { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
    { label: 'Type', render: r => `<span class="badge purple">${esc(r.type || 'Leave')}</span>` },
    { label: 'From', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.startDate))}</span>` },
    { label: 'To', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.endDate))}</span>` },
    { label: 'Days', align: 'right', render: r => `<b>${fmt(num(r.days))}</b>` },
    { label: 'Reason', render: r => `<span class="fs-12 text-2">${esc(r.reason || '—')}</span>` }
  ];
  Drill.register('leave:approved', {
    title: 'Approved leave', unit: 'request', sub: 'Granted and still counted against the roster',
    go: { page: 'leave', label: 'Open leave' },
    emptyText: 'No leave has been approved.',
    columns: leaveCols.concat([DC.status]),
    rows: () => DB.get('leaves').filter(l => l.status === 'Approved'),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('leaves').filter(l => l.status === 'Approved').length)} approved</b></td><td class="right"><b>${fmt(sum(DB.get('leaves').filter(l => l.status === 'Approved'), l => num(l.days)))} days</b></td><td></td><td></td>`
  });
  Drill.register('leave:rejected', {
    title: 'Rejected leave', unit: 'request', sub: 'Declined requests, with the reason on file',
    go: { page: 'leave', label: 'Open leave' },
    emptyText: 'Nothing has been rejected.',
    columns: leaveCols.concat([DC.status]),
    rows: () => DB.get('leaves').filter(l => l.status === 'Rejected'),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('leaves').filter(l => l.status === 'Rejected').length)} rejected</b></td><td class="right"><b>${fmt(sum(DB.get('leaves').filter(l => l.status === 'Rejected'), l => num(l.days)))} days</b></td><td></td><td></td>`
  });
  Drill.register('leave:away', {
    title: 'Staff on leave', unit: 'employee', sub: 'Marked away on the roster right now',
    go: { page: 'leave', label: 'Open leave' },
    emptyText: 'Everyone is in.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.name)}</b><span class="row-sub">${esc(r.code || '')}</span>` },
      { label: 'Department', render: r => esc(r.department || '—') },
      { label: 'Location', render: r => esc(r.location || '—') },
      { label: 'Joined', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.joinDate))}</span>` },
      { label: 'Status', render: r => statusBadge(r.status) }],
    rows: () => DB.get('employees').filter(e => e.status === 'On Leave'),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('employees').length)} on the roster</b></td><td class="right"><b>${fmt(DB.get('employees').filter(e => e.status === 'On Leave').length)} away</b></td>`
  });

  /* ---- Payroll ---- */
  const payCols = [
    { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b><span class="row-sub">${esc(r.code || '')}</span>` },
    { label: 'Month', align: 'center', render: r => `<span class="badge grey">${esc(monthLabel(r.month))}</span>` },
    { label: 'Base', align: 'right', render: r => money(r.baseSalary) },
    { label: 'Overtime', align: 'right', render: r => `${fmt(num(r.overtimeHours))} h <span class="text-3">@ ${money(r.overtimeRate)}</span>` },
    { label: 'Deductions', align: 'right', render: r => `<b class="c-red">${money(r.deductions)}</b>` },
    { label: 'Bonus', align: 'right', render: r => `<b class="c-green">${money(r.bonus)}</b>` },
    { label: 'Net', align: 'right', render: r => `<b>${money(r.netSalary)}</b>` }
  ];
  Drill.register('pay:month', {
    title: 'Payroll run', unit: 'payslip', sub:  () => `Payslips for ${monthLabel(latestPayMonth()) || 'the latest month'}`,
    go: { page: 'payroll', label: 'Open payroll' },
    emptyText: 'Payroll has not been run yet.',
    columns: payCols.concat([DC.status]),
    rows: () => DB.get('payroll').filter(p => p.month === latestPayMonth()),
    foot:  () => {
      const cur = DB.get('payroll').filter(p => p.month === latestPayMonth());
      return `<td colspan="2"><b>${fmt(cur.length)} employees</b></td><td class="right"><b>${money(sum(cur, p => num(p.baseSalary)))}</b></td><td class="right"><b>${money(sum(cur, p => num(p.overtimeHours) * num(p.overtimeRate)))}</b></td><td class="right"><b>${money(sum(cur, p => num(p.deductions)))}</b></td><td class="right"><b>${money(sum(cur, p => num(p.bonus)))}</b></td><td class="right"><b>${money(sum(cur, p => num(p.netSalary)))}</b></td><td></td>`;
    }
  });
  Drill.register('pay:paid', {
    title: 'Payroll paid', unit: 'payslip', sub: 'Processed runs, all time',
    go: { page: 'payroll', label: 'Open payroll' },
    emptyText: 'No payroll has been processed yet.',
    columns: payCols.concat([DC.status]),
    rows: () => DB.get('payroll').filter(p => p.status === 'Processed'),
    foot:  () => {
      const all = DB.get('payroll').filter(p => p.status === 'Processed');
      return `<td colspan="2"><b>${fmt(all.length)} payslips</b></td><td class="right"><b>${money(sum(all, p => num(p.baseSalary)))}</b></td><td class="right"><b>${money(sum(all, p => num(p.overtimeHours) * num(p.overtimeRate)))}</b></td><td class="right"><b>${money(sum(all, p => num(p.deductions)))}</b></td><td class="right"><b>${money(sum(all, p => num(p.bonus)))}</b></td><td class="right"><b>${money(sum(all, p => num(p.netSalary)))}</b></td><td></td>`;
    }
  });
  Drill.register('pay:overtime', {
    title: 'Overtime cost', unit: 'payslip', sub: 'Hours multiplied by the rate actually paid',
    go: { page: 'payroll', label: 'Open payroll' },
    emptyText: 'No overtime has been recorded.',
    columns: [
      { label: 'Employee', render: r => `<b>${esc(r.employeeName || '—')}</b>` },
      { label: 'Month', align: 'center', render: r => `<span class="badge grey">${esc(monthLabel(r.month))}</span>` },
      { label: 'Hours', align: 'right', render: r => `<b class="${num(r.overtimeHours) > 10 ? 'c-amber' : ''}">${fmt(num(r.overtimeHours))}</b>` },
      { label: 'Rate', align: 'right', render: r => money(r.overtimeRate) },
      { label: 'Cost', align: 'right', render: r => `<b>${money(num(r.overtimeHours) * num(r.overtimeRate))}</b>` }],
    rows: () => DB.get('payroll').filter(p => num(p.overtimeHours) > 0).sort((a, b) => (num(b.overtimeHours) * num(b.overtimeRate)) - (num(a.overtimeHours) * num(a.overtimeRate))),
    foot:  () => `<td colspan="4"><b>${fmt(DB.get('payroll').filter(p => num(p.overtimeHours) > 0).length)} payslips with overtime</b></td><td class="right"><b>${money(sum(DB.get('payroll'), p => num(p.overtimeHours) * num(p.overtimeRate)))}</b></td>`
  });

  /* ---- Finance ----
   * Cash position is a subtraction, not a record set: money collected, less
   * courier spend, less payroll. So the drill shows the three legs with their
   * own totals, and the reader can check the arithmetic rather than trust it. */
  Drill.register('fin:cash', {
    title: 'Cash position', unit: 'flow', sub: 'Collected, less courier and payroll cost',
    go: { page: 'finance', label: 'Open finance' },
    emptyText: 'No cash has moved yet.',
    columns: [
      { label: 'Leg', render: r => `<b>${esc(r.label)}</b>` },
      { label: 'Basis', render: r => `<span class="fs-12 text-2">${esc(r.basis)}</span>` },
      { label: 'Records', align: 'right', render: r => `<b>${fmt(r.n)}</b>` },
      { label: 'Amount', align: 'right', render: r => `<b class="${r.sign < 0 ? 'c-red' : 'c-green'}">${r.sign < 0 ? '−' : ''}${money(Math.abs(r.amount))}</b>` }],
    rows: () => {
      const collected = sum(DB.get('sales').filter(s => s.status === 'Paid' || s.paid), s => s.total);
      const courier = sum(DB.get('dispatches'), d => num(d.cost));
      const payroll = sum(DB.get('payroll').filter(p => p.status === 'Processed'), p => num(p.netSalary));
      return [
        { id: 'in',  label: 'Collected from customers', basis: 'Sales marked paid', n: DB.get('sales').filter(s => s.status === 'Paid' || s.paid).length, amount: collected, sign: 1 },
        { id: 'out1', label: 'Courier and delivery',       basis: 'Charge on every consignment', n: DB.get('dispatches').length, amount: courier, sign: -1 },
        { id: 'out2', label: 'Payroll',                  basis: 'Processed payslips, net', n: DB.get('payroll').filter(p => p.status === 'Processed').length, amount: payroll, sign: -1 }
      ];
    },
    foot:  () => {
      const collected = sum(DB.get('sales').filter(s => s.status === 'Paid' || s.paid), s => s.total);
      const courier = sum(DB.get('dispatches'), d => num(d.cost));
      const payroll = sum(DB.get('payroll').filter(p => p.status === 'Processed'), p => num(p.netSalary));
      const net = collected - courier - payroll;
      return `<td colspan="3"><b>Net position</b></td><td class="right"><b class="${net >= 0 ? 'c-green' : 'c-red'}">${money(net)}</b></td>`;
    }
  });
  Drill.register('fin:margin', {
    title: 'Gross margin', unit: 'order', sub: 'Order value less the cost of the items on it',
    go: { page: 'finance', label: 'Open finance' },
    emptyText: 'No orders to measure.',
    columns: [
      { label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { label: 'Customer', render: r => esc(r.customerName || '—') },
      { label: 'Revenue', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      { label: 'Cost', align: 'right', render: r => `<span class="c-red">${money(cogs([r]))}</span>` },
      { label: 'Profit', align: 'right', render: r => {
        const g = num(r.total) - cogs([r]);
        return `<b class="${g >= 0 ? 'c-green' : 'c-red'}">${money(g)}</b>`;
      } },
      { label: 'Margin', align: 'right', render: r => {
        const g = num(r.total) - cogs([r]);
        const pct = num(r.total) ? g / num(r.total) * 100 : 0;
        return `<b class="${pct >= 18 ? 'c-green' : pct > 0 ? 'c-amber' : 'c-red'}">${pct.toFixed(1)}%</b>`;
      } }],
    rows: () => DB.get('sales').slice().sort((a, b) => {
      const ga = num(a.total) ? (num(a.total) - cogs([a])) / num(a.total) * 100 : 0;
      const gb = num(b.total) ? (num(b.total) - cogs([b])) / num(b.total) * 100 : 0;
      return gb - ga;
    }),
    foot:  () => {
      const all = DB.get('sales');
      const rev = sum(all, s => s.total);
      const gp = grossOf(all);
      return `<td colspan="4"><b>${fmt(all.length)} orders</b></td><td class="right"><b>${money(gp)}</b></td><td class="right"><b>${rev ? (gp / rev * 100).toFixed(1) : '0.0'}%</b></td>`;
    }
  });
  Drill.register('fin:revenue', {
    title: 'Revenue', unit: 'order', sub: 'All orders ever recorded',
    go: { page: 'finance', label: 'Open finance' },
    emptyText: 'No orders have been recorded.',
    columns: saleCols.concat([DC.status]),
    rows: () => DB.get('sales').slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
    foot:  () => `<td colspan="3"><b>${fmt(DB.get('sales').length)} orders</b></td><td class="right"><b>${money(sum(DB.get('sales'), s => num(s.total)))}</b></td><td></td>`
  });

  /* ---- Analytics ----
   * Stock turnover is a ratio of two aggregates rather than a filtered set, so
   * the drill cannot be a table of records. It shows the two legs instead, which
   * is the only way to let a user disagree with the ratio. */
  Drill.register('an:turnover', {
    title: 'Stock turnover', unit: 'ratio', sub: 'Revenue over stock value, as two checkable legs',
    go: { page: 'analytics', label: 'Open analytics' },
    columns: [
      { label: 'Leg', render: r => `<b>${esc(r.label)}</b>` },
      { label: 'Basis', render: r => `<span class="fs-12 text-2">${esc(r.basis)}</span>` },
      { label: 'Amount', align: 'right', render: r => `<b>${money(r.amount)}</b>` }],
    rows: () => {
      const rev = sum(DB.get('sales'), s => s.total);
      const val = inventoryValue();
      return [
        { id: 'rev', label: 'Revenue', basis: 'All orders, at order value', amount: rev },
        { id: 'val', label: 'Stock value', basis: 'Available units at landed cost', amount: val }
      ];
    },
    foot:  () => {
      const rev = sum(DB.get('sales'), s => s.total);
      const val = inventoryValue();
      return `<td colspan="2"><b>${val ? (rev / val).toFixed(2) : '0.00'}× per year</b></td><td class="right"><b>${money(rev)} ÷ ${money(val)}</b></td>`;
    }
  });

  /* ---- Reports ---- */
  Drill.register('inv:retail', {
    title: 'Retail value of stock', unit: 'line', sub: 'Available units at the retail price, not cost',
    go: { page: 'inventory', label: 'Open inventory' },
    emptyText: 'There is no stock to price.',
    columns: [
      { label: 'Item', render: r => `<b>${esc(r.sku || r.model || '—')}</b><span class="row-sub">${esc(r.color || '')}</span>` },
      { label: 'Brand', render: r => esc(r.brand || '—') },
      { label: 'Facility', render: r => esc(r.house || '—') },
      { label: 'In hand', align: 'right', render: r => `<b>${fmt(inHand(r))}</b>` },
      { label: 'Cost ea.', align: 'right', render: r => money(r.unitCost) },
      { label: 'Retail ea.', align: 'right', render: r => money(r.unitPrice) },
      { label: 'At retail', align: 'right', render: r => `<b class="c-green">${money(inHand(r) * num(r.unitPrice))}</b>` },
      { label: 'At cost', align: 'right', render: r => `<b>${money(lineValue(r))}</b>` }],
    rows: () => DB.get('inventory').slice().sort((a, b) => (inHand(b) * num(b.unitPrice)) - (inHand(a) * num(a.unitPrice))),
    foot:  () => `<td colspan="6"><b>${fmt(DB.get('inventory').length)} stock lines</b></td><td class="right"><b>${money(sum(DB.get('inventory'), l => inHand(l) * num(l.unitPrice)))}</b></td><td class="right"><b>${money(inventoryValue())}</b></td>`
  });

  /* ---- Live attendance board ----
   * These four back the cards on the Live page, so they are scoped to the day
   * the user is actually looking at rather than the whole log. `state.ui.liveDate`
   * is the same value renderLive() used for the cards above them. */
  const liveDay = () => DeviceHub.board((state.ui && state.ui.liveDate) || localDayOf(new Date()));
  const liveCols = [
    { label: 'Person', render: r => `<b>${esc(r.name)}</b><span class="row-sub">${esc(r.code || r.department || '')}</span>` },
    { label: 'First in', align: 'center', render: r => `<b class="${r.status === 'Late' ? 'c-amber' : ''}">${esc(fmtTime(r.firstIn))}</b>` },
    { label: 'Last out', align: 'center', render: r => esc(fmtTime(r.lastOut)) },
    { label: 'Punches', align: 'right', render: r => `<b>${fmt(r.punchCount)}</b>` },
    { label: 'Worked', align: 'right', render: r => esc(r.workedLabel || '—') },
    { label: 'Status', render: r => `<span class="badge ${r.status === 'Present' ? 'green' : r.status === 'Late' ? 'amber' : 'blue'}">${esc(r.status)}</span>` }
  ];
  const liveSpec = (title, sub, keep) => ({
    title, unit: 'person', sub, go: { page: 'live', label: 'Open live board' },
    emptyText: 'Nobody matches that on the day shown.',
    columns: liveCols,
    rows: () => liveDay().rows.filter(keep),
    foot:  () => {
      const d = liveDay();
      return `<td colspan="2"><b>${fmt(d.rows.length)} seen on ${esc(fmtDate(d.date))}</b></td><td class="right"><b>${fmt(sum(d.rows, r => r.punchCount))} punches</b></td><td class="right"><b>${esc(d.shift.start)}–${esc(d.shift.end)}</b></td><td class="right"><b>${fmt(d.totals.present)} present</b></td><td></td>`;
    }
  });
  Drill.register('att:onsite',  liveSpec('On site', 'Present on the selected day', r => r.status === 'Present' || r.status === 'Weekend'));
  Drill.register('att:late',    liveSpec('Late arrivals', 'Past the shift start plus grace', r => r.status === 'Late'));
  Drill.register('att:half',    liveSpec('Half day and early leave', 'Short hours, or leaving before the shift ends', r => r.status === 'Half Day' || r.status === 'Early Leave'));
  Drill.register('att:punches', {
    title: 'Punches on the selected day', unit: 'person', sub: 'Every person the devices saw',
    go: { page: 'live', label: 'Open live board' },
    emptyText: 'No punches on the day shown.',
    columns: liveCols,
    rows: () => liveDay().rows,
    foot:  () => {
      const d = liveDay();
      return `<td colspan="2"><b>${fmt(d.rows.length)} people</b></td><td class="right"><b>${fmt(sum(d.rows, r => r.punchCount))} punches</b></td><td class="right"><b>${fmt(d.totals.unmapped)} unmapped</b></td><td class="right"><b>${fmt(d.totals.matched)} matched</b></td><td></td>`;
    }
  });
  /* The Unmatched PINs card used to point at the `live` page, which is the page
   * it already sits on — so tapping it did nothing at all. The useful answer is
   * the list of punches that could not be attributed to an employee, with the
   * device and PIN that produced them, because that is what has to be fixed. */
  Drill.register('live:unmapped', {
    title: 'Unmatched punches', unit: 'person', sub: 'Seen by a device but not attributed to an employee',
    go: { page: 'live', label: 'Open live board' },
    emptyText: 'Every punch is attributed to an employee.',
    columns: [
      { label: 'Reported as', render: r => `<b class="c-amber">${esc(r.name)}</b>` },
      { label: 'Department', render: r => esc(r.department || '—') },
      { label: 'Device', render: r => `<span class="mono fs-12">${esc(r.deviceId || '—')}</span>` },
      { label: 'PIN', render: r => `<span class="mono fs-12">${esc(r.pin || '—')}</span>` },
      { label: 'First in', align: 'center', render: r => `<b>${esc(fmtTime(r.firstIn))}</b>` },
      { label: 'Punches', align: 'right', render: r => `<b>${fmt(r.punchCount)}</b>` }],
    rows: () => liveDay().rows.filter(r => !r.matched),
    foot:  () => {
      const d = liveDay();
      return `<td colspan="4"><b>${fmt(d.totals.unmapped)} unmatched of ${fmt(d.rows.length)} seen</b></td><td class="right"><b>${fmt(sum(d.rows.filter(r => !r.matched), r => r.punchCount))} punches</b></td><td class="right">Map them in Attendance</td>`;
    }
  });
}

/* ------------------------------------------------- Duplicate detection rows
 * The dashboard's duplicate alerts count a collision; these shape it into
 * something readable, so the count on the alert row and the rows in the drill
 * come from one implementation. */
function duplicateImeiRows() {
  const seen = new Map();
  const bump = (imei, where, sku) => {
    const k = norm(imei);
    if (!k) return;
    const r = seen.get(k) || { id: k, imei, times: 0, where: [], sku: sku || '' };
    r.times++;
    if (r.where.indexOf(where) < 0) r.where.push(where);
    seen.set(k, r);
  };
  DB.get('imeis').forEach(r => bump(r.imei, `Stock · ${r.house || '—'}`, r.sku));
  DB.get('repairs').forEach(r => {
    [r.imei, r.imei2].forEach(v => bump(v, `Repair ${r.ticketNo}`, r.model));
  });
  DB.get('upgrades').forEach(u => {
    bump(u.oldImei, `Trade-in ${u.ref} (incoming)`, u.oldModel);
    bump(u.newImei, `Trade-in ${u.ref} (outgoing)`, u.newModel);
  });
  return Array.from(seen.values())
    .filter(r => r.times > 1)
    .map(r => Object.assign(r, { where: r.where.join(' · ') }));
}

function duplicateOrderRows() {
  const seen = new Map();
  const bump = (ref, name) => {
    const k = norm(ref);
    if (!k) return;
    const r = seen.get(k) || { id: k, ref, times: 0, names: [] };
    r.times++;
    if (r.names.indexOf(name) < 0) r.names.push(name);
    seen.set(k, r);
  };
  DB.get('sales').forEach(s => bump(s.orderId, s.customerName));
  DB.get('purchases').forEach(p => bump(p.poNumber, p.supplier));
  DB.get('invoices').forEach(i => bump(i.invoiceNo, i.partyName));
  return Array.from(seen.values())
    .filter(r => r.times > 1)
    .map(r => Object.assign(r, { names: r.names.join(' · ') }));
}

/* ==========================================================================
   AMAYA ERP — Pages D: Finance, Analytics, Reports, Audit, Settings, Admin
   ========================================================================== */

/* --------------------------------------------------------------- Finance */
function renderFinance() {
  const sales = DB.get('sales');
  const purchases = DB.get('purchases');
  const invoices = DB.get('invoices');
  const paidSales = sales.filter(s => s.status === 'Paid' || s.paid);
  const receivables = invoices.filter(i => i.type === 'Sale' && i.status !== 'Paid');
  const payables = invoices.filter(i => i.type === 'Purchase' && i.status !== 'Paid');
  const revenue = sum(sales, s => s.total);
  const cogs = sum(sales, s => sum(s.items || [], i => num(i.cost) * num(i.qty)));
  const grossProfit = revenue - cogs;
  const margin = revenue ? (grossProfit / revenue * 100) : 0;
  const payrollCost = sum(DB.get('payroll').filter(p => p.status === 'Processed'), p => p.netSalary);
  const repairIncome = sum(DB.get('repairs').filter(r => r.paid), r => num(r.cost) + num(r.labourCost));
  const courierCost = sum(DB.get('dispatches'), d => d.cost);
  const cash = sum(paidSales, s => s.total) - courierCost - payrollCost;

  $('finStats').innerHTML = [
    statCard({ onClick: 'fin:cash', icon: '◍', label: 'Cash position', value: money(cash), meta: 'Collected less operating cost', color: cash >= 0 ? 'green' : 'red' }),
    statCard({ onClick: 'inv:receivable', icon: '▲', label: 'Receivables', value: money(sum(receivables, i => num(i.amount) - num(i.paid))), meta: `${receivables.length} open invoices`, color: 'blue' }),
    statCard({ onClick: 'inv:payable', icon: '▼', label: 'Payables', value: money(sum(payables, i => num(i.amount) - num(i.paid))), meta: `${payables.length} open bills`, color: 'red' }),
    statCard({ onClick: 'fin:margin', icon: '◫', label: 'Gross margin', value: margin.toFixed(1) + '%', meta: `${money(grossProfit)} gross profit`, color: margin >= 20 ? 'green' : 'amber' }),
    statCard({ onClick: 'fin:revenue', icon: '◌', label: 'Revenue (all time)', value: money(revenue), meta: `${sales.length} orders`, color: 'purple' }),
    statCard({ onClick: 'rep:income', icon: '✦', label: 'Service income', value: money(repairIncome), meta: 'After-sales repairs', color: 'teal' })
  ].join('');

  /* Cash flow by month */
  const monthKeys = uniq([...sales.map(s => monthKey(s.date)), ...purchases.map(p => monthKey(p.date))].filter(Boolean)).sort().slice(-8);
  const inflow = monthKeys.map(k => sum(sales.filter(s => monthKey(s.date) === k), s => s.total));
  const outflow = monthKeys.map(k => sum(purchases.filter(p => monthKey(p.date) === k && p.status === 'Received'), p => p.total));
  const maxCF = Math.max(1, ...inflow, ...outflow);
  $('finChart').innerHTML = monthKeys.length ? `
    <div class="cols">${monthKeys.map((k, i) => `
      <div class="col" title="${esc(monthLabel(k))} — in ${money(inflow[i])} · out ${money(outflow[i])}">
        <b>${inflow[i] ? money(inflow[i]) : ''}</b>
        <div class="stack" style="gap:2px">
          <div style="height:${Math.max(2, (inflow[i] / maxCF) * 100)}%;background:linear-gradient(180deg,#3ec48f,var(--green))"></div>
          <div style="height:${Math.max(2, (outflow[i] / maxCF) * 100)}%;background:linear-gradient(180deg,#ef8b83,var(--red))"></div>
        </div>
        <span>${esc(monthLabel(k).split(' ')[0].slice(0, 3))}</span>
      </div>`).join('')}</div>
    <div class="row-wrap mt-12 fs-11 text-3" style="gap:14px">
      <span class="row gap-4"><span class="chip-dot" style="background:var(--green)"></span>Inflow</span>
      <span class="row gap-4"><span class="chip-dot" style="background:var(--red)"></span>Stock purchases</span>
    </div>`
    : '<div class="empty" style="padding:26px"><b>No financial history</b></div>';

  /* Ledger */
  const ledger = sortBy(invoices, i => i.date, -1).slice(0, 60);
  $('finLedger').innerHTML = ledger.length ? ledger.map(i => `
    <div class="list-row">
      <span class="lead" style="background:${i.type === 'Sale' ? 'var(--green-soft)' : 'var(--amber-soft)'};color:${i.type === 'Sale' ? 'var(--green)' : 'var(--amber-strong)'}">${i.type === 'Sale' ? '＋' : '−'}</span>
      <span class="body"><b>${esc(i.partyName)}</b><small class="mono">${esc(i.invoiceNo)} · ${esc(fmtDate(i.date))}</small></span>
      <span class="trail"><b class="${i.type === 'Sale' ? 'c-green' : 'c-red'}">${i.type === 'Sale' ? '+' : '−'}${money(i.amount)}</b><br>${statusBadge(i.status)}</span>
    </div>`).join('') : '<div class="empty" style="padding:24px"><b>No ledger entries</b></div>';

  /* Receivables ageing */
  const buckets = [
    { label: 'Not yet due', test: i => i.dueDate >= todayISO(), cls: 'g' },
    { label: '1–30 days',  test: i => { const d = daysBetween(i.dueDate, todayISO()); return d > 0 && d <= 30; }, cls: '' },
    { label: '31–60 days', test: i => { const d = daysBetween(i.dueDate, todayISO()); return d > 30 && d <= 60; }, cls: '' },
    { label: '60+ days',    test: i => daysBetween(i.dueDate, todayISO()) > 60, cls: 'r' }
  ];
  const aged = buckets.map(b => ({ ...b, amt: sum(receivables.filter(b.test), i => num(i.amount) - num(i.paid)), n: receivables.filter(b.test).length }));
  const maxAge = Math.max(1, ...aged.map(a => a.amt));
  $('finAgeing').innerHTML = aged.map(a => `
    <div class="bar-row">
      <span class="nm">${esc(a.label)}</span>
      <div class="bar-track"><div class="bar-fill ${a.cls}" style="width:${a.amt ? Math.round(a.amt / maxAge * 100) : 0}%"></div></div>
      <span class="bar-val">${money(a.amt)}<br><span class="fs-11 text-3">${a.n} inv</span></span>
    </div>`).join('');

  /* Supplier payables */
  const bySup = groupBy(payables, i => i.partyName);
  const supRows = Object.entries(bySup).map(([n, list]) => ({ n, amt: sum(list, i => num(i.amount) - num(i.paid)) })).sort((a, b) => b.amt - a.amt).slice(0, 8);
  const maxSup = Math.max(1, ...supRows.map(r => r.amt));
  $('finSuppliers').innerHTML = supRows.length ? supRows.map(r => barRow(r.n, r.amt, maxSup, 'r', money(r.amt))).join('')
    : '<div class="empty" style="padding:24px"><b>Nothing owed to suppliers</b></div>';
}

/* ------------------------------------------------------------- Analytics */
function renderAnalytics() {
  const sales = DB.get('sales');
  const inv = DB.get('inventory');
  const thisMonth = monthKey(new Date());
  const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = monthKey(lastMonthDate);

  const mSales = sum(sales.filter(s => monthKey(s.date) === thisMonth), s => s.total);
  const lSales = sum(sales.filter(s => monthKey(s.date) === lastMonth), s => s.total);
  const salesTrend = lSales ? ((mSales - lSales) / lSales * 100) : 0;
  const cogs = sum(sales, s => sum(s.items || [], i => num(i.cost) * num(i.qty)));
  const revenue = sum(sales, s => s.total);
  const margin = revenue ? ((revenue - cogs) / revenue * 100) : 0;
  const stockValue = inventoryValue();
  const turnover = stockValue ? (revenue / stockValue) : 0;
  const att = DB.get('attendance');
  const attRate = att.length ? Math.round(att.filter(a => a.status === 'Present').length / att.length * 100) : 0;
  const openRep = DB.get('repairs').filter(r => !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status)).length;

  $('anaStats').innerHTML = [
    statCard({ onClick: 'dash:revenue', icon: '◌', label: 'Revenue this month', value: money(mSales), meta: monthLabel(thisMonth), color: 'blue', trend: { dir: salesTrend >= 0 ? 'up' : 'down', text: Math.abs(salesTrend).toFixed(1) + '%' } }),
    statCard({ onClick: 'fin:margin', icon: '◍', label: 'Gross margin', value: margin.toFixed(1) + '%', meta: `${money(revenue - cogs)} gross`, color: margin >= 18 ? 'green' : 'amber' }),
    statCard({ onClick: 'an:turnover', icon: '▤', label: 'Stock turnover', value: turnover.toFixed(2) + '×', meta: 'Revenue ÷ stock value', color: 'purple' }),
    statCard({ onClick: 'att:ontime', icon: '◉', label: 'Attendance rate', value: attRate + '%', meta: `${fmt(att.length)} punches`, color: attRate >= 85 ? 'green' : 'amber' }),
    statCard({ onClick: 'dash:repairs', icon: '◈', label: 'Open service jobs', value: fmt(openRep), meta: 'In the workshop', color: 'teal' }),
    statCard({ onClick: 'inv:value', icon: '◫', label: 'Stock value', value: money(stockValue), meta: `${fmt(totalUnits())} units`, color: 'amber' })
  ].join('');

  /* Top items */
  const byItem = {};
  sales.forEach(s => (s.items || []).forEach(i => {
    const k = i.sku;
    byItem[k] = byItem[k] || { sku: k, units: 0, value: 0, profit: 0 };
    byItem[k].units += num(i.qty);
    byItem[k].value += num(i.qty) * num(i.price);
    byItem[k].profit += num(i.qty) * (num(i.price) - num(i.cost));
  }));
  const top = Object.values(byItem).sort((a, b) => b.value - a.value).slice(0, 12);
  Pagers.render('anaTop', {
    rows: top, mount: 'anaTop', per: 12, pageSize: 12, unit: 'items', noFoot: true,
    emptyTitle: 'No sales recorded',
    columns: [
      { key: 'sku', label: 'Model', render: r => `<b>${esc(r.sku)}</b>` },
      { key: 'units', label: 'Units', align: 'right', render: r => fmt(r.units) },
      { key: 'value', label: 'Revenue', align: 'right', render: r => money(r.value) },
      { key: 'profit', label: 'Profit', align: 'right', render: r => `<b class="${r.profit >= 0 ? 'c-green' : 'c-red'}">${money(r.profit)}</b>` }
    ]
  });

  /* Slow movers */
  const soldMap = {};
  sales.forEach(s => (s.items || []).forEach(i => { soldMap[i.sku] = (soldMap[i.sku] || 0) + num(i.qty); }));
  const slow = inv.filter(l => inHand(l) > 0)
    .map(l => ({ line: l, units: inHand(l), sold: soldMap[l.sku] || 0, value: lineValue(l) }))
    .sort((a, b) => (a.sold / Math.max(1, a.units)) - (b.sold / Math.max(1, b.units)))
    .slice(0, 12);
  Pagers.render('anaSlow', {
    rows: slow, mount: 'anaSlow', per: 12, pageSize: 12, unit: 'lines',
    emptyTitle: 'No stock lines',
    columns: [
      { key: 'sku', label: 'Model', sortVal: r => r.line.sku, render: r => `<b>${esc(r.line.sku)}</b><span class="row-sub">${esc(r.line.house)}</span>` },
      { key: 'units', label: 'Held', align: 'right', render: r => fmt(r.units) },
      { key: 'sold', label: 'Sold', align: 'right', render: r => `<b class="${r.sold === 0 ? 'c-red' : ''}">${fmt(r.sold)}</b>` },
      { key: 'value', label: 'Tied value', align: 'right', render: r => money(r.value) }
    ]
  });

  /* Warehouse efficiency */
  const mv = DB.get('movements');
  const facOut = {};
  mv.filter(m => movementSign(m.type) < 0).forEach(m => { facOut[m.house] = (facOut[m.house] || 0) + num(m.qty); });
  const facIn = {};
  mv.filter(m => movementSign(m.type) > 0).forEach(m => { facIn[m.house] = (facIn[m.house] || 0) + num(m.qty); });
  const facNames = uniq(inv.map(l => l.house).concat(Object.keys(facOut))).filter(Boolean);
  const eff = facNames.map(f => {
    const inQ = facIn[f] || 0, outQ = facOut[f] || 0;
    return { f, inQ, outQ, rate: inQ + outQ ? Math.round(outQ / (inQ + outQ) * 100) : 0 };
  }).sort((a, b) => b.rate - a.rate);
  $('anaFac').innerHTML = eff.length ? eff.map(e => barRow(e.f, e.rate, 100, e.rate >= 50 ? 'b' : 'r', e.rate + '%')).join('')
    + `<div class="form-hint mt-12">Issue rate = OUT + SALE as a share of all movement in that facility.</div>`
    : '<div class="empty" style="padding:24px"><b>No movement data</b></div>';

  /* Service performance */
  const rep = DB.get('repairs');
  const byDefect = groupBy(rep, r => r.defectType);
  const perf = Object.entries(byDefect).map(([d, list]) => {
    const closed = list.filter(r => r.completedDate);
    const avg = closed.length ? sum(closed, r => daysBetween(r.intakeDate, r.completedDate)) / closed.length : 0;
    return { d, n: list.length, avg, income: sum(list.filter(r => r.paid), r => num(r.cost) + num(r.labourCost)) };
  }).sort((a, b) => b.n - a.n);
  const maxP = Math.max(1, ...perf.map(p => p.n));
  $('anaService').innerHTML = perf.length ? perf.map(p => `
    <div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div class="row" style="justify-content:space-between;font-size:12px;margin-bottom:5px">
        <b>${esc(p.d)}</b><span class="text-3">${p.n} job${p.n === 1 ? '' : 's'}${p.avg ? ` · ${p.avg.toFixed(1)} d avg` : ''}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${p.avg > 5 ? '' : 'g'}" style="width:${Math.round(p.n / maxP * 100)}%"></div></div>
    </div>`).join('') : '<div class="empty" style="padding:24px"><b>No repair history</b></div>';

  /* Customer concentration */
  const byCust = groupBy(sales.filter(s => s.customerName !== 'Walk-in Retail'), s => s.customerName);
  const conc = Object.entries(byCust).map(([n, list]) => ({ n, v: sum(list, s => s.total) })).sort((a, b) => b.v - a.v).slice(0, 8);
  const totalV = sum(conc, c => c.v);
  const maxC = Math.max(1, totalV);
  $('anaCust').innerHTML = conc.length ? conc.map(c => barRow(c.n, c.v, maxC, c.v / totalV > .3 ? 'r' : 'b', money(c.v))).join('')
    + `<div class="form-hint mt-12">${conc.length ? (conc[0].v / totalV * 100).toFixed(0) : 0}% of revenue comes from the largest account.</div>`
    : '<div class="empty" style="padding:24px"><b>No account sales</b></div>';

  /* Workforce */
  const emps = DB.get('employees');
  const byDept = groupBy(emps, e => e.department);
  const deptRows = Object.entries(byDept).map(([d, l]) => ({ d, n: l.length, cost: sum(l, e => num(e.salary)) })).sort((a, b) => b.n - a.n);
  const leaves = DB.get('leaves').filter(l => l.status === 'Approved');
  $('anaHr').innerHTML = `
    <div class="kv mb-16">
      <div class="kv-row"><span class="k">Total headcount</span><span class="v">${emps.length}</span></div>
      <div class="kv-row"><span class="k">Active</span><span class="v c-green">${emps.filter(e => e.status === 'Active').length}</span></div>
      <div class="kv-row"><span class="k">On leave</span><span class="v c-amber">${emps.filter(e => e.status === 'On Leave').length}</span></div>
      <div class="kv-row"><span class="k">Monthly payroll cost</span><span class="v">${money(sum(emps, e => num(e.salary)))}</span></div>
      <div class="kv-row"><span class="k">Leave days granted</span><span class="v">${fmt(sum(leaves, l => l.days))}</span></div>
      <div class="kv-row"><span class="k">Avg salary</span><span class="v">${money(emps.length ? sum(emps, e => num(e.salary)) / emps.length : 0)}</span></div>
    </div>
    <div class="section-title">Headcount by department</div>
    ${deptRows.length ? deptRows.map(d => barRow(d.d, d.n, Math.max(1, ...deptRows.map(x => x.n)), 'b', String(d.n))).join('') : ''}`;
}

/* --------------------------------------------------------------- Reports */
function renderReports() {
  const inv = DB.get('inventory');
  const mv = DB.get('movements');
  const value = inventoryValue();

  $('repStats').innerHTML = [
    statCard({ onClick: 'inv:value', icon: '◫', label: 'Inventory valuation', value: money(value), meta: `${fmt(totalUnits())} units`, color: 'green' }),
    statCard({ onClick: 'inv:units', icon: '▣', label: 'Active stock lines', value: fmt(inv.length), meta: `${DB.get('items').length} catalogue lines`, color: 'blue' }),
    statCard({ onClick: 'movements', icon: '⇄', label: 'Ledger entries', value: fmt(mv.length), meta: 'All movements', color: 'amber' }),
    statCard({ onClick: 'inv:retail', icon: '◫', label: 'Retail value', value: money(sum(inv, l => inHand(l) * num(l.unitPrice))), meta: 'At retail price', color: 'purple' })
  ].join('');

  /* Valuation by facility */
  const byHouse = groupBy(inv, l => l.house || 'Unassigned');
  const houseRows = Object.entries(byHouse).map(([h, l]) => ({ h, units: sum(l, inHand), cost: sum(l, lineValue), retail: sum(l, x => inHand(x) * num(x.unitPrice)) }))
    .sort((a, b) => b.cost - a.cost);
  Pagers.render('repLoc', {
    rows: houseRows, mount: 'repLocation', per: 20, pageSize: 20, unit: 'facilities',
    emptyTitle: 'No stock to value',
    columns: [
      { key: 'h', label: 'Facility', render: r => `<b>${esc(r.h)}</b>` },
      { key: 'units', label: 'Units', align: 'right', render: r => fmt(r.units) },
      { key: 'cost', label: 'At cost', align: 'right', render: r => money(r.cost) },
      { key: 'retail', label: 'At retail', align: 'right', render: r => money(r.retail) },
      { key: 'share', label: 'Share', align: 'right', sortVal: r => value ? r.cost / value * 100 : 0, render: r => `<span class="badge grey">${value ? (r.cost / value * 100).toFixed(1) : 0}%</span>` }
    ]
  });

  /* Category separation */
  const byType = groupBy(inv, l => l.type || 'Regular');
  const typeRows = Object.entries(byType).map(([t, l]) => ({ t, units: sum(l, inHand), value: sum(l, lineValue) })).sort((a, b) => b.units - a.units);
  renderDonut('repType', byType, inHand, t => ({ Regular: 'var(--blue)', LMP: 'var(--purple)', Refurbished: 'var(--amber)', Repair: 'var(--red)' }[t] || 'var(--text-3)'), 'Units by type');
  $('repType').insertAdjacentHTML('beforeend', `<div class="table-scroll mt-16"><table class="dt">
    <thead><tr><th>Category</th><th class="right">Units</th><th class="right">Value</th><th class="right">Lines</th></tr></thead>
    <tbody>${typeRows.map(r => `<tr><td>${typeBadge(r.t)}</td><td class="right num">${fmt(r.units)}</td><td class="right num">${money(r.value)}</td><td class="right num">${(byType[r.t] || []).length}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${fmt(totalUnits())}</td><td class="right">${money(value)}</td><td class="right">${inv.length}</td></tr></tfoot>
  </table></div>`);

  /* Movement summary */
  const types = ['IN', 'OUT', 'SALE', 'RETURN', 'ADJUST', 'TRANSFER IN', 'TRANSFER OUT'];
  const mvSummary = types.map(t => ({ t, n: mv.filter(m => m.type === t).length, q: sum(mv.filter(m => m.type === t), m => m.qty) })).filter(x => x.n);
  const maxMV = Math.max(1, ...mvSummary.map(x => x.q));
  $('repMovement').innerHTML = mvSummary.length ? mvSummary.map(x => `
    <div class="bar-row">
      <span class="nm">${esc(x.t)}</span>
      <div class="bar-track"><div class="bar-fill ${x.t === 'IN' ? 'g' : x.t === 'OUT' || x.t === 'SALE' ? 'r' : 'p'}" style="width:${Math.round(x.q / maxMV * 100)}%"></div></div>
      <span class="bar-val">${fmt(x.q)}<br><span class="fs-11 text-3">${x.n} ent</span></span>
    </div>`).join('') : '<div class="empty" style="padding:24px"><b>No movements</b></div>';

  /* Report pack */
  const packs = [
    { icon: '⇋', label: 'Transfer gate pass', fn: () => Docs.gatePass(DB.get('transfers')[0] ? DB.get('transfers')[0].transferRef : null) },
    { icon: '◈', label: 'Repair job card', fn: () => Docs.jobCard(DB.get('repairs')[0] ? DB.get('repairs')[0].id : null) },
    { icon: '₳', label: 'Payslip', fn: () => Docs.payslip(DB.get('payroll')[0] ? DB.get('payroll')[0].id : null) },
    { icon: '◫', label: 'Tax invoice', fn: () => Docs.invoice(DB.get('sales')[0] ? DB.get('sales')[0].id : null) },
    { icon: '⌂', label: 'Purchase order', fn: () => Docs.purchaseOrder(DB.get('purchases')[0] ? DB.get('purchases')[0].id : null) },
    { icon: '✦', label: 'Delivery challan', fn: () => Docs.deliveryChallan(DB.get('dispatches')[0] ? DB.get('dispatches')[0].id : null) },
    { icon: '▤', label: 'Stock report', fn: () => Docs.stockReport() },
    { icon: '◷', label: 'Audit extract', fn: () => Docs.auditReport() }
  ];
  $('repPack').innerHTML = packs.map((p, i) => `<button class="btn" data-pack="${i}" style="justify-content:flex-start">${p.icon} ${esc(p.label)}</button>`).join('');
  $$('[data-pack]', $('repPack')).forEach(b => b.onclick = () => packs[Number(b.dataset.pack)].fn());

  /* Customer performance */
  const byC = groupBy(DB.get('sales'), s => s.customerName);
  const cRows = Object.entries(byC).map(([n, l]) => ({ n, v: sum(l, s => s.total), n2: l.length })).sort((a, b) => b.v - a.v).slice(0, 10);
  const maxC = Math.max(1, ...cRows.map(r => r.v));
  $('repCustomers').innerHTML = cRows.length ? cRows.map(r => barRow(r.n, r.v, maxC, '', money(r.v))).join('')
    : '<div class="empty" style="padding:24px"><b>No sales</b></div>';

  /* Data quality */
  const checks = [
    { ok: !findDuplicateImeis().length, label: 'IMEI uniqueness', detail: `${findDuplicateImeis().length} collision(s)` },
    { ok: !findDuplicateOrders().length, label: 'Order number uniqueness', detail: `${findDuplicateOrders().length} collision(s)` },
    /* A line below zero is a genuine finding, not a false alarm, so this stays
     * a failing check - but the detail says how many and where, because "N
     * line(s) below zero" leaves the user to go and find them. The card is
     * also wired to the Negative stock drill. */
    { ok: !inv.some(l => inHand(l) < 0), label: 'No negative stock', detail: (() => {
      const neg = inv.filter(l => inHand(l) < 0);
      if (!neg.length) return 'Every line is at or above zero';
      const worst = neg.slice().sort((a, b) => inHand(a) - inHand(b))[0];
      return `${neg.length} below zero, worst ${esc(worst.sku)} at ${fmt(inHand(worst))}`;
    })() },
    { ok: inv.every(l => l.house), label: 'Every line has a facility', detail: `${inv.filter(l => !l.house).length} missing` },
    { ok: inv.every(l => num(l.unitCost) > 0), label: 'Cost price present', detail: `${inv.filter(l => !num(l.unitCost)).length} line(s) at zero cost` },
    { ok: DB.get('sales').every(s => s.invoiceNo), label: 'Every sale has an invoice', detail: `${DB.get('sales').filter(s => !s.invoiceNo).length} missing` },
    { ok: DB.get('invoices').every(i => i.dueDate), label: 'Every invoice has a due date', detail: `${DB.get('invoices').filter(i => !i.dueDate).length} missing` },
    { ok: DB.get('repairs').every(r => r.intakeDate), label: 'Every repair has an intake date', detail: `${DB.get('repairs').filter(r => !r.intakeDate).length} missing` }
  ];
  const fails = checks.filter(c => !c.ok).length;
  $('repQuality').innerHTML = checks.map(c => `
    <div class="list-row">
      <span class="lead" style="background:${c.ok ? 'var(--green-soft)' : 'var(--red-soft)'};color:${c.ok ? 'var(--green)' : 'var(--red)'}">${c.ok ? '✓' : '✕'}</span>
      <span class="body"><b>${esc(c.label)}</b><small>${esc(c.detail)}</small></span>
    </div>`).join('') + `<div class="callout ${fails ? 'warn' : 'ok'} mt-16"><span class="lead">${fails ? '⚠' : '✓'}</span>
      <div class="body"><b>${fails ? `${fails} check(s) need attention` : 'All integrity checks passed'}</b>
      ${fails ? 'Resolve the flagged items before the next stock take.' : 'Your dataset is internally consistent.'}</div></div>`;
}

/* ----------------------------------------------------------------- Audit */
function renderAudit() {
  const all = DB.get('audit');
  const q = norm($('auditSearch')?.value);
  const mod = $('auditModule')?.value || '';
  const act = $('auditAction')?.value || '';
  fillSelect('auditModule', uniq(all.map(a => a.module)).sort(), 'All modules');
  fillSelect('auditAction', uniq(all.map(a => a.action)).sort(), 'All actions');

  let rows = all;
  if (q) rows = rows.filter(a => [a.user, a.action, a.module, a.recordId, a.details, a.role].join(' ').toLowerCase().includes(q));
  if (mod) rows = rows.filter(a => a.module === mod);
  if (act) rows = rows.filter(a => a.action === act);

  $('auditCount').textContent = `${fmt(rows.length)} events`;
  Pagers.render('audit', {
    mount: 'auditTable', foot: 'auditFoot', rows, unit: 'events', dense: true,
    emptyTitle: 'No audit events', emptyText: 'Every create, edit, delete and approval is recorded here.',
    columns: [
      { key: 'timestamp', label: 'Timestamp', render: r => `<span class="fs-12">${esc(fmtDateTime(r.timestamp))}</span><span class="row-sub">${esc(relTime(r.timestamp))}</span>` },
      { key: 'user', label: 'User', render: r => `<div class="row gap-6">${avatarNode(r.user, 24)}<span><b>${esc(r.user)}</b></span></div>` },
      { key: 'role', label: 'Role', render: r => `<span class="badge grey">${esc(r.role || '—')}</span>` },
      { key: 'action', label: 'Action', render: r => {
        const c = actionColor(r.action);
        return `<span class="lead" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:${c.bg};color:${c.fg};font-size:11px">${c.icon}</span> <b>${esc(r.action)}</b>`;
      }},
      { key: 'module', label: 'Module' },
      { key: 'recordId', label: 'Reference', render: r => `<span class="mono fs-12">${esc(r.recordId || '—')}</span>` },
      { key: 'details', label: 'Detail', render: r => `<span class="fs-12 text-2">${esc(r.details || '—')}</span>` }
    ]
  });
}

/* -------------------------------------------------------------- Settings */
function renderSettings() {
  const s = state.db.settings;
  const mode = s.backendMode || 'local';
  $('backendMode').textContent = mode === 'local' ? 'Local (offline)' : (mode === 'appscript' ? 'Google Sheets' : 'REST API');
  $('backendMode').className = 'badge ' + (mode === 'local' ? 'green' : 'blue');

  $('backendPanel').innerHTML = `
    <div class="callout ${mode === 'local' ? 'ok' : 'info'} mb-16">
      <span class="lead">${mode === 'local' ? '✓' : '◈'}</span>
      <div class="body"><b>${mode === 'local' ? 'Running fully offline' : 'External backend connected'}</b>
        ${mode === 'local'
          ? 'All data is stored in this browser. Nothing leaves the device. Connect a backend below to share data across users and devices.'
          : `Changes are written to <span class="mono">${esc(Sync.url || '')}</span> and pulled on an interval. Offline changes are queued and replayed automatically.`}</div>
    </div>
    <div class="field mb-12">
      <label>Backend mode</label>
      ${selectControl('setMode', [['local', 'Local only (no server)'], ['appscript', 'Google Sheets / Apps Script Web App'], ['rest', 'REST API (custom server)']], mode)}
    </div>
    <div class="field mb-12" id="wrapAs">
      <label>Apps Script Web App URL</label>
      <input class="input" id="setAppsUrl" value="${esc(s.appsScriptUrl || '')}" placeholder="https://script.google.com/macros/s/AKfy…/exec">
      <div class="form-hint">Deploy the Apps Script as a Web App, execute as you, and who has access. The app posts <span class="mono">syncAll</span>, <span class="mono">saveMovement</span> and related actions.</div>
    </div>
    <div class="field mb-12" id="wrapRest">
      <label>REST API base URL</label>
      <input class="input" id="setRestUrl" value="${esc(s.restBase || '')}" placeholder="https://erp.example.com/api">
      <div class="form-hint">Endpoints used: <span class="mono">/dashboard</span>, <span class="mono">/items</span>, <span class="mono">/sales</span>, <span class="mono">/payroll</span>, <span class="mono">/leave-requests</span>, <span class="mono">/audit-log</span>.</div>
    </div>
    <label class="check mb-12"><input type="checkbox" id="setAutoSync" ${s.autoSync ? 'checked' : ''}> Automatically pull updates on an interval</label>
    <div class="field mb-12"><label>Sync interval (seconds)</label><input class="input" id="setInterval" type="number" min="10" value="${Math.round(num(s.syncIntervalMs) / 1000)}"></div>
    <div class="row-wrap mt-16">
      <button class="btn primary" id="btnSaveBackend">Save &amp; test connection</button>
      <button class="btn" id="btnPullNow">⟳ Pull now</button>
    </div>
    <div class="form-hint mt-8">${state.queue.length ? `<b>${state.queue.length} change(s)</b> queued locally waiting to sync.` : 'No queued changes.'}</div>`;

  const toggle = () => {
    const m = $('setMode').value;
    $('wrapAs').style.display = m === 'appscript' ? '' : 'none';
    $('wrapRest').style.display = m === 'rest' ? '' : 'none';
  };
  $('setMode').onchange = toggle; toggle();
  $('btnSaveBackend').onclick = saveBackend;
  $('btnPullNow').onclick = async () => { const ok = await Sync.pull(); toast(ok ? 'Pulled latest data from the backend' : 'Pull failed — check the URL and try again', ok ? 'good' : 'bad'); };

  /* Company profile */
  const map = { setCompany: 'company', setAddress: 'address', setPhone: 'phone', setEmail: 'email', setTax: 'taxNo', setCurrency: 'currency', setThreshold: 'threshold', setShift: 'shiftStart', setFooter: 'footerNote' };
  Object.entries(map).forEach(([id, key]) => { const el = $(id); if (el) el.value = s[key] ?? ''; });

  /* Locations */
  const locs = DB.get('locations');
  $('locCount').textContent = `${locs.length} locations`;
  $('locList').innerHTML = locs.length ? locs.map(l => {
    const units = sum(DB.get('inventory').filter(x => x.house === l.name), inHand);
    return `<div class="list-row">
      <span class="lead" style="background:var(--amber-soft);color:var(--amber-strong)">◉</span>
      <span class="body"><b>${esc(l.name)}</b><small>${esc(l.type || 'Warehouse')} · ${esc(l.address || '—')}</small></span>
      <span class="trail"><b>${fmt(units)}</b><br><span class="fs-11 text-3">units</span></span>
      ${isAdmin() ? `<span class="row gap-4" style="flex:none"><button class="btn xs" data-loc-edit="${l.id}">Edit</button><button class="btn xs danger" data-loc-del="${l.id}">✕</button></span>` : ''}
    </div>`;
  }).join('') : '<div class="empty" style="padding:22px"><b>No facilities</b><p>Add a warehouse to route stock.</p></div>';
  $$('[data-loc-edit]', $('locList')).forEach(b => b.onclick = () => Modals.locationForm(DB.byId('locations', b.dataset.locEdit)));
  $$('[data-loc-del]', $('locList')).forEach(b => b.onclick = () => deleteRecord('locations', b.dataset.locDel, 'Facility', 'name'));

  /* Maintenance panel */
  const counts = DB.collections.map(c => [c, DB.get(c).length]).filter(([, n]) => n > 0);
  $('maintPanel').innerHTML = `
    <button class="btn" data-maint="backup">⭳ Backup everything (JSON)</button>
    <button class="btn" data-maint="restore">⭱ Restore from backup</button>
    <button class="btn" data-maint="reset">↺ Reset to demo data</button>
    <button class="btn danger" data-maint="wipe">⚠ Erase all data</button>
    <button class="btn" data-maint="exportcsv">▤ Export all as CSV</button>
    <button class="btn" data-maint="print">🖨 Print data sheet</button>`;
  $$('[data-maint]', $('maintPanel')).forEach(b => b.onclick = () => maintenance(b.dataset.maint));

  const bulkEntities = ['items', 'inventory', 'customers', 'suppliers', 'employees', 'sales', 'purchases', 'repairs', 'transfers', 'invoices'];
  fillSelect('bulkEntity', bulkEntities);
  $('bulkHint').textContent = `Supported: ${counts.length} active collections. Column headers must match the template exactly.`;

  renderBridgePanel();

  /* Preferences */
  const prefs = [
    { key: 'requireReasonOnAdjust', label: 'Require a reason on stock reconciliation', hint: 'Audit-grade accountability' },
    { key: 'printOnSale', label: 'Open the invoice after a POS sale', hint: 'Speeds up counter throughput' },
    { key: 'autoSync', label: 'Auto-sync with the configured backend', hint: 'Pulls on the interval above' }
  ];

  /* Theme picker — the registry lives in 16-experience.js. Each theme only overrides
   * the accent ramp and the surface stack, so switching is instant and never breaks
   * layout. The active theme is stored under the AMAYA key so it survives a reset
   * of the demo data but not a change of super-admin (the setup key is different). */
  const themeOptions = THEMES.map(t => `<option value="${t.id}" ${s.theme === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');

  /* Layout override — 'auto' follows the device, 'phone' forces the mobile stack,
   * 'desktop' forces the two-column layout. The active choice is saved and applied
   * immediately so the user can test both form factors on any screen. */
  const layoutOptions = ['auto', 'phone', 'desktop'].map(l => `<option value="${l}" ${Layout.mode === l ? 'selected' : ''}>${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('');

  $('prefPanel').innerHTML = prefs.map(p => `
    <div class="card pad">
      <label class="check mb-8"><input type="checkbox" data-pref="${p.key}" ${s[p.key] ? 'checked' : ''}> ${esc(p.label)}</label>
      <div class="form-hint">${esc(p.hint)}</div>
    </div>`).join('') + `
    <div class="card pad">
      <label class="field-label">Theme</label>
      <select data-pref="theme" class="input">${themeOptions}</select>
      <div class="form-hint">Accent colour and surface stack. Light, Dark, Midnight, Forest, Plum, Slate, Contrast.</div>
    </div>
    <div class="card pad">
      <label class="field-label">Layout</label>
      <select data-pref="layout" class="input">${layoutOptions}</select>
      <div class="form-hint">Auto = detect from viewport. Phone / Desktop = force a specific stack for testing.</div>
    </div>
    <div class="card pad">
      <div class="form-hint">
        <b>Storage used</b><br>
        ${(JSON.stringify(state.db).length / 1024).toFixed(0)} KB of ~5 MB browser quota.<br><br>
        <b>Collections</b><br>
        ${DB.collections.map(c => `${c}: ${DB.get(c).length}`).join(' · ')}
      </div>
    </div>`;
  $$('[data-pref]').forEach(cb => {
    cb.onchange = () => {
      if (cb.dataset.pref === 'theme') {
        applyTheme(cb.value);
      } else if (cb.dataset.pref === 'layout') {
        Layout.set(cb.value);
      } else {
        state.db.settings[cb.dataset.pref] = cb.checked;
        DB.save(true);
        Sync.startAuto();
      }
    };
  });
}

async function saveBackend() {
  const mode = $('setMode').value;
  state.db.settings.backendMode = mode;
  state.db.settings.appsScriptUrl = $('setAppsUrl').value.trim();
  state.db.settings.restBase = $('setRestUrl').value.trim();
  state.db.settings.autoSync = $('setAutoSync').checked;
  state.db.settings.syncIntervalMs = Math.max(10, num($('setInterval').value)) * 1000;
  DB.save(true);
  Sync.startAuto();
  if (mode === 'local') { Sync.setStatus('idle', 'Local mode'); toast('Switched to local-only mode', 'good'); renderSettings(); renderAll(); return; }
  if (!Sync.url) { toast('Enter the backend URL for the selected mode', 'bad'); return; }
  Sync.setStatus('syncing', 'Testing…');
  const ok = await Sync.pull();
  if (ok) toast('Backend connected and data pulled', 'good');
  else toast('Could not reach the backend — verify the URL and deployment access', 'bad', 6000);
  renderSettings(); renderAll();
}

async function maintenance(action) {
  if (action === 'backup') {
    const payload = { app: APP.name, version: APP.version, exportedAt: nowISO(), data: state.db };
    downloadFile(`amaya-erp-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    audit('BACKUP', 'System', 'local', 'Full dataset exported');
    toast('Backup downloaded', 'good');
  }
  if (action === 'restore') {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const data = parsed.data || parsed;
        if (!data || !data.meta) throw new Error('Unrecognised backup file');
        const ok = await confirmDialog({ title: 'Restore backup?', danger: true, confirmLabel: 'Replace all data', message: `Backup taken ${fmtDateTime(parsed.exportedAt || data.meta.createdAt)}`, detail: 'This replaces the entire current dataset. Export a backup first if unsure.' });
        if (!ok) return;
        state.db = Object.assign(DB.blank(), data);
        DB.save(true);
        audit('RESTORE', 'System', 'local', 'Dataset restored from backup file');
        toast('Backup restored', 'good');
        renderAll();
      } catch (e) { toast(e.message || 'Could not read that file', 'bad'); }
    };
    input.click();
  }
  if (action === 'reset') {
    const ok = await confirmDialog({ title: 'Reset to demo data?', danger: true, confirmLabel: 'Reset everything', message: 'All current data will be replaced with the demo dataset.' });
    if (!ok) return;
    state.db = seedDatabase();
    DB.save(true);
    toast('Demo dataset restored', 'good');
    renderAll();
  }
  if (action === 'wipe') {
    const ok = await confirmDialog({ title: 'Erase everything?', danger: true, confirmLabel: 'Erase all data', message: 'Every record will be permanently deleted from this browser.', detail: 'Locations, users and settings are also reset. This cannot be undone.' });
    if (!ok) return;
    const fresh = DB.blank();
    fresh.settings = defaultSettings();
    fresh.locations = [{ id: 'LOC-001', name: 'Main House', type: 'Central warehouse', address: '', active: true }];
    fresh.users = [{ id: 'USR-001', name: 'Administrator', email: 'admin@amaya.com', password: 'admin', pin: '123456', role: 'Super Admin', location: 'Main House', status: 'Active', joinedAt: todayISO() }];
    state.db = fresh;
    DB.save(true);
    toast('All data erased', 'warn');
    logout();
    showLogin();
  }
  if (action === 'exportcsv') {
    const rows = [['Collection', 'Records']];
    DB.collections.forEach(c => rows.push([c, DB.get(c).length]));
    exportCSV('amaya-erp-collection-summary', rows);
  }
  if (action === 'print') {
    Docs.dataSheet();
  }
}

/* ----------------------------------------------------------------- Admin */
function renderAdmin() {
  if (!isAdmin()) {
    $('page-admin').innerHTML = `<div class="empty" style="padding:60px"><div class="big">♙</div><b>Administrator access required</b><p>Switch to an administrator account to manage staff access and tasks.</p></div>`;
    return;
  }
  $('page-admin').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Restricted workspace</div><h2>Administrator Control</h2>
      <p>Manage staff access, roles, PINs and assign operational work in bulk.</p></div>
    </div>
    <div class="grid g-2">
      <section class="card panel">
        <div class="panel-head"><div class="panel-title"><span class="gi">◉</span>User management<small id="adminUserCount">${DB.get('users').length} accounts</small></div>
        <button class="btn sm primary" id="btnAdminNewUser">＋ New user</button></div>
        <div class="table-scroll" id="adminUsers"></div>
      </section>
      <section class="card panel">
        <div class="panel-head"><div class="panel-title"><span class="gi">☑</span>Task assignment<small>Assign operational work in bulk</small></div></div>
        <div class="form-grid">
          <div class="field"><label>Assignee</label><select class="select" id="taskAssignee"></select></div>
          <div class="field"><label>Due date</label><input class="input" id="taskDue" type="date"></div>
          <div class="field span-2"><label>Tasks (one per line)</label><textarea class="input" id="taskLines" placeholder="Count Main House retail stock&#10;Verify in-transfer IMEIs&#10;Prepare repair intake for HONOR batch"></textarea></div>
        </div>
        <div class="row mt-12"><button class="btn primary" id="btnAddTasks">Assign tasks</button></div>
        <div class="mt-16" id="adminTasks"></div>
      </section>
    </div>
    <section class="card panel">
      <div class="panel-head"><div class="panel-title"><span class="gi">◑</span>Access control matrix<small>What each role may see and change</small></div></div>
      <div class="table-scroll" id="roleMatrix"></div>
    </section>`;

  const users = DB.get('users');
  Pagers.render('adminUsers', {
    rows: users, mount: 'adminUsers', per: 25, pageSize: 25, unit: 'users', dense: true,
    emptyTitle: 'No user accounts',
    columns: [
      { key: 'name', label: 'User', render: r => `<div class="row gap-6">${avatarNode(r.name, 26)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.email)}</span></span></div>` },
      { key: 'role', label: 'Role', render: r => `<span class="badge ${r.role === 'Super Admin' || r.role === 'Admin' ? 'amber' : 'blue'}">${esc(r.role)}</span>` },
      { key: 'location', label: 'Facility' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-user-edit="${r.id}">Edit</button>
          <button class="btn xs" data-user-act="${r.id}">${r.status === 'Active' ? 'Disable' : 'Enable'}</button>
          ${r.email !== 'admin@amaya.com' ? `<button class="btn xs danger" data-user-del="${r.id}">✕</button>` : ''}
        </div>` }
    ]
  });
  bindTableButtons('adminUsers', {
    'user-edit': id => Modals.userForm(DB.byId('users', id)),
    'user-del': id => deleteRecord('users', id, 'User account', 'email'),
    'user-act': id => {
      const u = DB.byId('users', id);
      DB.update('users', id, { status: u.status === 'Active' ? 'Disabled' : 'Active' });
      audit('UPDATE', 'Admin', u.email, `Account ${u.status === 'Active' ? 'disabled' : 'enabled'}`);
      toast(`${u.name} ${u.status === 'Active' ? 'disabled' : 'enabled'}`, 'warn');
      renderAdmin();
    }
  });

  $('btnAdminNewUser').onclick = () => Modals.userForm();

  /* Tasks */
  $('taskAssignee').innerHTML = users.map(u => `<option value="${esc(u.email)}">${esc(u.name)} — ${esc(u.role)}</option>`).join('');
  const tasks = DB.get('tasks');
  $('adminTasks').innerHTML = tasks.length ? tasks.slice(0, 12).map(t => `
    <div class="list-row">
      <span class="lead" style="background:${t.status === 'Done' ? 'var(--green-soft)' : 'var(--amber-soft)'};color:${t.status === 'Done' ? 'var(--green)' : 'var(--amber-strong)'}">${t.status === 'Done' ? '✓' : '•'}</span>
      <span class="body"><b>${esc(t.title)}</b><small>${esc(t.assigneeName || t.assigneeEmail)}${t.due ? ' · due ' + esc(fmtDate(t.due)) : ''}</small></span>
      ${t.status !== 'Done' ? `<button class="btn xs success" data-task-done="${t.id}">Done</button>` : `<span class="badge green">Done</span>`}
    </div>`).join('') : '<div class="empty" style="padding:22px"><b>No tasks assigned</b></div>';
  $$('[data-task-done]', $('adminTasks')).forEach(b => b.onclick = () => {
    DB.update('tasks', b.dataset.taskDone, { status: 'Done', doneAt: nowISO(), doneBy: state.session.user.name });
    audit('UPDATE', 'Admin', b.dataset.taskDone, 'Task marked done');
    toast('Task completed', 'good');
    renderAdmin();
  });
  $('btnAddTasks').onclick = () => {
    const email = $('taskAssignee').value;
    const due = $('taskDue').value;
    const lines = $('taskLines').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast('Add at least one task line', 'bad');
    const u = DB.get('users').find(x => x.email === email);
    lines.forEach(title => DB.insert('tasks', { title, assigneeEmail: email, assigneeName: u ? u.name : email, status: 'Open', due, createdAt: nowISO() }));
    $('taskLines').value = '';
    audit('CREATE', 'Admin', 'tasks', `${lines.length} task(s) assigned to ${u ? u.name : email}`);
    toast(`${lines.length} task(s) assigned`, 'good');
    renderAdmin();
  };

  /* Role matrix */
  const pageMatrix = NAV.flatMap(g => g.items);
  Pagers.render('roleMatrix', {
    rows: ROLES, mount: 'roleMatrix', per: 20, pageSize: 20, unit: 'roles', dense: true,
    columns: [
      { key: 'role', label: 'Role', render: r => `<b>${esc(r)}</b>` },
      { key: 'pages', label: 'Modules visible', sortable: false, render: r => {
        const p = ROLE_PERMS[r];
        if (p.pages === '*') return '<span class="badge green">Everything</span>';
        return `<span class="fs-12 text-2">${p.pages.length} module${p.pages.length === 1 ? '' : 's'}</span>`;
      }},
      { key: 'write', label: 'Can change', sortable: false, render: r => {
        const p = ROLE_PERMS[r];
        if (p.write === '*') return '<span class="badge green">Everything</span>';
        return p.write.length ? p.write.map(w => `<span class="badge blue" style="margin:1px">${esc(w)}</span>`).join('') : '<span class="badge grey">Read only</span>';
      }},
      { key: 'users', label: 'Users', align: 'right', sortVal: r => DB.get('users').filter(u => u.role === r).length, render: r => fmt(DB.get('users').filter(u => u.role === r).length) }
    ]
  });
}

/* ----------------------------------------------------- Shared record ops */
/**
 * @param {string} col      collection name
 * @param {string} id       record id
 * @param {string} label    human label, e.g. "repair ticket"
 * @param {string} [nameKey] field holding the display name
 * @param {boolean} [skipConfirm] caller already confirmed
 * @returns {boolean} whether the record was actually removed
 */
async function deleteRecord(col, id, label, nameKey, skipConfirm) {
  /* Bulk callers (and the bulk action bar) may omit the label or the name
   * field. Both used to be dereferenced unguarded, which threw and left the
   * record in place. */
  const nice = label || col.replace(/s$/, '');
  const key = nameKey || (col === 'inventory' ? 'sku' : (col === 'items' ? 'model' : 'name'));
  const rec = DB.byId(col, id);
  if (!rec) return false;
  if (!requireWrite(col, `delete ${nice.toLowerCase()}s`)) return false;
  const display = rec[key] || id;
  const ok = skipConfirm ? true : await confirmDialog({
    title: `Delete ${nice.toLowerCase()}?`, danger: true, confirmLabel: 'Delete',
    message: display,
    detail: 'This is recorded in the audit log. Related stock movements are not reversed.'
  });
  if (!ok) return false;
  DB.remove(col, id);
  audit('DELETE', nice, display, `${nice} deleted`);
  toast(`${nice} deleted`, 'warn');
  renderAll();
  return true;
}

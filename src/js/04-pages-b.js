/* ==========================================================================
   AMAYA ERP — Pages B: Purchases, Sales, POS, Dispatch, Repairs
   ========================================================================== */

/* ------------------------------------------------------------- Purchases */
function renderPurchases() {
  const all = DB.get('purchases');
  const q = norm($('poSearch')?.value);
  const st = $('poStatus')?.value || '';
  fillSelect('poStatus', ['Pending', 'In Transit', 'Received', 'Partially Received', 'Cancelled'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(p => [p.poNumber, p.supplier, p.item, p.brand, p.notes].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(p => p.status === st);

  $('poCount').textContent = `${fmt(rows.length)} purchase orders`;
  const receivedValue = sum(all.filter(p => p.status === 'Received'), p => p.total);
  const openValue = sum(all.filter(p => ['Pending', 'In Transit', 'Partially Received'].includes(p.status)), p => p.total);
  const latePO = all.filter(p => ['Pending', 'In Transit'].includes(p.status) && p.eta < todayISO()).length;

  $('poStats').innerHTML = [
    statCard({ onClick: 'po:open', icon: '⌂', label: 'Open POs', value: fmt(all.filter(p => ['Pending','In Transit','Partially Received'].includes(p.status)).length), meta: 'Awaiting delivery', color: 'amber' }),
    statCard({ onClick: 'po:committed', icon: '◍', label: 'Committed value', value: money(openValue), meta: 'Not yet received', color: 'blue' }),
    statCard({ onClick: 'po:received', icon: '◫', label: 'Received value', value: money(receivedValue), meta: 'Stock already in', color: 'green' }),
    statCard({ onClick: 'po:late', icon: '⚠', label: 'Past ETA', value: fmt(latePO), meta: 'Overdue deliveries', color: latePO ? 'red' : 'green' })
  ].join('');

  Pagers.render('po', {
    mount: 'poTable', foot: 'poFoot', rows, unit: 'orders',
    selectable: true,
    bulkActions: [
      Sel.act.status('purchases', 'status', [
        { label: 'Ordered', value: 'Ordered' },
        { label: 'In transit', value: 'In Transit' },
        { label: 'Received', value: 'Received' },
        { label: 'Cancelled', value: 'Cancelled' }
      ], 'status'),
      /* Receiving stock is a per-order operation with real stock and invoice
       * side effects, so it is deliberately not offered as a bulk action. */
      Sel.act.exportRows('purchases', 'purchase-orders', selRows => [
        ['PO', 'Date', 'Supplier', 'Item', 'Type', 'House', 'Qty', 'Received', 'Unit cost', 'Total', 'ETA', 'Status'],
        ...selRows.map(p => [p.poNumber, p.date, p.supplier, p.item, p.type, p.house,
          num(p.qty), num(p.receivedQty), num(p.cost), num(p.total), p.eta, p.status])
      ])
    ],
    emptyTitle: 'No purchase orders', emptyText: 'Raise a PO to bring stock in from a supplier.',
    columns: [
      { key: 'poNumber', label: 'PO number', render: r => `<b class="mono">${esc(r.poNumber)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'supplier', label: 'Supplier', render: r => `<b>${esc(r.supplier)}</b>` },
      { key: 'item', label: 'Item', render: r => `<span>${esc(r.item)}</span><span class="row-sub">${esc(r.type || '')} · ${esc(r.house || '')}</span>` },
      { key: 'qty', label: 'Qty', align: 'right', render: r => `<b>${fmt(r.qty)}</b><span class="row-sub">${fmt(r.receivedQty)} received</span>` },
      { key: 'cost', label: 'Unit cost', align: 'right', render: r => money(r.cost) },
      { key: 'total', label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>` },
      { key: 'eta', label: 'ETA', align: 'center', sortVal: r => r.eta, render: r => {
        const late = ['Pending','In Transit'].includes(r.status) && r.eta < todayISO();
        return `<span class="badge ${late ? 'red' : 'grey'}">${esc(fmtDate(r.eta))}</span>`;
      }},
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-po-view="${r.id}">View</button>
          ${canWrite('purchases') && r.status !== 'Received' && r.status !== 'Cancelled' ? `<button class="btn xs success" data-po-receive="${r.id}">Receive</button>` : ''}
          <button class="btn xs" data-po-print="${r.id}">🖨</button>
        </div>` }
    ],
    footRow: (c) => c.key === 'poNumber' ? 'Totals' : '',
    footRowCells: ['Totals', '', '', fmt(sum(rows, r => r.qty)), '', money(sum(rows, r => r.total)), '', '', ''],
    onRow: r => openPODrawer(r.id)
  });
  bindTableButtons('poTable', {
    'po-receive': id => receivePurchase(id),
    'po-print': id => Docs.purchaseOrder(id),
    'po-view': id => openPODrawer(id)
  });
}

function openPODrawer(id) {
  const p = DB.byId('purchases', id);
  if (!p) return;
  const line = DB.get('inventory').find(l => norm(l.sku) === norm(p.item) && norm(l.house) === norm(p.house));
  const paid = DB.get('invoices').find(i => i.refId === p.id);
  openModal({
    drawer: true, autofocus: false, title: p.poNumber,
    sub: `${p.supplier} · ${fmtDate(p.date)}`,
    body: `
      <div class="row-wrap mb-16 gap-6">${statusBadge(p.status)}<span class="badge grey">${esc(p.type || 'Regular')}</span>${p.eta < todayISO() && !['Received','Cancelled'].includes(p.status) ? '<span class="badge red">Past ETA</span>' : ''}</div>
      <div class="section-title">Order lines</div>
      <div class="table-scroll mb-16"><table class="dt">
        <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Received</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
        <tbody><tr><td><b>${esc(p.item)}</b><span class="row-sub">${esc(p.brand || '')}</span></td>
          <td class="right num">${fmt(p.qty)}</td><td class="right num">${fmt(p.receivedQty)}</td>
          <td class="right num">${money(p.cost)}</td><td class="right num"><b>${money(p.total)}</b></td></tr></tbody>
        <tfoot><tr><td colspan="4" class="right">Order total</td><td class="right">${money(p.total)}</td></tr></tfoot>
      </table></div>
      <div class="section-title">Details</div>
      <div class="kv">
        <div class="kv-row"><span class="k">Supplier</span><span class="v"><a href="#" data-goto-sup="${p.supplierId}" style="color:var(--amber);font-weight:700">${esc(p.supplier)}</a></span></div>
        <div class="kv-row"><span class="k">Destination</span><span class="v">${esc(p.house || 'Not set')}</span></div>
        <div class="kv-row"><span class="k">Raised on</span><span class="v">${esc(fmtDate(p.date))}</span></div>
        <div class="kv-row"><span class="k">Expected</span><span class="v">${esc(fmtDate(p.eta))}</span></div>
        <div class="kv-row"><span class="k">Approved by</span><span class="v">${esc(p.approvedBy || '—')}</span></div>
        <div class="kv-row"><span class="k">Bill</span><span class="v">${paid ? esc(paid.invoiceNo) + ' · ' + money(paid.amount) : '<span class="text-3">Not raised</span>'}</span></div>
        ${p.notes ? `<div class="kv-row"><span class="k">Notes</span><span class="v" style="font-weight:600">${esc(p.notes)}</span></div>` : ''}
      </div>
      ${line ? `<div class="section-title mt-16">Destination stock</div>
      <div class="kv"><div class="kv-row"><span class="k">Current available</span><span class="v">${fmt(inHand(line))}</span></div>
      <div class="kv-row"><span class="k">After full receipt</span><span class="v c-green">${fmt(inHand(line) + num(p.qty) - num(p.receivedQty))}</span></div></div>` : ''}`,
    foot: `${canWrite('purchases') && p.status !== 'Received' && p.status !== 'Cancelled' ? `<button class="btn left success" data-rec>✓ Receive stock</button>` : ''}
           <button class="btn" data-x>Close</button>
           <button class="btn primary" data-print>🖨 Purchase order</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      qs('[data-print]', el).onclick = () => Docs.purchaseOrder(p.id);
      const rec = qs('[data-rec]', el);
      if (rec) rec.onclick = () => { closeModal(el); receivePurchase(p.id); };
      const link = qs('[data-goto-sup]', el);
      if (link) link.onclick = ev => { ev.preventDefault(); closeModal(el); go('suppliers'); $('suppSearch').value = p.supplier; renderSuppliers(); };
    }
  });
}

function receivePurchase(id, silentQty) {
  const p = DB.byId('purchases', id);
  if (!p) return;
  const outstanding = num(p.qty) - num(p.receivedQty);
  const qty = silentQty != null ? silentQty : outstanding;
  if (qty <= 0) { toast('Nothing outstanding to receive', 'warn'); return; }
  const line = resolveLine({ sku: p.item, brand: p.brand, type: p.type, house: p.house || 'Main House', color: 'Standard' });
  bumpLine(line, 'inQty', qty);
  const received = num(p.receivedQty) + qty;
  DB.update('purchases', p.id, { receivedQty: received, status: received >= num(p.qty) ? 'Received' : 'Partially Received', lastReceived: todayISO() });
  DB.insert('movements', {
    trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
    type: 'IN', sku: p.item, brand: p.brand, itemType: p.type,
    house: p.house || 'Main House', color: line.color, qty, date: todayISO(),
    note: `Goods received against ${p.poNumber}`, source: p.supplier,
    user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(), imeis: []
  });
  audit('RECEIVE', 'Purchases', p.poNumber, `${fmt(qty)} × ${p.item} received from ${p.supplier}`);
  toast(`${fmt(qty)} units received into ${p.house || 'Main House'}`, 'good');
  renderAll();
}

/* ----------------------------------------------------------------- Sales */
function renderSales() {
  const all = DB.get('sales');
  const q = norm($('saleSearch')?.value);
  const st = $('saleStatus')?.value || '';
  const pay = $('salePay')?.value || '';
  fillSelect('saleStatus', ['Paid', 'Pending', 'Processing', 'Shipped', 'Cancelled', 'Refunded'], 'All statuses');
  fillSelect('salePay', ['Cash', 'Bank', 'Cheque', 'Card'], 'All payment modes');

  let rows = all;
  if (q) rows = rows.filter(s => [s.orderId, s.invoiceNo, s.customerName, s.customerPhone, s.user].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(s => s.status === st);
  if (pay) rows = rows.filter(s => s.paymentMethod === pay);

  $('saleCount').textContent = `${fmt(rows.length)} orders`;
  const thisMonth = DB.get('sales').filter(s => monthKey(s.date) === monthKey(new Date()));
  const paid = all.filter(s => s.status === 'Paid');
  const outstanding = all.filter(s => s.status !== 'Paid' && s.status !== 'Cancelled');

  $('saleStats').innerHTML = [
    statCard({ onClick: 'sale:thisMonth', icon: '◌', label: 'Orders this month', value: fmt(thisMonth.length), meta: monthLabel(monthKey(new Date())), color: 'blue' }),
    statCard({ onClick: 'dash:revenue', icon: '◫', label: 'Revenue this month', value: money(sum(thisMonth, s => s.total)), meta: `Avg ${money(thisMonth.length ? sum(thisMonth, s => s.total) / thisMonth.length : 0)}`, color: 'green' }),
    statCard({ onClick: 'sale:paid', icon: '◍', label: 'Collected', value: money(sum(paid, s => s.total)), meta: `${paid.length} paid orders`, color: 'teal' }),
    statCard({ onClick: 'sale:outstanding', icon: '⚠', label: 'Outstanding', value: money(sum(outstanding, s => s.total)), meta: `${outstanding.length} unpaid orders`, color: outstanding.length ? 'red' : 'green' })
  ].join('');

  Pagers.render('sales', {
    mount: 'saleTable', foot: 'saleFoot', rows, unit: 'orders', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('sales', 'status', [
        { label: 'Processing', value: 'Processing' },
        { label: 'Shipped', value: 'Shipped' },
        { label: 'Paid', value: 'Paid' },
        { label: 'Cancelled', value: 'Cancelled' }
      ], 'status'),
      Sel.act.exportRows('sales', 'sales-orders', selRows => [
        ['Order', 'Invoice', 'Date', 'Customer', 'Phone', 'Items', 'Total', 'Payment', 'Status'],
        ...selRows.map(s => [s.orderId, s.invoiceNo, s.date, s.customerName, s.customerPhone,
          (s.items || []).length, num(s.total), s.paymentMethod, s.status])
      ])
    ],
    emptyTitle: 'No sales orders', emptyText: 'Create a sale from the Sales page or ring one up at the POS.',
    columns: [
      { key: 'orderId', label: 'Order', render: r => `<b class="mono">${esc(r.orderId)}</b><span class="row-sub mono">${esc(r.invoiceNo)}</span>` },
      { key: 'date', label: 'Date', render: r => esc(fmtDate(r.date)) },
      { key: 'customerName', label: 'Customer', render: r => `<b>${esc(r.customerName)}</b><span class="row-sub">${esc(r.customerPhone || '—')}</span>` },
      { key: 'items', label: 'Items', sortable: false, render: r => `<span class="fs-12">${esc((r.items || []).map(i => `${i.sku} ×${i.qty}`).join(', '))}</span><span class="row-sub">${(r.items || []).length} line(s)</span>` },
      { key: 'warehouse', label: 'From' },
      { key: 'paymentMethod', label: 'Payment', render: r => `<span class="badge ${r.paymentMethod === 'Cash' ? 'green' : r.paymentMethod === 'Card' ? 'purple' : 'blue'}">${esc(r.paymentMethod)}</span>` },
      { key: 'total', label: 'Total', align: 'right', render: r => `<b>${money(r.total)}</b>${num(r.discount) ? `<span class="row-sub c-red">−${money(r.discount)} discount</span>` : ''}` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'user', label: 'By', render: r => `<span class="fs-12">${esc(r.user || '—')}</span>` },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-sale-view="${r.id}">View</button>
          <button class="btn xs" data-sale-print="${r.id}">🖨</button>
          ${canWrite('sales') && r.status !== 'Paid' ? `<button class="btn xs success" data-sale-pay="${r.id}">Mark paid</button>` : ''}
        </div>` }
    ],
    footRow: (c) => c.key === 'orderId' ? 'Totals' : '',
    footRowCells: ['Totals', '', '', '', '', '', money(sum(rows, r => r.total)), '', ''],
    onRow: r => openSaleDrawer(r.id)
  });
  bindTableButtons('saleTable', {
    'sale-print': id => Docs.invoice(id),
    'sale-view': id => openSaleDrawer(id),
    'sale-pay': id => markSalePaid(id)
  });
}
async function markSalePaid(id) {
  const s = DB.byId('sales', id);
  if (!s) return;
  DB.update('sales', id, { status: 'Paid', paid: true, paidDate: todayISO() });
  const inv = DB.get('invoices').find(i => i.refId === id);
  if (inv) DB.update('invoices', inv.id, { status: 'Paid', paid: inv.amount, paidDate: todayISO() });
  const cust = DB.byId('customers', s.customerId);
  if (cust && num(cust.balance) >= s.total) DB.update('customers', cust.id, { balance: num(cust.balance) - s.total });
  audit('PAYMENT', 'Sales', s.orderId, `Payment received ${money(s.total)}`);
  toast('Payment recorded', 'good');
  renderAll();
}

function openSaleDrawer(id) {
  const s = DB.byId('sales', id);
  if (!s) return;
  const dsp = DB.get('dispatches').filter(d => d.saleId === s.id);
  const cost = sum(s.items || [], i => num(i.cost) * num(i.qty));
  openModal({
    drawer: true, autofocus: false, title: s.orderId,
    sub: `${s.customerName} · ${fmtDate(s.date)}`,
    body: `
      <div class="row-wrap mb-16 gap-6">${statusBadge(s.status)}
        <span class="badge grey">${esc(s.paymentMethod)}</span>
        <span class="badge blue">${esc(s.invoiceNo)}</span>
        <span class="badge ${cost > 0 && s.total > cost ? 'green' : 'red'}">Margin ${money(s.total - cost)}</span></div>
      <div class="section-title">Line items</div>
      <div class="table-scroll mb-16"><table class="dt">
        <thead><tr><th>Item</th><th>Colour</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>${(s.items || []).map(i => `<tr><td><b>${esc(i.sku)}</b></td><td>${esc(i.color || '—')}</td>
          <td class="right num">${fmt(i.qty)}</td><td class="right num">${money(i.price)}</td><td class="right num">${money(num(i.qty) * num(i.price))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4" class="right">Subtotal</td><td class="right">${money(s.subtotal)}</td></tr>
        ${num(s.discount) ? `<tr><td colspan="4" class="right">Discount</td><td class="right c-red">−${money(s.discount)}</td></tr>` : ''}
        <tr><td colspan="4" class="right"><b>Total</b></td><td class="right"><b>${money(s.total)}</b></td></tr></tfoot>
      </table></div>
      <div class="section-title">Details</div>
      <div class="kv">
        <div class="kv-row"><span class="k">Customer</span><span class="v">${esc(s.customerName)}</span></div>
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(s.customerPhone || '—')}</span></div>
        <div class="kv-row"><span class="k">Dispatched from</span><span class="v">${esc(s.warehouse || '—')}</span></div>
        <div class="kv-row"><span class="k">Invoice</span><span class="v mono">${esc(s.invoiceNo)}</span></div>
        <div class="kv-row"><span class="k">Sold by</span><span class="v">${esc(s.user || '—')}</span></div>
        <div class="kv-row"><span class="k">Gross margin</span><span class="v ${s.total - cost >= 0 ? 'c-green' : 'c-red'}">${money(s.total - cost)} (${s.total ? ((s.total - cost) / s.total * 100).toFixed(1) : '0.0'}%)</span></div>
        ${s.note ? `<div class="kv-row"><span class="k">Note</span><span class="v" style="font-weight:600">${esc(s.note)}</span></div>` : ''}
      </div>
      ${dsp.length ? `<div class="section-title mt-16">Dispatches</div>${dsp.map(d => `<div class="list-row">
        <span class="lead" style="background:var(--blue-soft);color:var(--blue)">✦</span>
        <span class="body"><b>${esc(d.dispatchId)}</b><small>${esc(d.courier)} · ${esc(d.route || '—')}</small></span>
        <span class="trail">${statusBadge(d.status)}</span></div>`).join('')}` : ''}`,
    foot: `${canWrite('sales') && s.status !== 'Paid' ? `<button class="btn left success" data-pay>✓ Mark paid</button>` : ''}
           <button class="btn" data-x>Close</button>
           <button class="btn primary" data-print>🖨 Invoice</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      qs('[data-print]', el).onclick = () => Docs.invoice(s.id);
      const pb = qs('[data-pay]', el);
      if (pb) pb.onclick = () => { closeModal(el); markSalePaid(s.id); };
    }
  });
}

/* ------------------------------------------------------------------- POS */
function renderPOS() {
  fillSelect('posBrand', brandOptions(), 'All brands');
  fillSelect('posHouse', DB.get('locations').map(l => l.name), 'All facilities');
  const q = norm($('posSearch')?.value);
  const brand = $('posBrand')?.value || '';
  const house = $('posHouse')?.value || '';

  let stock = DB.get('inventory').filter(l => l.type !== 'Repair' && inHand(l) > 0);
  if (q) stock = stock.filter(l => [l.sku, l.brand, l.color].join(' ').toLowerCase().includes(q));
  if (brand) stock = stock.filter(l => l.brand === brand);
  if (house) stock = stock.filter(l => l.house === house);

  const grid = $('posGrid');
  if (!stock.length) {
    grid.innerHTML = `<div class="span-all">${emptyState('No sellable stock', 'Every matching line is either out of stock or flagged as a repair unit.', 'Go to inventory', 'inventory')}</div>`;
  } else {
    grid.innerHTML = stock.map(l => {
      const n = inHand(l);
      return `<button class="card pad" data-pos-add="${l.id}" style="text-align:left;padding:12px;transition:all .15s">
        <div style="height:64px;border-radius:9px;background:linear-gradient(135deg,var(--nav),var(--nav-2));display:grid;place-items:center;color:var(--amber-2);font-size:24px;font-weight:900;margin-bottom:9px">${esc((l.brand || '?').slice(0, 1))}</div>
        <b style="font-size:11.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.sku)}</b>
        <div class="fs-11 text-3" style="margin:2px 0 7px">${esc(l.color)} · ${esc(l.house)}</div>
        <div class="row" style="justify-content:space-between">
          <span style="font-weight:900;font-size:12.5px">${money(num(l.unitPrice) || 25000)}</span>
          <span class="badge ${n <= 5 ? 'red' : n <= 10 ? 'amber' : 'green'}">${fmt(n)} left</span>
        </div>
      </button>`;
    }).join('');
    $$('[data-pos-add]', grid).forEach(b => b.onclick = () => addToCart(b.dataset.posAdd));
  }
  const ea = grid.querySelector('[data-empty]');
  if (ea) ea.onclick = () => go(ea.dataset.empty);

  renderCart();
}

function addToCart(lineId) {
  const line = DB.byId('inventory', lineId);
  if (!line) return;
  const available = inHand(line);
  const found = state.cart.find(c => c.lineId === lineId);
  if (found) {
    if (found.qty >= available) { toast(`Only ${available} units available in ${line.house}`, 'bad'); return; }
    found.qty++;
  } else {
    state.cart.push({
      lineId, sku: line.sku, color: line.color, house: line.house,
      price: num(line.unitPrice) || 25000, cost: num(line.unitCost), qty: 1
    });
  }
  renderCart();
}
function renderCart() {
  const host = $('posCart');
  if (!host) return;
  const cart = state.cart;
  const units = sum(cart, c => c.qty);
  const subtotal = sum(cart, c => c.qty * c.price);

  host.innerHTML = `
    <div class="panel-head">
      <div class="panel-title"><span class="gi">▤</span>Invoice cart<small>${units} unit${units === 1 ? '' : 's'} · ${cart.length} line${cart.length === 1 ? '' : 's'}</small></div>
      ${cart.length ? '<button class="btn sm ghost" data-cart-clear>Clear</button>' : ''}
    </div>
    <div class="scroll-y" style="max-height:330px;min-height:120px" id="cartItems">
      ${cart.length ? cart.map((c, i) => {
        const line = DB.byId('inventory', c.lineId);
        const max = line ? inHand(line) : c.qty;
        return `<div class="list-row">
          <span class="body"><b>${esc(c.sku)}</b><small>${esc(c.color)} · ${esc(c.house)} · ${money(c.price)}</small></span>
          <span class="row gap-4" style="flex:none">
            <button class="btn xs" data-cart-dec="${i}">−</button>
            <b style="min-width:22px;text-align:center">${c.qty}</b>
            <button class="btn xs" data-cart-inc="${i}" ${c.qty >= max ? 'disabled' : ''}>＋</button>
          </span>
          <span class="trail"><b>${money(c.qty * c.price)}</b></span>
        </div>`;
      }).join('') : `<div class="empty" style="padding:34px 12px"><div class="big">▤</div><b>Cart is empty</b><p>Tap a product tile to add it to the invoice.</p></div>`}
    </div>
    <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:12px">
      <div class="form-grid" style="gap:10px">
        <div class="field span-2"><label>Customer</label>
          <input class="input" id="posCustomer" list="posCustomerList" value="Walk-in Retail" placeholder="Customer name">
          <datalist id="posCustomerList">${DB.get('customers').map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
        </div>
        <div class="field"><label>Phone</label><input class="input" id="posPhone" placeholder="01XXXXXXXXX"></div>
        <div class="field"><label>Payment</label>
          ${selectControl('posPayment', ['Cash', 'Card', 'Bank', 'Cheque'], 'Cash')}</div>
        <div class="field"><label>Discount</label><input class="input" id="posDiscount" type="number" min="0" value="0"></div>
        <div class="field"><label>Facility</label>${selectControl('posHousePick', housesOptions(), 'Main House')}</div>
      </div>
      <div class="mt-12">
        <div class="sub-total"><span class="text-2">Subtotal</span><b>${money(subtotal)}</b></div>
        <div class="sub-total"><span class="text-2">Units</span><b>${fmt(units)}</b></div>
        <div class="sub-total grand"><span>Net total</span><b>${money(subtotal)}</b></div>
      </div>
      <button class="btn primary block lg mt-12" data-checkout ${cart.length ? '' : 'disabled'}>Complete sale &amp; print</button>
    </div>`;

  const clr = qs('[data-cart-clear]', host);
  if (clr) clr.onclick = () => { state.cart = []; renderCart(); };
  $$('[data-cart-inc]', host).forEach(b => b.onclick = () => {
    const c = state.cart[Number(b.dataset.cartInc)];
    const line = DB.byId('inventory', c.lineId);
    if (line && c.qty >= inHand(line)) { toast('No more stock available', 'bad'); return; }
    c.qty++; renderCart();
  });
  $$('[data-cart-dec]', host).forEach(b => b.onclick = () => {
    const i = Number(b.dataset.cartDec);
    state.cart[i].qty--;
    if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
    renderCart();
  });
  const co = qs('[data-checkout]', host);
  if (co) co.onclick = checkoutPOS;
}

function checkoutPOS() {
  if (!state.cart.length) return;
  if (!requireWrite('pos', 'complete sales')) return;
  const customerName = $('posCustomer').value.trim() || 'Walk-in Retail';
  const phone = $('posPhone').value.trim();
  const payment = $('posPayment').value;
  const discount = num($('posDiscount').value);
  const warehouse = $('posHousePick').value;
  const items = state.cart.map(c => ({ lineId: c.lineId, sku: c.sku, color: c.color, house: c.house, qty: c.qty, price: c.price, cost: c.cost }));
  const subtotal = sum(items, i => i.qty * i.price);
  const total = Math.max(0, subtotal - discount);

  /* Validate availability at commit time */
  for (const it of items) {
    const line = DB.byId('inventory', it.lineId);
    if (!line || inHand(line) < it.qty) { toast(`${it.sku} no longer has ${it.qty} units available`, 'bad'); return; }
  }

  const sale = commitSale({ customerName, customerPhone: phone, items, subtotal, discount, total, paymentMethod: payment, warehouse, paid: true, status: 'Paid', source: 'POS' });
  state.cart = [];
  renderCart();
  if (state.db.settings.printOnSale) Docs.invoice(sale.id);
  else toast(`Sale ${sale.orderId} completed`, 'good');
}

/* Central sale commit used by both POS and the Sales form. */
function commitSale({ customerId, customerName, customerPhone, items, subtotal, discount = 0, total, paymentMethod, warehouse, paid, status, note = '', source = 'Manual' }) {
  let cust = customerId ? DB.byId('customers', customerId) : DB.get('customers').find(c => norm(c.name) === norm(customerName));
  if (!cust) {
    cust = DB.insert('customers', { name: customerName, phone: customerPhone || '', email: '', city: '', address: '', creditLimit: 0, balance: 0, status: 'Active' });
  }
  const orderId = nextNumber('SO', DB.get('sales'), 'orderId');
  const invoiceNo = nextNumber('INV', DB.get('sales'), 'invoiceNo');
  const sale = DB.insert('sales', {
    orderId, invoiceNo, date: todayISO(),
    customerId: cust.id, customerName: cust.name, customerPhone: customerPhone || cust.phone || '',
    warehouse, items, subtotal, discount, tax: 0, total, paid,
    paymentMethod, status, note, source,
    user: state.session.user.name, createdAt: nowISO()
  });

  /* Deduct stock */
  items.forEach(it => {
    const line = it.lineId ? DB.byId('inventory', it.lineId) : resolveLine({ sku: it.sku, house: warehouse, color: it.color });
    if (line) bumpLine(line, 'soldQty', it.qty);
  });

  /* Movement ledger entries */
  items.forEach((it, i) => {
    DB.insert('movements', {
      trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
      type: 'SALE', sku: it.sku, brand: '', itemType: 'Regular',
      house: warehouse, color: it.color || '', qty: it.qty, date: todayISO(),
      note: `Sold on ${orderId}`, source: source,
      user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(), imeis: []
    });
  });

  /* Receivable + invoice */
  if (!paid) {
    DB.update('customers', cust.id, { balance: num(cust.balance) + total });
  }
  const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 21);
  DB.insert('invoices', {
    invoiceNo, type: 'Sale', partyId: cust.id, partyName: cust.name,
    amount: total, paid: paid ? total : 0, status: paid ? 'Paid' : 'Pending',
    date: todayISO(), dueDate: dueDate.toISOString().slice(0, 10), refId: sale.id, notes: note
  });

  audit('SALE', 'Sales', orderId, `${items.length} line(s) — ${money(total)} to ${cust.name}`);
  return sale;
}

/* -------------------------------------------------------------- Dispatch */
function renderDispatch() {
  const all = DB.get('dispatches');
  const q = norm($('dspSearch')?.value);
  const st = $('dspStatus')?.value || '';
  fillSelect('dspStatus', ['Packed', 'Courier', 'In Transit', 'Out for Delivery', 'Delivered', 'Handed Over', 'Returned', 'Cancelled'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(d => [d.dispatchId, d.tracking, d.customer, d.courier, d.route, d.orderId].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(d => d.status === st);

  $('dspCount').textContent = `${fmt(rows.length)} dispatches`;
  const delivered = all.filter(d => ['Delivered', 'Handed Over'].includes(d.status));
  const deliveredValue = sum(delivered, d => {
    const s = d.saleId ? DB.byId('sales', d.saleId) : null;
    return s ? s.total : 0;
  });
  $('dspStats').innerHTML = [
    statCard({ onClick: 'dsp:open', icon: '✦', label: 'Open dispatches', value: fmt(all.filter(d => !['Delivered','Handed Over','Cancelled','Returned'].includes(d.status)).length), meta: 'Awaiting delivery', color: 'amber' }),
    statCard({ onClick: 'dsp:charges', icon: '◍', label: 'Delivery charges', value: money(sum(all, d => d.cost)), meta: 'Total courier cost', color: 'blue' }),
    statCard({ onClick: 'dsp:delivered', icon: '◫', label: 'Delivered value', value: money(deliveredValue), meta: `${delivered.length} settled consignments`, color: 'green' }),
    statCard({ onClick: 'dsp:slow', icon: '◴', label: 'Held over 5 days', value: fmt(all.filter(d => !['Delivered','Handed Over','Cancelled'].includes(d.status) && daysBetween(d.date, todayISO()) > 5).length), meta: 'Follow up required', color: 'red' })
  ].join('');

  Pagers.render('dsp', {
    mount: 'dspTable', foot: 'dspFoot', rows, unit: 'dispatches', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('dispatches', 'status', [
        { label: 'Packed', value: 'Packed' },
        { label: 'In transit', value: 'In Transit' },
        { label: 'Out for delivery', value: 'Out for Delivery' },
        { label: 'Delivered', value: 'Delivered' },
        { label: 'Returned', value: 'Returned' },
        { label: 'Cancelled', value: 'Cancelled' }
      ], 'status'),
      Sel.act.exportRows('dispatches', 'dispatches', selRows => [
        ['Dispatch', 'Date', 'Customer', 'Phone', 'Order', 'Contents', 'Courier', 'Tracking', 'Route', 'Charge', 'ETA', 'Status'],
        ...selRows.map(d => [d.dispatchId, d.date, d.customer, d.phone, d.orderId, d.items,
          d.courier, d.tracking, d.route, num(d.cost), d.eta, d.status])
      ])
    ],
    emptyTitle: 'No dispatches', emptyText: 'Create a dispatch to send an order out for delivery.',
    columns: [
      { key: 'dispatchId', label: 'Dispatch', render: r => `<b class="mono">${esc(r.dispatchId)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'customer', label: 'Customer', render: r => `<b>${esc(r.customer)}</b><span class="row-sub">${esc(r.phone || '')}</span>` },
      { key: 'orderId', label: 'Order', render: r => `<span class="mono fs-12">${esc(r.orderId || '—')}</span>` },
      { key: 'items', label: 'Contents', render: r => `<span class="fs-12">${esc(r.items || '—')}</span>` },
      { key: 'courier', label: 'Courier', render: r => `<b>${esc(r.courier)}</b>${r.tracking ? `<span class="row-sub mono">${esc(r.tracking)}</span>` : ''}` },
      { key: 'route', label: 'Route' },
      { key: 'cost', label: 'Charge', align: 'right', render: r => money(r.cost) },
      { key: 'eta', label: 'ETA', align: 'center', sortVal: r => r.eta, render: r => {
        const late = !['Delivered','Handed Over','Cancelled'].includes(r.status) && r.eta < todayISO();
        return `<span class="badge ${late ? 'red' : 'grey'}">${esc(fmtDate(r.eta))}</span>`;
      }},
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          ${canWrite('dispatch') && !['Delivered','Handed Over','Cancelled'].includes(r.status) ? `<button class="btn xs success" data-dsp-advance="${r.id}">Advance</button>` : ''}
          <button class="btn xs" data-dsp-chase="${r.id}">${r.status === 'Packed' ? 'Send to courier' : 'Chase'}</button>
          <button class="btn xs" data-dsp-view="${r.id}">View</button>
          <button class="btn xs" data-dsp-print="${r.id}">🖨</button>
        </div>` }
    ]
  });
  bindTableButtons('dspTable', {
    'dsp-advance': id => advanceDispatch(id),
    'dsp-chase': id => handToCourier(id),
    'dsp-view': id => openDispatchDetail(id),
    'dsp-print': id => Docs.deliveryChallan(id)
  });
}
const DISPATCH_FLOW = ['Packed', 'Courier', 'In Transit', 'Out for Delivery', 'Delivered', 'Handed Over'];
async function advanceDispatch(id) {
  const d = DB.byId('dispatches', id);
  if (!d) return;
  const i = DISPATCH_FLOW.indexOf(d.status);
  const next = i < 0 || i >= DISPATCH_FLOW.length - 1 ? 'Handed Over' : DISPATCH_FLOW[i + 1];
  DB.update('dispatches', id, { status: next, lastUpdate: nowISO(), history: [...(d.history || []), { status: next, at: nowISO(), by: state.session.user.name }] });
  if (d.saleId) {
    const s = DB.byId('sales', d.saleId);
    if (s) {
      const map = { Packed: 'Processing', Courier: 'Shipped', 'In Transit': 'Shipped', 'Out for Delivery': 'Shipped', Delivered: 'Paid', 'Handed Over': 'Paid' };
      DB.update('sales', s.id, { status: map[next] || s.status });
      if (map[next] === 'Paid' && !s.paid) markSalePaid(s.id);
    }
  }
  audit('DISPATCH', 'Dispatch', d.dispatchId, `Status → ${next}`);
  toast(`${d.dispatchId} → ${next}`, 'good');
  renderAll();
}
async function handToCourier(id) {
  const d = DB.byId('dispatches', id);
  if (!d) return;
  if (d.status === 'Packed') { advanceDispatch(id); return; }
  const eta = await promptDialog({ title: 'Chase consignment', label: `Tracking reference for ${d.dispatchId}`, value: d.tracking || '', confirmLabel: 'Save' });
  if (eta === null) return;
  DB.update('dispatches', id, { tracking: eta, chasedAt: nowISO() });
  audit('UPDATE', 'Dispatch', d.dispatchId, 'Tracking reference updated');
  toast('Tracking updated', 'good');
  renderDispatch();
}

/* Detail drawer for a dispatch — mirrors the repair/customer/inventory pattern
 * so Attachments.mount works the same way. */
function openDispatchDetail(id) {
  const d = DB.byId('dispatches', id);
  if (!d) return;
  const sale = d.saleId ? DB.byId('sales', d.saleId) : null;
  const cust = sale ? DB.byId('customers', sale.customerId) : null;
  const items = sale ? (sale.items || []) : (d.items ? d.items.split(',').map(s => s.trim()) : []);
  openModal({
    width: 'lg', title: d.dispatchId, sub: `${d.courier} · ${d.route || '—'}`,
    body: `
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'dsp:open', icon: '✦', label: 'Status', value: statusBadge(d.status), meta: '', color: ['Delivered','Handed Over'].includes(d.status) ? 'green' : 'amber' })}
        ${statCard({ onClick: 'dsp:charges', icon: '◍', label: 'Charge', value: money(d.cost), meta: 'Courier fee', color: 'blue' })}
        ${statCard({ onClick: 'dsp:delivered', icon: '◫', label: 'ETA', value: esc(fmtDate(d.eta)), meta: d.tracking ? `Track: ${d.tracking}` : 'No tracking', color: 'purple' })}
      </div>
      <div class="section-title">Customer</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Name</span><span class="v"><b>${esc(d.customer)}</b></span></div>
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(d.phone || '—')}</span></div>
        ${cust ? `<div class="kv-row"><span class="k">City</span><span class="v">${esc(cust.city || '—')}</span></div>` : ''}
      </div>
      <div class="section-title">Linked order</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Order</span><span class="v">${sale ? `<b class="mono">${esc(sale.orderId)}</b>` : '—'}</span></div>
        <div class="kv-row"><span class="k">Order date</span><span class="v">${sale ? esc(fmtDate(sale.date)) : '—'}</span></div>
        <div class="kv-row"><span class="k">Order total</span><span class="v">${sale ? money(sale.total) : '—'}</span></div>
      </div>
      <div class="section-title">Contents</div>
      <div class="kv mb-16">
        ${items.length ? items.map(it => `<div class="kv-row"><span class="k">·</span><span class="v">${esc(it)}</span></div>`).join('') : '<div class="kv-row"><span class="k">—</span><span class="v text-3">No item details</span></div>'}
      </div>
      <div class="section-title">Dispatch timeline</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Created</span><span class="v">${esc(fmtDate(d.date))}</span></div>
        ${d.chasedAt ? `<div class="kv-row"><span class="k">Last chased</span><span class="v">${esc(fmtDateTime(d.chasedAt))}</span></div>` : ''}
        ${d.lastUpdate ? `<div class="kv-row"><span class="k">Status updated</span><span class="v">${esc(fmtDateTime(d.lastUpdate))}</span></div>` : ''}
        ${d.deliveredAt ? `<div class="kv-row"><span class="k"><b>Delivered</b></span><span class="v c-green"><b>${esc(fmtDateTime(d.deliveredAt))}</b></span></div>` : ''}
      </div>
      <div class="section-title">Proof of delivery / photos</div>
      <div class="mb-16" id="attHost"></div>
      ${d.history && d.history.length ? `
      <div class="section-title">Status history</div>
      <div class="kv">${d.history.map(h => `<div class="kv-row"><span class="k">${esc(h.status)}</span><span class="v">${esc(fmtDateTime(h.at))} · ${esc(h.by)}</span></div>`).join('')}</div>` : ''}
    `,
    foot: `${canWrite('dispatch') ? `<button class="btn left success" data-dsp-adv="${id}">${['Delivered','Handed Over'].includes(d.status) ? '✓ Already delivered' : 'Advance status'}</button>` : ''}
           ${Attachments.buttons(canWrite('dispatch'))}
           <button class="btn" data-x>Close</button>
           ${canWrite('dispatch') ? `<button class="btn" data-dsp-chase="${id}">Chase</button>` : ''}
           <button class="btn primary" data-dsp-print="${id}">🖨 Challan</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const adv = qs('[data-dsp-adv]', el);
      if (adv) adv.onclick = () => { closeModal(el); advanceDispatch(id); };
      const ch = qs('[data-dsp-chase]', el);
      if (ch) ch.onclick = () => { closeModal(el); handToCourier(id); };
      const pr = qs('[data-dsp-print]', el);
      if (pr) pr.onclick = () => Docs.deliveryChallan(id);
      Attachments.mount(qs('#attHost', el), 'dispatches', d.id);
    }
  });
}

/* --------------------------------------------------------------- Repairs */
const repairTab = () => state.ui.repTab || 'tickets';
function renderRepairs() {
  const all = DB.get('repairs');
  const tab = repairTab();
  $('tnTickets').textContent = all.length;
  $('tnImei').textContent = DB.get('imeis').length;
  $('tnWarranty').textContent = all.filter(r => r.warrantyClaim).length;
  $$('#repTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));

  const openRep = all.filter(r => !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status));
  const closedRep = all.filter(r => ['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status));
  const avgDays = closedRep.length ? (sum(closedRep, r => daysBetween(r.intakeDate, r.completedDate || todayISO())) / closedRep.length) : 0;
  $('repStats').innerHTML = [
    statCard({ onClick: 'dash:repairs', icon: '◈', label: 'Open tickets', value: fmt(openRep.length), meta: 'In the service lab', color: 'amber' }),
    statCard({ onClick: 'rep:tat', icon: '◴', label: 'Average turnaround', value: avgDays ? `${avgDays.toFixed(1)} d` : '—', meta: `${closedRep.length} closed`, color: avgDays > 5 ? 'red' : 'green' }),
    statCard({ onClick: 'rep:income', icon: '◍', label: 'Repair income', value: money(sum(closedRep.filter(r => r.paid), r => num(r.cost) + num(r.labourCost))), meta: `${closedRep.filter(r => r.paid).length} paid jobs`, color: 'green' }),
    statCard({ onClick: 'rep:overdue', icon: '⚠', label: 'Overdue jobs', value: fmt(openRep.filter(r => r.promisedDate < todayISO()).length), meta: 'Past promised date', color: 'red' })
  ].join('');

  const q = norm($('repSearch')?.value);
  const st = $('repStatus')?.value || '';
  const df = $('repDefect')?.value || '';
  fillSelect('repStatus', REPAIR_STATUSES, 'All statuses');
  fillSelect('repDefect', DEFECT_TYPES, 'All defect categories');
  $('repToolbar').classList.toggle('hidden', tab === 'warranty');

  if (tab === 'imei') return renderImeiRegistry(q);
  if (tab === 'warranty') return renderWarrantyTab(all.filter(r => r.warrantyClaim));

  let rows = all;
  if (q) rows = rows.filter(r => [r.ticketNo, r.imei, r.imei2, r.serialNumber, r.model, r.brand, r.customerName, r.technician, r.defectType].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(r => r.status === st);
  if (df) rows = rows.filter(r => r.defectType === df);
  $('repCount').textContent = `${fmt(rows.length)} tickets`;

  Pagers.render('rep', {
    mount: 'repTable', foot: 'repFoot', rows, unit: 'tickets', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('repairs', 'status', REPAIR_STATUSES.map(s => ({ label: s, value: s })), 'status'),
      Sel.act.assign('repairs', 'technician', 'Technician', () =>
        DB.get('employees').filter(e => e.status !== 'Inactive').map(e => ({ label: e.name, value: e.name }))),
      Sel.act.edit('repairs', 'discount', 'Discount', 'number'),
      Sel.act.edit('repairs', 'labourCost', 'Labour cost', 'number'),
      Sel.act.delete('repairs')
    ],
    emptyTitle: 'No repair tickets', emptyText: 'Log a BadBin intake to start tracking an after-sales job.',
    columns: [
      { key: 'ticketNo', label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b><span class="row-sub">${esc(fmtDate(r.intakeDate))}</span>` },
      { key: 'imei', label: 'IMEI / Serial', render: r => {
        const dup = DB.get('imeis').filter(i => norm(i.imei) === norm(r.imei)).length > 1;
        return `<b class="mono">${esc(r.imei || '—')}</b>${dup ? '<span class="row-sub c-red">⚠ duplicate registered</span>' : r.serialNumber ? `<span class="row-sub mono">${esc(r.serialNumber)}</span>` : ''}`;
      }},
      { key: 'model', label: 'Model', render: r => `<b>${esc(r.model)}</b><span class="row-sub">${esc(r.brand || '')} ${esc(r.color || '')}</span>` },
      { key: 'defectType', label: 'Defect', render: r => `<span class="badge red">${esc(r.defectType)}</span>` },
      { key: 'customerName', label: 'Customer', render: r => `<span>${esc(r.customerName || '—')}</span><span class="row-sub">${esc(r.customerPhone || '')}</span>` },
      { key: 'technician', label: 'Technician', render: r => r.technician ? `<span>${esc(r.technician)}</span>` : '<span class="text-3">Unassigned</span>' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'promisedDate', label: 'Promised', align: 'center', sortVal: r => r.promisedDate, render: r => {
        const open = !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status);
        return `<span class="badge ${open && r.promisedDate < todayISO() ? 'red' : 'grey'}">${esc(fmtDate(r.promisedDate))}</span>`;
      }},
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-rep-view="${r.id}">View</button>
          ${canWrite('repairs') && !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status) ? `<button class="btn xs success" data-rep-done="${r.id}">Close</button>` : ''}
          <button class="btn xs" data-rep-print="${r.id}">🖨</button>
        </div>` }
    ],
    onRow: r => openRepairDrawer(r.id)
  });
  bindTableButtons('repTable', {
    'rep-done': id => closeRepair(id),
    'rep-print': id => Docs.jobCard(id),
    'rep-view': id => openRepairDrawer(id)
  });
}

function renderImeiRegistry(q) {
  let rows = DB.get('imeis');
  if (q) rows = rows.filter(i => [i.imei, i.sku, i.brand, i.house, i.status, i.ticketNo, i.note].join(' ').toLowerCase().includes(q));
  $('repCount').textContent = `${fmt(rows.length)} registered IMEIs`;
  Pagers.render('imei', {
    mount: 'repTable', foot: 'repFoot', rows, unit: 'identifiers',
    emptyTitle: 'No identifiers registered', emptyText: 'Serials are captured automatically when stock moves with IMEI lists, or when a BadBin intake is logged.',
    columns: [
      { key: 'imei', label: 'IMEI', render: r => `<b class="mono">${esc(r.imei)}</b>` },
      { key: 'sku', label: 'Product', render: r => `<b>${esc(r.sku || '—')}</b><span class="row-sub">${esc(r.brand || '')}</span>` },
      { key: 'color', label: 'Colour' },
      { key: 'house', label: 'Facility' },
      { key: 'status', label: 'State', render: r => statusBadge(r.status) },
      { key: 'ticketNo', label: 'Reference', render: r => `<span class="mono fs-12">${esc(r.ticketNo || r.note || '—')}</span>` },
      { key: 'addedAt', label: 'Recorded', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.addedAt))}</span>` }
    ],
    onRow: r => {
      const dupe = DB.get('imeis').filter(x => norm(x.imei) === norm(r.imei));
      openModal({
        width: 'sm', title: 'IMEI detail', sub: r.imei,
        body: `<div class="kv">
            <div class="kv-row"><span class="k">Product</span><span class="v">${esc(r.sku || '—')}</span></div>
            <div class="kv-row"><span class="k">Brand</span><span class="v">${esc(r.brand || '—')}</span></div>
            <div class="kv-row"><span class="k">Colour</span><span class="v">${esc(r.color || '—')}</span></div>
            <div class="kv-row"><span class="k">Facility</span><span class="v">${esc(r.house || '—')}</span></div>
            <div class="kv-row"><span class="k">State</span><span class="v">${statusBadge(r.status)}</span></div>
            <div class="kv-row"><span class="k">Reference</span><span class="v mono">${esc(r.ticketNo || r.note || '—')}</span></div>
            <div class="kv-row"><span class="k">Recorded</span><span class="v">${esc(fmtDateTime(r.addedAt))}</span></div>
          </div>
          ${dupe.length > 1 ? `<div class="callout danger mt-16"><span class="lead">⚠</span><div class="body"><b>Collision detected</b>This identifier appears on ${dupe.length} records. Review before dispatching.</div></div>` : ''}`,
        foot: `<button class="btn" data-x>Close</button>`
      });
    }
  });
}

function renderWarrantyTab(rows) {
  $('repCount').textContent = `${fmt(rows.length)} warranty claims`;
  Pagers.render('repW', {
    mount: 'repTable', foot: 'repFoot', rows, unit: 'claims', dense: true,
    emptyTitle: 'No warranty claims', emptyText: 'Claims appear here when a ticket is logged against a manufacturer warranty.',
    columns: [
      { key: 'ticketNo', label: 'Ticket', render: r => `<b class="mono">${esc(r.ticketNo)}</b><span class="row-sub">${esc(fmtDate(r.intakeDate))}</span>` },
      { key: 'imei', label: 'IMEI', render: r => `<span class="mono">${esc(r.imei || '—')}</span>` },
      { key: 'model', label: 'Model', render: r => `<b>${esc(r.model)}</b>` },
      { key: 'defectType', label: 'Defect' },
      { key: 'customerName', label: 'Customer' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'cost', label: 'Charge', align: 'right', render: r => money(num(r.cost) + num(r.labourCost)) },
      { key: 'actions', label: '', sortable: false, align: 'right', render: r => `<div class="actions"><button class="btn xs" data-rep-view="${r.id}">View</button></div>` }
    ],
    onRow: r => openRepairDrawer(r.id)
  });
  bindTableButtons('repTable', { 'rep-view': id => openRepairDrawer(id) });
}

function openRepairDrawer(id) {
  const r = DB.byId('repairs', id);
  if (!r) return;
  const open = !['Repaired','GoodBin Returned','Scrapped','Returned to Customer'].includes(r.status);
  const age = daysBetween(r.intakeDate, todayISO());
  const collision = DB.get('imeis').filter(i => norm(i.imei) === norm(r.imei)).length > 1;
  openModal({
    drawer: true, autofocus: false, title: r.ticketNo,
    sub: `${r.model} · ${r.brand || ''}`,
    body: `
      <div class="row-wrap mb-16 gap-6">${statusBadge(r.status)}
        <span class="badge red">${esc(r.defectType)}</span>
        ${r.warrantyClaim ? '<span class="badge blue">Warranty claim</span>' : '<span class="badge grey">Chargeable</span>'}
        ${open && r.promisedDate < todayISO() ? '<span class="badge red">Overdue</span>' : ''}
        <span class="badge ${age > 7 ? 'red' : 'grey'}">${age} day${age === 1 ? '' : 's'} old</span></div>
      ${collision ? `<div class="callout danger mb-16"><span class="lead">⚠</span><div class="body"><b>Duplicate IMEI</b>This identifier is registered on more than one record. Verify the device identity before releasing it.</div></div>` : ''}
      <div class="section-title">Device</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">IMEI</span><span class="v mono">${esc(r.imei || '—')}</span></div>
        <div class="kv-row"><span class="k">IMEI 2</span><span class="v mono">${esc(r.imei2 || '—')}</span></div>
        <div class="kv-row"><span class="k">Serial</span><span class="v mono">${esc(r.serialNumber || '—')}</span></div>
        <div class="kv-row"><span class="k">Model</span><span class="v">${esc(r.model)}</span></div>
        <div class="kv-row"><span class="k">Colour</span><span class="v">${esc(r.color || '—')}</span></div>
      </div>
      <div class="section-title">Job</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Customer</span><span class="v">${esc(r.customerName || '—')}</span></div>
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(r.customerPhone || '—')}</span></div>
        <div class="kv-row"><span class="k">Technician</span><span class="v">${esc(r.technician || '<span class="text-3">Unassigned</span>')}</span></div>
        <div class="kv-row"><span class="k">Intake</span><span class="v">${esc(fmtDate(r.intakeDate))}</span></div>
        <div class="kv-row"><span class="k">Promised</span><span class="v ${open && r.promisedDate < todayISO() ? 'c-red' : ''}">${esc(fmtDate(r.promisedDate))}</span></div>
        ${r.completedDate ? `<div class="kv-row"><span class="k">Completed</span><span class="v">${esc(fmtDate(r.completedDate))}</span></div>` : ''}
        <div class="kv-row"><span class="k">Destination</span><span class="v">${esc(r.destination || 'Service Lab')}</span></div>
      </div>
      <div class="section-title">Diagnosis</div>
      <p class="fs-12 text-2 mb-16" style="line-height:1.6">${esc(r.notes || 'No notes recorded.')}</p>
      <div class="section-title">Billing</div>
      <div class="kv">
        <div class="kv-row"><span class="k">Parts cost</span><span class="v">${money(r.cost)}</span></div>
        <div class="kv-row"><span class="k">Labour</span><span class="v">${money(r.labourCost)}</span></div>
        <div class="kv-row"><span class="k">Discount</span><span class="v c-red">${num(r.discount) ? '−' + money(r.discount) : money(0)}</span></div>
        <div class="kv-row"><span class="k">Payable</span><span class="v" style="font-size:15px"><b>${money(num(r.cost) + num(r.labourCost) - num(r.discount))}</b></span></div>
        <div class="kv-row"><span class="k">Payment</span><span class="v">${r.paid ? '<span class="badge green">Paid</span>' : '<span class="badge amber">Outstanding</span>'}</span></div>
      </div>
      <div class="section-title mt-16">Stage control</div>
      <div class="row-wrap gap-6">${REPAIR_STATUSES.map(s => `<button class="btn xs ${s === r.status ? 'primary' : ''}" data-rep-status="${esc(s)}" ${canWrite('repairs') ? '' : 'disabled'}>${esc(s)}</button>`).join('')}</div>
      <div class="section-title">Photos of the device</div>
      <div id="attHost"></div>`,
    foot: `${canWrite('repairs') && open ? `<button class="btn left success" data-close-job>✓ Close job</button>` : ''}
           ${Attachments.buttons(canWrite('repairs'))}
           <button class="btn" data-x>Close</button>
           ${canWrite('repairs') ? `<button class="btn" data-edit>Edit</button>` : ''}
           <button class="btn primary" data-print>🖨 Job card</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      qs('[data-print]', el).onclick = () => Docs.jobCard(r.id);
      const cj = qs('[data-close-job]', el);
      if (cj) cj.onclick = () => { closeModal(el); closeRepair(r.id); };
      const ed = qs('[data-edit]', el);
      if (ed) ed.onclick = () => { closeModal(el); Modals.repairForm(r); };
      $$('[data-rep-status]', el).forEach(b => b.onclick = () => { closeModal(el); setRepairStatus(r.id, b.dataset.repStatus); });
      /* Condition photos are the point of a repair job: a cracked screen or a
       * board fault is evidence, not a note. */
      Attachments.mount(qs('#attHost', el), 'repairs', r.id);
    }
  });
}
function setRepairStatus(id, status) {
  const r = DB.byId('repairs', id);
  if (!r) return;
  const patch = { status, statusHistory: [...(r.statusHistory || []), { status, at: nowISO(), by: state.session.user.name }] };
  if (['Repaired', 'GoodBin Returned', 'Scrapped'].includes(status)) patch.completedDate = todayISO();
  if (status === 'GoodBin Returned') patch.destination = 'GoodBin — Refurbished';
  if (status === 'Scrapped') patch.destination = 'Scrap Yard';
  DB.update('repairs', id, patch);
  const reg = DB.get('imeis').find(i => norm(i.imei) === norm(r.imei));
  if (reg) DB.update('imeis', reg.id, { status, ticketNo: r.ticketNo });
  audit('REPAIR', 'After-Sales', r.ticketNo, `Status → ${status}`);
  toast(`${r.ticketNo} → ${status}`, 'good');
  renderAll();
}
async function closeRepair(id) {
  const r = DB.byId('repairs', id);
  if (!r) return;
  const dest = await confirmDialog({
    title: 'Close repair job', confirmLabel: 'Mark as GoodBin',
    message: `${r.ticketNo} — ${r.model}`,
    detail: `Chargeable amount ${money(num(r.cost) + num(r.labourCost) - num(r.discount))}. The device moves to the GoodBin refurbishment stock.`
  });
  if (!dest) return;
  setRepairStatus(id, 'GoodBin Returned');
  DB.update('repairs', id, { paid: true, paidDate: todayISO() });
  if (!state.db.settings.warranty) { /* no-op */ }
  /* Move to refurbished stock */
  const item = DB.get('items').find(i => norm(i.model) === norm(r.model));
  if (item) {
    const line = resolveLine({ sku: r.model, brand: r.brand, type: 'Refurbished', house: 'Service Center', color: r.color || 'Standard' });
    bumpLine(line, 'inQty', 1);
    DB.insert('movements', {
      trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
      type: 'IN', sku: r.model, brand: r.brand, itemType: 'Refurbished',
      house: 'Service Center', color: r.color || 'Standard', qty: 1, date: todayISO(),
      note: `GoodBin recovery from ${r.ticketNo}`, source: 'Service Center',
      user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(), imeis: [{ imei: r.imei }]
    });
  }
  toast('Job closed and device moved to GoodBin', 'good');
  renderAll();
}

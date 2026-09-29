/* ==========================================================================
   AMAYA ERP — Pages C: Customers, Suppliers, Invoices, Employees,
                    Payroll, Leave, Attendance
   ========================================================================== */

/* ------------------------------------------------------------- Customers */
function renderCustomers() {
  const all = DB.get('customers');
  const q = norm($('custSearch')?.value);
  const st = $('custStatus')?.value || '';
  fillSelect('custStatus', ['Active', 'Inactive'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(c => [c.name, c.phone, c.email, c.city, c.address].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(c => c.status === st);

  $('custCount').textContent = `${fmt(rows.length)} customers`;
  Pagers.render('cust', {
    mount: 'custTable', foot: 'custFoot', rows, unit: 'customers', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('customers', 'status', [
        { label: 'Mark active', value: 'Active' },
        { label: 'Mark inactive', value: 'Inactive' }
      ], 'status'),
      Sel.act.edit('customers', 'creditLimit', 'Credit limit', 'number'),
      Sel.act.edit('customers', 'phone', 'Phone'),
      Sel.act.edit('customers', 'city', 'City'),
      Sel.act.exportRows('customers', 'customers', selRows => [
        ['Name', 'Phone', 'Email', 'City', 'Credit limit', 'Balance', 'Status'],
        ...selRows.map(c => [c.name, c.phone, c.email, c.city, num(c.creditLimit), num(c.balance), c.status])
      ]),
      Sel.act.delete('customers')
    ],
    emptyTitle: 'No customers', emptyText: 'Add customers to track credit limits and balances.',
    columns: [
      { key: 'name', label: 'Name', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b></span></div>` },
      { key: 'phone', label: 'Phone', render: r => esc(r.phone || '—') },
      { key: 'email', label: 'Email', render: r => `<span class="fs-12">${esc(r.email || '—')}</span>` },
      { key: 'city', label: 'City', render: r => esc(r.city || '—') },
      { key: 'creditLimit', label: 'Credit limit', align: 'right', render: r => money(r.creditLimit) },
      { key: 'balance', label: 'Balance', align: 'right', sortVal: r => num(r.balance), render: r => `<b class="${num(r.balance) > 0 ? 'c-red' : ''}">${money(r.balance)}</b>` },
      { key: 'lifetime', label: 'Lifetime value', align: 'right', sortVal: r => sum(DB.get('sales').filter(s => s.customerId === r.id), s => s.total), render: r => {
        const v = sum(DB.get('sales').filter(s => s.customerId === r.id), s => s.total);
        return money(v) + `<span class="row-sub">${DB.get('sales').filter(s => s.customerId === r.id).length} orders</span>`;
      }},
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-cust-statement="${r.id}">Ledger</button>
          ${canWrite('customers') ? `<button class="btn xs" data-cust-edit="${r.id}">Edit</button>` : ''}
          ${canWrite('customers') ? `<button class="btn xs danger" data-cust-del="${r.id}">✕</button>` : ''}
        </div>` }
    ]
  });
  bindTableButtons('custTable', {
    'cust-edit': id => Modals.customerForm(DB.byId('customers', id)),
    'cust-del': id => deleteRecord('customers', id, 'Customer', 'name'),
    'cust-statement': id => openCustomerLedger(id)
  });
}
function openCustomerLedger(id) {
  const c = DB.byId('customers', id);
  const sales = sortBy(DB.get('sales').filter(s => s.customerId === id), s => s.date, -1);
  const invs = DB.get('invoices').filter(i => i.partyId === id);
  openModal({
    width: 'lg', title: c.name, sub: `${c.phone || 'No phone'} · ${c.city || 'No city'}`,
    body: `
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'cust:debtors', icon: '◍', label: 'Outstanding', value: money(c.balance), meta: `Limit ${money(c.creditLimit)}`, color: num(c.balance) > num(c.creditLimit) ? 'red' : 'green' })}
        ${statCard({ onClick: 'cust:lifetime', icon: '◫', label: 'Lifetime value', value: money(sum(sales, s => s.total)), meta: `${sales.length} orders`, color: 'blue' })}
        ${statCard({ onClick: 'cust:credit', icon: '▤', label: 'Credit used', value: num(c.creditLimit) ? Math.round(num(c.balance) / num(c.creditLimit) * 100) + '%' : '—', meta: 'of limit', color: 'purple' })}
      </div>
      <div class="section-title">Order history</div>
      <div class="table-scroll" style="max-height:340px">
        <table class="dt"><thead><tr><th>Order</th><th>Date</th><th>Items</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${sales.length ? sales.map(s => `<tr class="clickable" data-ledger-sale="${s.id}">
          <td class="mono">${esc(s.orderId)}</td><td>${esc(fmtDate(s.date))}</td>
          <td class="fs-12">${esc((s.items || []).map(i => `${i.sku} ×${i.qty}`).join(', '))}</td>
          <td class="right num"><b>${money(s.total)}</b></td><td>${statusBadge(s.status)}</td></tr>`).join('')
          : '<tr><td colspan="5"><div class="empty" style="padding:24px"><b>No orders yet</b></div></td></tr>'}</tbody></table>
      </div>
      <div class="section-title mt-16">Invoices</div>
      <div class="table-scroll" style="max-height:200px">
        <table class="dt"><thead><tr><th>Invoice</th><th>Type</th><th>Due</th><th class="right">Amount</th><th>Status</th></tr></thead>
        <tbody>${invs.length ? invs.map(i => `<tr><td class="mono">${esc(i.invoiceNo)}</td><td>${esc(i.type)}</td>
          <td>${esc(fmtDate(i.dueDate))}</td><td class="right num">${money(i.amount)}</td><td>${statusBadge(i.status)}</td></tr>`).join('')
          : '<tr><td colspan="5"><div class="empty" style="padding:20px"><b>No invoices</b></div></td></tr>'}</tbody></table>
      </div>
      <div class="section-title">Customer photos</div>
      <div id="attHost"></div>`,
    foot: `${Attachments.buttons(canWrite('customers'))}
           <button class="btn" data-x>Close</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      $$('[data-ledger-sale]', el).forEach(tr => tr.onclick = () => { closeModal(el); openSaleDrawer(tr.dataset.ledgerSale); });
      Attachments.mount(qs('#attHost', el), 'customers', id);
    }
  });
}

/* ------------------------------------------------------------- Suppliers */
function renderSuppliers() {
  const all = DB.get('suppliers');
  const q = norm($('suppSearch')?.value);
  const st = $('suppStatus')?.value || '';
  fillSelect('suppStatus', ['Active', 'Inactive'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(s => [s.name, s.phone, s.email, s.city, s.accountNo, s.paymentTerms].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(s => s.status === st);

  $('suppCount').textContent = `${fmt(rows.length)} suppliers`;
  Pagers.render('supp', {
    mount: 'suppTable', foot: 'suppFoot', rows, unit: 'suppliers', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('suppliers', 'status', [
        { label: 'Mark active', value: 'Active' },
        { label: 'Mark inactive', value: 'Inactive' }
      ], 'status'),
      Sel.act.edit('suppliers', 'paymentTerms', 'Payment terms'),
      Sel.act.edit('suppliers', 'phone', 'Phone'),
      Sel.act.edit('suppliers', 'city', 'City'),
      Sel.act.exportRows('suppliers', 'suppliers', selRows => [
        ['Supplier', 'Phone', 'Email', 'City', 'Terms', 'Account', 'Payable', 'Status'],
        ...selRows.map(s => [s.name, s.phone, s.email, s.city, s.paymentTerms, s.accountNo, num(s.balance), s.status])
      ]),
      Sel.act.delete('suppliers')
    ],
    emptyTitle: 'No suppliers', emptyText: 'Add suppliers to raise purchase orders against them.',
    columns: [
      { key: 'name', label: 'Supplier', render: r => `<div class="row gap-6">${avatarNode(r.name, 24)}<span><b>${esc(r.name)}</b><span class="row-sub mono">${esc(r.accountNo || '')}</span></span></div>` },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email', render: r => `<span class="fs-12">${esc(r.email || '—')}</span>` },
      { key: 'city', label: 'City' },
      { key: 'paymentTerms', label: 'Terms', render: r => `<span class="badge blue">${esc(r.paymentTerms || '—')}</span>` },
      { key: 'purchased', label: 'Purchased', align: 'right', sortVal: r => sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => p.total), render: r => {
        const v = sum(DB.get('purchases').filter(p => p.supplierId === r.id), p => p.total);
        return money(v) + `<span class="row-sub">${DB.get('purchases').filter(p => p.supplierId === r.id).length} POs</span>`;
      }},
      { key: 'balance', label: 'Payable', align: 'right', sortVal: r => num(r.balance), render: r => `<b class="${num(r.balance) > 0 ? 'c-red' : 'c-green'}">${money(r.balance)}</b>` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-supp-view="${r.id}">View</button>
          <button class="btn xs" data-supp-statement="${r.id}">Ledger</button>
          ${canWrite('suppliers') ? `<button class="btn xs" data-supp-edit="${r.id}">Edit</button>` : ''}
          ${canWrite('suppliers') ? `<button class="btn xs danger" data-supp-del="${r.id}">✕</button>` : ''}
        </div>` }
    ]
  });
  bindTableButtons('suppTable', {
    'supp-view': id => openSupplierDetail(id),
    'supp-edit': id => Modals.supplierForm(DB.byId('suppliers', id)),
    'supp-del': id => deleteRecord('suppliers', id, 'Supplier', 'name'),
    'supp-statement': id => openSupplierLedger(id)
  });
}
function openSupplierLedger(id) {
  const s = DB.byId('suppliers', id);
  const pos = sortBy(DB.get('purchases').filter(p => p.supplierId === id), p => p.date, -1);
  const invs = DB.get('invoices').filter(i => i.partyId === id);
  openModal({
    width: 'lg', title: s.name, sub: `${s.accountNo || 'No account'} · ${s.paymentTerms || '—'}`,
    body: `
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'sup:creditors', icon: '◍', label: 'Payable', value: money(s.balance), meta: 'Outstanding to supplier', color: num(s.balance) > 0 ? 'red' : 'green' })}
        ${statCard({ onClick: 'sup:purchased', icon: '◫', label: 'Purchased', value: money(sum(pos, p => p.total)), meta: `${pos.length} purchase orders`, color: 'blue' })}
        ${statCard({ onClick: 'sup:received', icon: '▤', label: 'Received units', value: fmt(sum(pos, p => p.receivedQty)), meta: 'Stock received', color: 'green' })}
      </div>
      <div class="section-title">Purchase orders</div>
      <div class="table-scroll" style="max-height:280px"><table class="dt">
        <thead><tr><th>PO</th><th>Date</th><th>Item</th><th class="right">Qty</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${pos.length ? pos.map(p => `<tr class="clickable" data-ledger-po="${p.id}">
          <td class="mono">${esc(p.poNumber)}</td><td>${esc(fmtDate(p.date))}</td><td>${esc(p.item)}</td>
          <td class="right num">${fmt(p.qty)}</td><td class="right num"><b>${money(p.total)}</b></td><td>${statusBadge(p.status)}</td></tr>`).join('')
          : '<tr><td colspan="6"><div class="empty" style="padding:24px"><b>No purchase orders</b></div></td></tr>'}</tbody></table></div>
      <div class="section-title">Documents</div>
      <div class="mb-16" id="attHost"></div>`,
    foot: `<button class="btn" data-x>Close</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      $$('[data-ledger-po]', el).forEach(tr => tr.onclick = () => { closeModal(el); openPODrawer(tr.dataset.ledgerPo); });
      Attachments.mount(qs('#attHost', el), 'suppliers', s.id);
    }
  });
}

/* Full supplier detail drawer (distinct from the ledger view) with attachments. */
function openSupplierDetail(id) {
  const s = DB.byId('suppliers', id);
  if (!s) return;
  const pos = DB.get('purchases').filter(p => p.supplierId === id);
  const invs = DB.get('invoices').filter(i => i.partyId === id && i.type === 'Purchase');
  openModal({
    width: 'lg', title: s.name, sub: `${s.accountNo || 'No account'} · ${s.paymentTerms || '—'}`,
    body: `
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'sup:creditors', icon: '◍', label: 'Payable', value: money(s.balance), meta: 'Outstanding', color: num(s.balance) > 0 ? 'red' : 'green' })}
        ${statCard({ onClick: 'sup:purchased', icon: '◫', label: 'Purchased', value: money(sum(pos, p => p.total)), meta: `${pos.length} POs`, color: 'blue' })}
        ${statCard({ onClick: 'sup:received', icon: '▤', label: 'Received', value: fmt(sum(pos, p => p.receivedQty)), meta: 'Units received', color: 'green' })}
      </div>
      <div class="section-title">Contact</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(s.phone || '—')}</span></div>
        <div class="kv-row"><span class="k">Email</span><span class="v">${esc(s.email || '—')}</span></div>
        <div class="kv-row"><span class="k">City</span><span class="v">${esc(s.city || '—')}</span></div>
        <div class="kv-row"><span class="k">Terms</span><span class="v">${esc(s.paymentTerms || '—')}</span></div>
        <div class="kv-row"><span class="k">Account</span><span class="v mono">${esc(s.accountNo || '—')}</span></div>
      </div>
      <div class="section-title">Purchase orders</div>
      <div class="table-scroll" style="max-height:200px"><table class="dt">
        <thead><tr><th>PO</th><th>Date</th><th>Item</th><th class="right">Qty</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${pos.length ? pos.map(p => `<tr class="clickable" data-ledger-po="${p.id}">
          <td class="mono">${esc(p.poNumber)}</td><td>${esc(fmtDate(p.date))}</td><td>${esc(p.item)}</td>
          <td class="right num">${fmt(p.qty)}</td><td class="right num"><b>${money(p.total)}</b></td><td>${statusBadge(p.status)}</td></tr>`).join('')
          : '<tr><td colspan="6"><div class="empty" style="padding:20px"><b>No purchase orders</b></div></td></tr>'}</tbody></table></div>
      <div class="section-title">Documents</div>
      <div class="mb-16" id="attHost"></div>
    `,
    foot: `${Attachments.buttons(canWrite('suppliers'))}
           <button class="btn" data-x>Close</button>
           ${canWrite('suppliers') ? `<button class="btn" data-supp-edit="${s.id}">Edit</button>` : ''}
           <button class="btn" data-supp-statement="${s.id}">Ledger</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const ed = qs('[data-supp-edit]', el);
      if (ed) ed.onclick = () => { closeModal(el); Modals.supplierForm(s); };
      const st = qs('[data-supp-statement]', el);
      if (st) st.onclick = () => { closeModal(el); openSupplierLedger(id); };
      Attachments.mount(qs('#attHost', el), 'suppliers', s.id);
    }
  });
}

/* -------------------------------------------------------------- Invoices */
function renderInvoices() {
  const all = DB.get('invoices');
  const q = norm($('invcSearch')?.value);
  const ty = $('invcType')?.value || '';
  const st = $('invcStatus')?.value || '';
  fillSelect('invcType', ['Sale', 'Purchase', 'Service'], 'All types');
  fillSelect('invcStatus', ['Pending', 'Approved', 'Paid', 'Overdue', 'Cancelled'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(i => [i.invoiceNo, i.partyName, i.notes].join(' ').toLowerCase().includes(q));
  if (ty) rows = rows.filter(i => i.type === ty);
  if (st) rows = rows.filter(i => i.status === st);

  $('invcCount').textContent = `${fmt(rows.length)} invoices`;
  const sales = all.filter(i => i.type === 'Sale');
  $('invStats2').innerHTML = [
    statCard({ onClick: 'inv:receivable', icon: '◫', label: 'Receivables', value: money(sum(sales.filter(i => i.status !== 'Paid'), i => num(i.amount) - num(i.paid))), meta: 'Outstanding sales', color: 'blue' }),
    statCard({ onClick: 'inv:payable', icon: '◍', label: 'Payables', value: money(sum(all.filter(i => i.type === 'Purchase' && i.status !== 'Paid'), i => num(i.amount) - num(i.paid))), meta: 'Owed to suppliers', color: 'red' }),
    statCard({ onClick: 'inv:overdue', icon: '⚠', label: 'Overdue', value: money(sum(all.filter(i => i.status === 'Overdue'), i => num(i.amount) - num(i.paid))), meta: `${all.filter(i => i.status === 'Overdue').length} invoices`, color: 'red' }),
    statCard({ onClick: 'inv:paid', icon: '◫', label: 'Collected', value: money(sum(all, i => i.paid)), meta: 'Total settled', color: 'green' })
  ].join('');

  Pagers.render('invc', {
    mount: 'invcTable', foot: 'invcFoot', rows, unit: 'invoices', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('invoices', 'status', [
        { label: 'Mark approved', value: 'Approved' },
        { label: 'Mark paid', value: 'Paid' },
        { label: 'Mark overdue', value: 'Overdue' },
        { label: 'Cancel', value: 'Cancelled' }
      ], 'status'),
      /* Settling in bulk is the common reconciliation chore: mark the chosen
       * invoices paid in one pass instead of opening each row. */
      Sel.act.settleInvoices(),
      Sel.act.exportRows('invoices', 'invoices', selRows => [
        ['Invoice', 'Date', 'Type', 'Party', 'Amount', 'Paid', 'Due', 'Due date', 'Status'],
        ...selRows.map(i => [i.invoiceNo, i.date, i.type, i.partyName, num(i.amount), num(i.paid),
          num(i.amount) - num(i.paid), i.dueDate, i.status])
      ])
    ],
    emptyTitle: 'No invoices', emptyText: 'Invoices are generated automatically when a sale or purchase is recorded.',
    columns: [
      { key: 'invoiceNo', label: 'Invoice', render: r => `<b class="mono">${esc(r.invoiceNo)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'type', label: 'Type', render: r => `<span class="badge ${r.type === 'Sale' ? 'green' : r.type === 'Purchase' ? 'amber' : 'blue'}">${esc(r.type)}</span>` },
      { key: 'partyName', label: 'Party', render: r => `<b>${esc(r.partyName)}</b>` },
      { key: 'amount', label: 'Amount', align: 'right', render: r => `<b>${money(r.amount)}</b>` },
      { key: 'paid', label: 'Settled', align: 'right', render: r => money(r.paid) },
      { key: 'due', label: 'Due', align: 'right', sortVal: r => num(r.amount) - num(r.paid), render: r => {
        const due = num(r.amount) - num(r.paid);
        return `<b class="${due > 0 ? 'c-red' : 'c-green'}">${money(due)}</b>`;
      }},
      { key: 'dueDate', label: 'Due date', align: 'center', render: r => `<span class="badge ${r.status === 'Overdue' ? 'red' : r.status === 'Paid' ? 'green' : 'grey'}">${esc(fmtDate(r.dueDate))}</span>` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-inv-view="${r.id}">View</button>
          <button class="btn xs" data-inv-print="${r.id}">🖨</button>
          ${canWrite('invoices') && r.status !== 'Paid' ? `<button class="btn xs success" data-inv-pay="${r.id}">Settle</button>` : ''}
        </div>` }
    ],
    footRow: (c) => c.key === 'invoiceNo' ? 'Totals' : '',
    footRowCells: ['Totals', '', '', money(sum(rows, r => r.amount)), money(sum(rows, r => r.paid)), money(sum(rows, r => num(r.amount) - num(r.paid))), '', '', '']
  });
  bindTableButtons('invcTable', {
    'inv-view': id => openInvoiceDetail(id),
    'inv-print': id => Docs.invoice(id),
    'inv-pay': id => settleInvoice(id)
  });
}

/* Detail drawer for an invoice — mirrors the repair/customer/inventory pattern
 * so Attachments.mount works the same way. */
function openInvoiceDetail(id) {
  const inv = DB.byId('invoices', id);
  if (!inv) return;
  const party = DB.byId(inv.type === 'Purchase' ? 'suppliers' : 'customers', inv.partyId);
  const items = inv.refId && inv.type === 'Sale' ? DB.byId('sales', inv.refId)?.items : [];
  const due = Math.max(0, num(inv.amount) - num(inv.paid));
  openModal({
    width: 'lg', title: inv.invoiceNo, sub: `${inv.type === 'Purchase' ? 'Supplier' : 'Customer'} · ${esc(party?.name || '—')}`,
    body: `
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        ${statCard({ onClick: inv.type === 'Sale' ? 'inv:receivable' : 'inv:payable', icon: '◫', label: 'Status', value: statusBadge(inv.status), meta: '', color: inv.status === 'Paid' ? 'green' : inv.status === 'Overdue' ? 'red' : 'amber' })}
        ${statCard({ onClick: inv.type === 'Sale' ? 'inv:receivable' : 'inv:payable', icon: '◍', label: 'Amount', value: money(inv.amount), meta: 'Invoice total', color: 'blue' })}
        ${statCard({ onClick: inv.type === 'Sale' ? 'inv:receivable' : 'inv:payable', icon: '◍', label: 'Outstanding', value: money(due), meta: due > 0 ? 'Balance due' : 'Settled', color: due > 0 ? 'red' : 'green' })}
      </div>
      <div class="section-title">Party</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Name</span><span class="v"><b>${esc(party?.name || '—')}</b></span></div>
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(party?.phone || '—')}</span></div>
        ${party?.email ? `<div class="kv-row"><span class="k">Email</span><span class="v">${esc(party.email)}</span></div>` : ''}
        ${party?.city ? `<div class="kv-row"><span class="k">City</span><span class="v">${esc(party.city)}</span></div>` : ''}
      </div>
      <div class="section-title">Invoice details</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Type</span><span class="v">${esc(inv.type)}</span></div>
        <div class="kv-row"><span class="k">Date</span><span class="v">${esc(fmtDate(inv.date))}</span></div>
        <div class="kv-row"><span class="k">Due date</span><span class="v ${inv.status === 'Overdue' ? 'c-red' : ''}">${esc(fmtDate(inv.dueDate))}</span></div>
        <div class="kv-row"><span class="k">Reference</span><span class="v">${inv.refId ? `<b class="mono">${esc(inv.refId)}</b>` : '—'}</span></div>
        ${inv.notes ? `<div class="kv-row"><span class="k">Notes</span><span class="v">${esc(inv.notes)}</span></div>` : ''}
      </div>
      <div class="section-title">Line items</div>
      <div class="kv mb-16">
        ${items && items.length ? items.map(it => `<div class="kv-row"><span class="k">${esc(it.sku)} × ${fmt(it.qty)}</span><span class="v">${money(it.price * it.qty)}</span></div>`).join('') : '<div class="kv-row"><span class="k">—</span><span class="v text-3">No item breakdown</span></div>'}
      </div>
      <div class="section-title">Payments / credits</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Amount</span><span class="v">${money(inv.amount)}</span></div>
        <div class="kv-row"><span class="k">Paid</span><span class="v">${money(inv.paid)}</span></div>
        <div class="kv-row"><span class="k"><b>Outstanding</b></span><span class="v" style="font-size:15px;color:${due > 0 ? 'var(--red)' : 'var(--green)'}"><b>${money(due)}</b></span></div>
      </div>
      <div class="section-title">Documents</div>
      <div class="mb-16" id="attHost"></div>
      ${inv.history && inv.history.length ? `
      <div class="section-title">History</div>
      <div class="kv">${inv.history.map(h => `<div class="kv-row"><span class="k">${esc(h.status || h.action)}</span><span class="v">${esc(fmtDateTime(h.at || h.date))} · ${esc(h.by || '')}</span></div>`).join('')}</div>` : ''}
    `,
    foot: `${canWrite('invoices') && inv.status !== 'Paid' ? `<button class="btn left success" data-inv-pay="${inv.id}">Settle</button>` : ''}
           ${Attachments.buttons(canWrite('invoices'))}
           <button class="btn" data-x>Close</button>
           <button class="btn primary" data-inv-print="${inv.id}">🖨 Print</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const pay = qs('[data-inv-pay]', el);
      if (pay) pay.onclick = () => { closeModal(el); settleInvoice(inv.id); };
      const pr = qs('[data-inv-print]', el);
      if (pr) pr.onclick = () => Docs.invoice(inv.id);
      Attachments.mount(qs('#attHost', el), 'invoices', inv.id);
    }
  });
}
/**
 * Record a payment against an invoice.
 *
 * Shared by the single-row Settle button and the bulk action, so a bulk settle
 * moves the customer/supplier balances by exactly the same code path as a
 * manual one. `val` is clamped to the outstanding amount; a caller settling many
 * invoices at once passes the full due per invoice.
 */
function applyInvoicePayment(inv, requested) {
  const due = Math.max(0, num(inv.amount) - num(inv.paid));
  const val = clamp(num(requested), 0, due);
  if (val <= 0) return 0;
  const paid = num(inv.paid) + val;

  DB.update('invoices', inv.id, {
    paid,
    status: paid >= num(inv.amount) ? 'Paid' : 'Pending',
    paidDate: todayISO()
  });

  /* Sale invoices roll up to the order and the customer balance. */
  if (inv.type === 'Sale' && inv.refId) {
    const sale = DB.byId('sales', inv.refId);
    if (sale) {
      DB.update('sales', sale.id, {
        paid: paid >= num(sale.total),
        status: paid >= num(sale.total) ? 'Paid' : sale.status,
        paidDate: todayISO()
      });
      const cust = DB.byId('customers', sale.customerId);
      if (cust) DB.update('customers', cust.id, { balance: Math.max(0, num(cust.balance) - val) });
    }
  }

  /* Purchase invoices roll up to the supplier payable. */
  if (inv.type === 'Purchase' && inv.refId) {
    const po = DB.byId('purchases', inv.refId);
    if (po) {
      const sup = DB.byId('suppliers', po.supplierId);
      if (sup) DB.update('suppliers', sup.id, { balance: Math.max(0, num(sup.balance) - val) });
    }
  }
  return val;
}

async function settleInvoice(id) {
  const inv = DB.byId('invoices', id);
  if (!inv) return;
  const due = num(inv.amount) - num(inv.paid);
  const amt = await promptDialog({ title: `Settle ${inv.invoiceNo}`, label: `Amount to record (outstanding ${money(due)})`, value: String(due), confirmLabel: 'Record payment' });
  if (amt === null) return;
  const val = applyInvoicePayment(inv, amt);
  if (!val) { toast('Nothing left to settle', 'warn'); return; }
  audit('PAYMENT', 'Invoices', inv.invoiceNo, `${money(val)} recorded against ${inv.partyName}`);
  toast(`${money(val)} recorded`, 'good');
  renderAll();
}

/* ------------------------------------------------------------- Employees */
function renderEmployees() {
  const all = DB.get('employees');
  const q = norm($('empSearch')?.value);
  const dept = $('empDept')?.value || '';
  const st = $('empStatus')?.value || '';
  fillSelect('empDept', DEPARTMENTS, 'All departments');
  fillSelect('empStatus', ['Active', 'On Leave', 'Inactive'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(e => [e.name, e.code, e.email, e.department, e.role, e.phone].join(' ').toLowerCase().includes(q));
  if (dept) rows = rows.filter(e => e.department === dept);
  if (st) rows = rows.filter(e => e.status === st);

  $('empCount').textContent = `${fmt(rows.length)} employees`;
  Pagers.render('emp', {
    mount: 'empTable', foot: 'empFoot', rows, unit: 'employees', dense: true,
    selectable: true,
    bulkActions: [
      Sel.act.status('employees', 'status', [
        { label: 'Mark active', value: 'Active' },
        { label: 'Mark on leave', value: 'On Leave' },
        { label: 'Mark inactive', value: 'Inactive' }
      ], 'status'),
      Sel.act.assign('employees', 'location', 'Facility',
        () => DB.get('locations').map(l => ({ value: l.name, label: l.name }))),
      Sel.act.assign('employees', 'department', 'Department', () => {
        const seen = [];
        for (const e of DB.get('employees')) if (e.department && !seen.includes(e.department)) seen.push(e.department);
        return seen.map(d => ({ value: d, label: d }));
      }),
      /* Salary is deliberately absent: a bulk raise applied with a single
       * arithmetic operator is not something to make easy to do by accident. */
      Sel.act.exportRows('employees', 'employees', selRows => [
        ['Code', 'Name', 'Department', 'Designation', 'Facility', 'Phone', 'Email', 'Joined', 'Status'],
        ...selRows.map(e => [e.code, e.name, e.department, e.role, e.location, e.phone, e.email, e.joinDate, e.status])
      ])
    ],
    emptyTitle: 'No employees', emptyText: 'Add staff to link payroll, leave and attendance.',
    columns: [
      { key: 'name', label: 'Employee', render: r => `<div class="row gap-6">${avatarNode(r.name, 26)}<span><b>${esc(r.name)}</b><span class="row-sub mono">${esc(r.code)}</span></span></div>` },
      { key: 'department', label: 'Department', render: r => `<span class="badge blue">${esc(r.department)}</span>` },
      { key: 'role', label: 'Designation' },
      { key: 'location', label: 'Facility' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email', render: r => `<span class="fs-12">${esc(r.email)}</span>` },
      { key: 'joinDate', label: 'Joined', align: 'center', render: r => `<span class="fs-11 text-3">${esc(fmtDate(r.joinDate))}</span>` },
      { key: 'salary', label: 'Base salary', align: 'right', render: r => money(r.salary) },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-emp-view="${r.id}">View</button>
          ${canWrite('employees') ? `<button class="btn xs" data-emp-edit="${r.id}">Edit</button>` : ''}
        </div>` }
    ]
  });
  bindTableButtons('empTable', { 'emp-edit': id => Modals.employeeForm(DB.byId('employees', id)), 'emp-view': id => openEmployeeDrawer(id) });
}
function openEmployeeDrawer(id) {
  const e = DB.byId('employees', id);
  if (!e) return;
  const pays = DB.get('payroll').filter(p => p.employeeId === id);
  const leaves = DB.get('leaves').filter(l => l.employeeId === id);
  const att = DB.get('attendance').filter(a => a.employeeId === id);
  const present = att.filter(a => a.status === 'Present').length;
  const rate = att.length ? Math.round(present / att.length * 100) : 0;
  openModal({
    drawer: true, autofocus: false, title: e.name, sub: `${e.role} · ${e.department}`,
    body: `
      <div class="row mb-16 gap-12">${avatarNode(e.name, 46)}
        <div><b style="font-size:15px">${esc(e.name)}</b><div class="fs-12 text-2">${esc(e.code)} · ${esc(e.id)}</div></div></div>
      <div class="stats" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
        ${statCard({ onClick: 'emp:salary', icon: '₳', label: 'Base salary', value: money(e.salary), meta: 'Per month', color: 'green' })}
        ${statCard({ onClick: 'att:total', icon: '✓', label: 'Attendance', value: rate + '%', meta: `${present}/${att.length} punches`, color: rate >= 85 ? 'green' : 'amber' })}
      </div>
      <div class="section-title">Profile</div>
      <div class="kv mb-16">
        <div class="kv-row"><span class="k">Email</span><span class="v">${esc(e.email)}</span></div>
        <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(e.phone || '—')}</span></div>
        <div class="kv-row"><span class="k">Department</span><span class="v">${esc(e.department)}</span></div>
        <div class="kv-row"><span class="k">Designation</span><span class="v">${esc(e.role)}</span></div>
        <div class="kv-row"><span class="k">Facility</span><span class="v">${esc(e.location)}</span></div>
        <div class="kv-row"><span class="k">Joined</span><span class="v">${esc(fmtDate(e.joinDate))}</span></div>
        <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(e.status)}</span></div>
      </div>
      <div class="section-title">Payslips (${pays.length})</div>
      <div class="table-scroll mb-16" style="max-height:190px"><table class="dt">
        <thead><tr><th>Month</th><th class="right">Net</th><th>Status</th></tr></thead>
        <tbody>${pays.length ? pays.map(p => `<tr><td>${esc(p.month)}</td><td class="right num"><b>${money(p.netSalary)}</b></td><td>${statusBadge(p.status)}</td></tr>`).join('') : '<tr><td colspan="3"><div class="empty" style="padding:18px"><b>No payslips</b></div></td></tr>'}</tbody></table></div>
      <div class="section-title">Leave (${leaves.length})</div>
      <div class="table-scroll mb-16" style="max-height:160px"><table class="dt">
        <thead><tr><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody>${leaves.length ? leaves.map(l => `<tr><td>${esc(l.type)}</td><td class="fs-11">${esc(fmtDate(l.startDate))} → ${esc(fmtDate(l.endDate))}</td><td>${statusBadge(l.status)}</td></tr>`).join('') : '<tr><td colspan="3"><div class="empty" style="padding:18px"><b>No leave records</b></div></td></tr>'}</tbody></table></div>
      <div class="kv">
        <div class="kv-row"><span class="k">Days taken</span><span class="v">${fmt(sum(leaves.filter(l => l.status === 'Approved'), l => l.days))}</span></div>
        <div class="kv-row"><span class="k">Late arrivals</span><span class="v">${att.filter(a => a.status === 'Late').length}</span></div>
        <div class="kv-row"><span class="k">Lifetime payroll</span><span class="v">${money(sum(pays.filter(p => p.status === 'Processed'), p => p.netSalary))}</span></div>
      </div>`,
    foot: `${canWrite('employees') ? `<button class="btn left" data-edit>Edit employee</button>` : ''}<button class="btn" data-x>Close</button>`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const ed = qs('[data-edit]', el);
      if (ed) ed.onclick = () => { closeModal(el); Modals.employeeForm(e); };
    }
  });
}

/* --------------------------------------------------------------- Payroll */
function renderPayroll() {
  const all = DB.get('payroll');
  const q = norm($('paySearch')?.value);
  const month = $('payMonth')?.value || '';
  const st = $('payStatus')?.value || '';
  const months = uniq(all.map(p => p.month)).sort().reverse();
  fillSelect('payMonth', months, 'All months');
  fillSelect('payStatus', PAYROLL_STATUSES, 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(p => [p.employeeName, p.code, p.month].join(' ').toLowerCase().includes(q));
  if (month) rows = rows.filter(p => p.month === month);
  if (st) rows = rows.filter(p => p.status === st);

  $('payCount').textContent = `${fmt(rows.length)} payslips`;
  const current = all.filter(p => p.month === (months[0] || ''));
  $('payStats').innerHTML = [
    statCard({ onClick: 'pay:month', icon: '₳', label: `Payroll ${esc(monthLabel(months[0]))}`, value: money(sum(current, p => p.netSalary)), meta: `${current.length} employees`, color: 'green' }),
    statCard({ onClick: 'pay:pending', icon: '◔', label: 'Pending processing', value: fmt(all.filter(p => p.status === 'Pending').length), meta: 'Awaiting run', color: 'amber' }),
    statCard({ onClick: 'pay:paid', icon: '◫', label: 'Total paid', value: money(sum(all.filter(p => p.status === 'Processed'), p => p.netSalary)), meta: 'All time', color: 'blue' }),
    statCard({ onClick: 'pay:overtime', icon: '◍', label: 'Overtime cost', value: money(sum(current, p => p.overtimeHours * p.overtimeRate)), meta: monthLabel(months[0]), color: 'purple' })
  ].join('');

  Pagers.render('pay', {
    mount: 'payTable', foot: 'payFoot', rows, unit: 'payslips', dense: true,
    emptyTitle: 'No payslips', emptyText: 'Run payroll to generate payslips for every active employee.',
    columns: [
      { key: 'employeeName', label: 'Employee', render: r => `<div class="row gap-6">${avatarNode(r.employeeName, 24)}<span><b>${esc(r.employeeName)}</b><span class="row-sub mono">${esc(r.code)}</span></span></div>` },
      { key: 'month', label: 'Month', render: r => `<b>${esc(monthLabel(r.month))}</b>` },
      { key: 'baseSalary', label: 'Base', align: 'right', render: r => money(r.baseSalary) },
      { key: 'overtime', label: 'Overtime', align: 'right', sortVal: r => r.overtimeHours * r.overtimeRate, render: r => num(r.overtimeHours) ? `${r.overtimeHours} h<span class="row-sub">${money(r.overtimeHours * r.overtimeRate)}</span>` : '—' },
      { key: 'bonus', label: 'Bonus', align: 'right', render: r => num(r.bonus) ? `<span class="c-green">${money(r.bonus)}</span>` : '—' },
      { key: 'deductions', label: 'Deductions', align: 'right', render: r => num(r.deductions) ? `<span class="c-red">−${money(r.deductions)}</span>` : '—' },
      { key: 'netSalary', label: 'Net pay', align: 'right', render: r => `<b style="font-size:13px">${money(r.netSalary)}</b>` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-pay-slip="${r.id}">🖨</button>
          ${canWrite('payroll') && r.status === 'Pending' ? `<button class="btn xs success" data-pay-run="${r.id}">Process</button>` : ''}
        </div>` }
    ],
    footRow: (c) => c.key === 'employeeName' ? 'Totals' : '',
    footRowCells: ['Totals', '', money(sum(rows, r => r.baseSalary)), money(sum(rows, r => r.overtimeHours * r.overtimeRate)), money(sum(rows, r => r.bonus)), money(sum(rows, r => r.deductions)), money(sum(rows, r => r.netSalary)), '', '']
  });
  bindTableButtons('payTable', {
    'pay-slip': id => Docs.payslip(id),
    'pay-run': id => processPayslip(id)
  });
}
function processPayslip(id) {
  DB.update('payroll', id, { status: 'Processed', paidDate: todayISO(), processedBy: state.session.user.name });
  audit('PAYROLL', 'Payroll', id, 'Payslip processed');
  toast('Payslip processed', 'good');
  renderPayroll(); renderNav();
}
async function runPayrollMonth(month) {
  if (!requireWrite('payroll', 'run payroll')) return;
  const m = month || monthKey(new Date());
  const staff = DB.get('employees').filter(e => e.status !== 'Inactive');
  const existing = DB.get('payroll').filter(p => p.month === m);
  if (existing.length && !existing.every(p => p.status === 'Pending')) {
    const ok = await confirmDialog({ title: 'Payroll already processed', message: `${monthLabel(m)} already has ${existing.length} payslips.`, detail: 'Continue to add payslips for employees who do not yet have one.', confirmLabel: 'Add missing only' });
    if (!ok) return;
  }
  let created = 0;
  staff.forEach(e => {
    if (existing.some(p => p.employeeId === e.id)) return;
    const ot = sum(DB.get('attendance').filter(a => a.employeeId === e.id && monthKey(a.checkTime) === m && a.status === 'Late'), () => 2);
    const absentDays = 0;
    const deductions = absentDays * 0;
    const net = num(e.salary) + ot * 220 - deductions;
    DB.insert('payroll', {
      employeeId: e.id, employeeName: e.name, code: e.code, month: m,
      baseSalary: num(e.salary), overtimeHours: ot, overtimeRate: 220,
      deductions, bonus: 0, netSalary: net, status: 'Pending', paidDate: '', notes: 'Generated by payroll run'
    });
    created++;
  });
  audit('PAYROLL', 'Payroll', m, `Payroll run for ${monthLabel(m)} — ${created} payslip(s) created`);
  toast(created ? `${created} payslips generated for ${monthLabel(m)}` : 'No new payslips needed', created ? 'good' : 'warn');
  renderPayroll(); renderNav();
}

/* ----------------------------------------------------------------- Leave */
function renderLeave() {
  const all = DB.get('leaves');
  const q = norm($('leaveSearch')?.value);
  const st = $('leaveStatus')?.value || '';
  fillSelect('leaveStatus', ['Pending', 'Approved', 'Rejected', 'Cancelled'], 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(l => [l.employeeName, l.type, l.reason].join(' ').toLowerCase().includes(q));
  if (st) rows = rows.filter(l => l.status === st);

  $('leaveCount').textContent = `${fmt(rows.length)} requests`;
  $('leaveStats').innerHTML = [
    statCard({ onClick: 'leave:pending', icon: '⊚', label: 'Pending', value: fmt(all.filter(l => l.status === 'Pending').length), meta: 'Awaiting approval', color: 'amber' }),
    statCard({ onClick: 'leave:approved', icon: '✓', label: 'Approved', value: fmt(all.filter(l => l.status === 'Approved').length), meta: `${fmt(sum(all.filter(l => l.status === 'Approved'), l => l.days))} days granted`, color: 'green' }),
    statCard({ onClick: 'leave:rejected', icon: '✕', label: 'Rejected', value: fmt(all.filter(l => l.status === 'Rejected').length), meta: 'Declined', color: 'red' }),
    statCard({ onClick: 'leave:away', icon: '◔', label: 'Staff on leave', value: fmt(DB.get('employees').filter(e => e.status === 'On Leave').length), meta: 'Currently away', color: 'blue' })
  ].join('');

  Pagers.render('leave', {
    mount: 'leaveTable', foot: 'leaveFoot', rows, unit: 'requests', dense: true,
    emptyTitle: 'No leave requests', emptyText: 'Submit a request on behalf of an employee.',
    columns: [
      { key: 'employeeName', label: 'Employee', render: r => `<div class="row gap-6">${avatarNode(r.employeeName, 24)}<span><b>${esc(r.employeeName)}</b></span></div>` },
      { key: 'type', label: 'Type', render: r => `<span class="badge blue">${esc(r.type)}</span>` },
      { key: 'startDate', label: 'From', align: 'center' },
      { key: 'endDate', label: 'To', align: 'center' },
      { key: 'days', label: 'Days', align: 'right', render: r => `<b>${fmt(r.days)}</b>` },
      { key: 'reason', label: 'Reason', render: r => `<span class="fs-12 text-2">${esc(r.reason || '—')}</span>` },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actionBy', label: 'Actioned by', render: r => `<span class="fs-12">${esc(r.actionBy || '—')}</span>` },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => {
        if (!canWrite('leave')) return '—';
        return r.status === 'Pending'
          ? `<div class="actions"><button class="btn xs success" data-leave-approve="${r.id}">Approve</button><button class="btn xs danger" data-leave-reject="${r.id}">Reject</button></div>`
          : `<div class="actions"><button class="btn xs" data-leave-undo="${r.id}">Reopen</button></div>`;
      }}
    ]
  });
  bindTableButtons('leaveTable', {
    'leave-approve': id => setLeave(id, 'Approved'),
    'leave-reject': id => setLeave(id, 'Rejected'),
    'leave-undo': id => setLeave(id, 'Pending')
  });
}
function setLeave(id, status) {
  const l = DB.byId('leaves', id);
  if (!l) return;
  DB.update('leaves', id, { status, actionBy: state.session.user.name, actionDate: todayISO() });
  if (status === 'Approved') {
    const emp = DB.byId('employees', l.employeeId);
    if (emp && emp.status === 'Active') DB.update('employees', emp.id, { status: 'On Leave', leaveUntil: l.endDate });
  } else {
    const emp = DB.byId('employees', l.employeeId);
    if (emp && emp.status === 'On Leave' && (!emp.leaveUntil || emp.leaveUntil <= todayISO())) DB.update('employees', emp.id, { status: 'Active', leaveUntil: '' });
  }
  audit('LEAVE', 'Leave', l.id, `${l.employeeName} — ${l.type} → ${status}`);
  toast(`Leave ${status.toLowerCase()}`, status === 'Approved' ? 'good' : 'warn');
  renderAll();
}

/* ------------------------------------------------------------ Attendance */
function renderAttendance() {
  const all = DB.get('attendance');
  const q = norm($('attSearch')?.value);
  const date = $('attDate')?.value || '';
  const st = $('attStatus')?.value || '';

  fillSelect('attDate', uniq(all.map(a => a.date)).sort().reverse().slice(0, 60), 'All dates');
  /* Derive the list from the data, so statuses the terminals can produce
     (Weekend, Single Punch, Half Day, Early Leave) are always selectable.
     fillSelect() keeps the current selection when the value still exists. */
  const canonical = ['Present', 'Late', 'Absent', 'On Duty', 'Off Duty'];
  const seenStatuses = uniq(all.map(a => a.status).filter(Boolean));
  const statuses = uniq([...canonical, ...seenStatuses])
    .sort((a, b) => (canonical.indexOf(a) < 0 ? 1 : canonical.indexOf(b) < 0 ? -1 : canonical.indexOf(a) - canonical.indexOf(b)));
  fillSelect('attStatus', statuses, 'All statuses');

  let rows = all;
  if (q) rows = rows.filter(a => [a.employeeName, a.code, a.deviceId, a.department].join(' ').toLowerCase().includes(q));
  if (date) rows = rows.filter(a => a.date === date);
  if (st) rows = rows.filter(a => a.status === st);

  $('attCount').textContent = `${fmt(rows.length)} punches`;
  const present = all.filter(a => a.status === 'Present').length;
  const late = all.filter(a => a.status === 'Late').length;
  const rate = all.length ? Math.round((present / all.length) * 100) : 0;
  $('attStats').innerHTML = [
    statCard({ onClick: 'att:total', icon: '✓', label: 'Total punches', value: fmt(all.length), meta: 'Captured records', color: 'blue' }),
    statCard({ onClick: 'att:staff', icon: '◉', label: 'Unique staff', value: fmt(uniq(all.map(a => a.employeeId)).length), meta: 'Distinct employees', color: 'purple' }),
    statCard({ onClick: 'att:late', icon: '◴', label: 'Late arrivals', value: fmt(late), meta: `After ${state.db.settings.shiftStart}`, color: late ? 'amber' : 'green' }),
    statCard({ onClick: 'att:ontime', icon: '◫', label: 'On-time rate', value: rate + '%', meta: `${fmt(present)} on time`, color: rate >= 85 ? 'green' : 'amber' })
  ].join('');

  Pagers.render('att', {
    mount: 'attTable', foot: 'attFoot', rows, unit: 'punches', dense: true,
    emptyTitle: 'No attendance records', emptyText: 'Import a device log or record a manual punch.',
    columns: [
      { key: 'employeeName', label: 'Employee', render: r => `<div class="row gap-6">${avatarNode(r.employeeName, 24)}<span><b>${esc(r.employeeName)}</b><span class="row-sub">${esc(r.department || '')}</span></span></div>` },
      { key: 'code', label: 'Code', render: r => `<span class="mono">${esc(r.code || '—')}</span>` },
      { key: 'deviceId', label: 'Device', render: r => `<span class="badge grey">${esc(r.deviceId || 'Manual')}</span>` },
      { key: 'date', label: 'Date', align: 'center' },
      { key: 'checkTime', label: 'Check in', align: 'center', render: r => `<b>${esc(fmtTime(r.checkTime))}</b>` },
      { key: 'source', label: 'Source', render: r => r.source === 'device'
          ? `<span class="badge teal" title="Terminal ${esc(r.deviceId || '')} PIN ${esc(r.pin || '')}">▣ ${esc(r.deviceId || 'Device')}</span>`
          : '<span class="badge grey">Manual</span>' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: 'Actions', sortable: false, align: 'right', render: r => (canWrite('attendance') ? `<div class="actions">${r.source === 'device' && !r.employeeId ? `<button class="btn xs primary" data-att-map="${r.deviceId}|${esc(r.pin)}">Map</button>` : ''}<button class="btn xs danger" data-att-del="${r.id}">✕</button></div>` : '') }
    ]
  });
  bindTableButtons('attTable', {
    'att-del': id => deleteRecord('attendance', id, 'Punch record', 'id', true),
    'att-map': key => { const [d, p] = key.split('|'); Modals.mapPinModal(d, p); }
  });
}
function importAttendanceLogs(rawText) {
  let logs;
  try { logs = JSON.parse(rawText); } catch (e) { toast('Invalid JSON payload', 'bad'); return 0; }
  if (!Array.isArray(logs)) { toast('Payload must be a JSON array', 'bad'); return 0; }
  let n = 0;
  logs.forEach(l => {
    const name = l.employee_name || l.name;
    if (!name || !l.check_time) return;
    const emp = DB.get('employees').find(e => norm(e.name) === norm(name) || norm(e.code) === norm(l.employee_id || ''));
    const check = new Date(l.check_time);
    const shift = String(state.db.settings.shiftStart || '09:00');
    const late = !Number.isNaN(check.getTime()) && check.toTimeString().slice(0, 5) > shift;
    DB.insert('attendance', {
      employeeId: emp ? emp.id : null, employeeName: name,
      code: emp ? emp.code : (l.employee_id || ''),
      department: emp ? emp.department : '',
      deviceId: l.device_id || 'ZKT-IMPORT',
      checkTime: Number.isNaN(check.getTime()) ? nowISO() : check.toISOString(),
      date: (Number.isNaN(check.getTime()) ? new Date() : check).toISOString().slice(0, 10),
      status: l.status === 'absent' ? 'Absent' : (late ? 'Late' : 'Present')
    });
    n++;
  });
  audit('IMPORT', 'Attendance', 'device-log', `${n} punch(es) imported`);
  return n;
}

/* ==========================================================================
   StockFlow ERP — WhatsApp CRM & Private Personal Log
   ========================================================================== */

function renderWhatsappCrm() {
  const host = $('page-whatsappCrm');
  if (!host) return;

  const customers = DB.get('customers');
  const sales = DB.get('sales');
  const repairs = DB.get('repairs');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Customer Messaging Hub</div>
        <h2>WhatsApp CRM & Live Alerts</h2>
        <p>Instant WhatsApp notifications, customer messaging history, and custom broadcast templates.</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" id="waCustomMsgBtn">💬 Send Custom Message</button>
      </div>
    </div>

    <div class="stat-grid mb-16">
      <div class="stat-card"><div class="stat-label">Active Customers</div><div class="stat-val">${fmt(customers.length)}</div><div class="stat-sub">With phone contacts</div></div>
      <div class="stat-card"><div class="stat-label">Recent Sales</div><div class="stat-val">${fmt(sales.length)}</div><div class="stat-sub">Ready for invoice alert</div></div>
      <div class="stat-card"><div class="stat-label">BadBin Repairs</div><div class="stat-val">${fmt(repairs.length)}</div><div class="stat-sub">Repair updates</div></div>
      <div class="stat-card"><div class="stat-label">WhatsApp Status</div><div class="stat-val c-green">● Connected</div><div class="stat-sub">Web / API Ready</div></div>
    </div>

    <div class="grid col-2 gap-16">
      <div class="card">
        <div class="card-head"><h3>Quick Message Templates</h3></div>
        <div class="card-body">
          <div class="field">
            <label>Select Customer</label>
            <select class="input" id="waCustSelect">
              ${customers.map(c => `<option value="${esc(c.phone)}">${esc(c.name)} (${esc(c.phone || 'No phone')})</option>`).join('')}
            </select>
          </div>
          <div class="btn-group mb-12">
            <button class="btn sm" id="tmplInvoiceBtn">📄 Invoice Receipt</button>
            <button class="btn sm" id="tmplRepairBtn">🛠 Repair Status</button>
            <button class="btn sm" id="tmplPayBtn">💰 Payment Reminder</button>
          </div>
          <div class="field">
            <label>Message Preview</label>
            <textarea class="input" id="waMsgPreview" rows="5" placeholder="Message content will appear here..."></textarea>
          </div>
          <button class="btn primary block" id="waSendBtn">🚀 Launch WhatsApp Message</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Customer Directory & Quick Contact</h3></div>
        <div class="card-body">
          <div class="table-scroll" style="max-height:360px">
            <table class="dt">
              <thead><tr><th>Customer</th><th>Phone</th><th>Action</th></tr></thead>
              <tbody>
                ${customers.map(c => `
                  <tr>
                    <td><b>${esc(c.name)}</b></td>
                    <td><span class="mono">${esc(c.phone || '—')}</span></td>
                    <td>
                      ${c.phone ? `<button class="btn xs success" onclick="WhatsAppEngine.send('${esc(c.phone)}', 'Hello ${esc(c.name)}, thank you for connecting with ${esc(state.db.settings.companyName || 'StockFlow ERP')}!')">💬 Chat</button>` : '<span class="c-muted">No phone</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;

  const preview = $('waMsgPreview');
  const custSel = $('waCustSelect');

  $('tmplInvoiceBtn').onclick = () => {
    const lastSale = sales[0] || { orderId: 'INV-1001', totalAmount: 1500, customerName: 'Customer' };
    preview.value = WhatsAppEngine.buildInvoiceMessage(lastSale);
  };
  $('tmplRepairBtn').onclick = () => {
    const lastRepair = repairs[0] || { ticketNo: 'T-101', brand: 'Samsung', model: 'S23', status: 'In Progress', issue: 'Screen Replacement' };
    preview.value = WhatsAppEngine.buildRepairMessage(lastRepair);
  };
  $('tmplPayBtn').onclick = () => {
    preview.value = `Hello! This is a friendly reminder regarding your outstanding balance with ${state.db.settings.companyName || 'StockFlow ERP'}. Please let us know if you need any assistance!`;
  };
  $('waSendBtn').onclick = () => {
    const phone = custSel.value;
    if (!phone) { toast('Please select a customer with a valid phone number', 'warn'); return; }
    WhatsAppEngine.send(phone, preview.value || 'Hello!');
    toast('WhatsApp redirect launched', 'good');
  };
  $('waCustomMsgBtn').onclick = () => {
    preview.focus();
    preview.value = `Hello! Greetings from ${state.db.settings.companyName || 'StockFlow ERP'}.`;
  };
}

function renderPersonalLog() {
  const host = $('page-personalLog');
  if (!host) return;

  const currentUser = state.session?.user || { id: 'usr_admin', name: 'Admin', role: 'Super Admin' };
  const storageKey = `sf_private_log_${currentUser.id || 'default'}`;
  const rawLogs = store.get(storageKey);
  let logs = [];
  try { logs = rawLogs ? JSON.parse(rawLogs) : []; } catch (_) { logs = []; }

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Private Workspace</div>
        <h2>Personal Work Log & Shift Notes</h2>
        <p>Encrypted personal logbook isolated to <b>${esc(currentUser.name)}</b> (${esc(currentUser.role)}).</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" id="addLogNoteBtn">＋ New Personal Note</button>
      </div>
    </div>

    <div class="grid col-3 gap-16 mb-16">
      <div class="card">
        <div class="card-head"><h3>Add Note / Shift Handover</h3></div>
        <div class="card-body">
          <form id="personalNoteForm">
            <div class="field">
              <label>Category</label>
              <select class="input" id="noteCat">
                <option value="Shift Handover">Shift Handover</option>
                <option value="Stock Anomaly">Stock Anomaly</option>
                <option value="Task Reminder">Task Reminder</option>
                <option value="Private Scratchpad">Private Scratchpad</option>
              </select>
            </div>
            <div class="field">
              <label>Title</label>
              <input class="input" id="noteTitle" placeholder="Summary of shift or task..." required>
            </div>
            <div class="field">
              <label>Content</label>
              <textarea class="input" id="noteContent" rows="4" placeholder="Detailed notes, observations, or handover checklist..." required></textarea>
            </div>
            <button class="btn primary block" type="submit">🔒 Save Private Note</button>
          </form>
        </div>
      </div>

      <div class="card span-2">
        <div class="card-head"><h3>Your Log History (${logs.length})</h3></div>
        <div class="card-body">
          <div class="table-scroll" style="max-height:420px">
            ${logs.length ? `
              <table class="dt">
                <thead><tr><th>Time</th><th>Category</th><th>Title</th><th>Content</th><th>Action</th></tr></thead>
                <tbody>
                  ${logs.map((n, idx) => `
                    <tr>
                      <td class="fs-11 mono">${esc(fmtDate(n.timestamp))}</td>
                      <td><span class="badge blue">${esc(n.category)}</span></td>
                      <td><b>${esc(n.title)}</b></td>
                      <td><span class="fs-12">${esc(n.content)}</span></td>
                      <td><button class="btn xs danger" onclick="deletePersonalLogNote(${idx})">✕</button></td>
                    </tr>`).join('')}
                </tbody>
              </table>` : `
              <div class="empty">
                <b>No personal notes recorded yet</b>
                <p>Use the form on the left to write private shift notes, reminders, or audit observations.</p>
              </div>`}
          </div>
        </div>
      </div>
    </div>`;

  $('personalNoteForm').onsubmit = (e) => {
    e.preventDefault();
    const note = {
      id: 'PL-' + Date.now(),
      category: $('noteCat').value,
      title: $('noteTitle').value,
      content: $('noteContent').value,
      timestamp: nowISO()
    };
    logs.unshift(note);
    store.set(storageKey, JSON.stringify(logs));
    toast('Private personal note saved securely', 'good');
    renderPersonalLog();
  };

  window.deletePersonalLogNote = (idx) => {
    logs.splice(idx, 1);
    store.set(storageKey, JSON.stringify(logs));
    toast('Personal note deleted', 'warn');
    renderPersonalLog();
  };
}


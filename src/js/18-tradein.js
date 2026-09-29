/* ==========================================================================
   AMAYA ERP — Trade-in / Upgrade desk
   ----------------------------------------------------------------------------
   The feature a phone distributor actually needs and a stock ledger does not
   have: a customer walks in with an old handset, wants a new one, and expects
   the old one's value to come off the price.

   The model is deliberately one record with two halves, because that is what
   the business is:

     incoming half  - the customer's old device: what it is, what condition,
                      what we will pay for it, and where it physically is.
     outgoing half  - the new device: which stock line, at what price.

   Money, stated once so there is only one implementation:

       newGross      = newPrice
       credit        = agreed trade-in value
       payable       = max(0, newGross - credit)      <- what the customer owes
       refundDue     = max(0, credit - newGross)      <- cash back to customer
       margin        = newGross - newCost - (credit > newGross ? refundDue : 0)

   The margin line is the one worth staring at. Handing over a ৳20,000 device
   against a ৳45,000 phone is not a ৳20,000 margin - it is a ৳20,000 margin
   MINUS whatever the incoming device is worth to us on its own, because that
   value is real and is sitting in the workshop. `incomingWorth` records that
   so the desk cannot accidentally book a loss as a profit. When the old device
   is received into stock it is booked at `incomingWorth`, and the difference
   between `credit` and `incomingWorth` is the honest margin on the trade.

   Required constants: TRADE_GRADES, TRADE_CONDITION, and the `upgrades`
   collection. Defined in 01-core.js.
   ========================================================================= */

/* ------------------------------------------------------------- Valuation */
const Trade = {
  /**
   * Suggested trade-in value.
   *
   * Anchored on a fraction of the catalogue retail price for that model, so
   * the number moves with the market the business already tracks, then
   * adjusted for condition. Every factor is explicit and overridable on the
   * record - the desk can always override `credit`, and the suggestion is only
   * ever a starting point.
   */
  suggest(model, grade = 'B', opts = {}) {
    const item = DB.get('items').find(i => norm(i.model) === norm(model) || norm(i.sku) === norm(model));
    const retail = num(opts.retail != null ? opts.retail : (item ? item.price : 0));
    /* No catalogue match and no price given: refuse to invent a number.
     * A wrong suggestion is worse than none, because it gets agreed to. */
    if (!retail) return 0;

    const g = TRADE_GRADE_FACTOR[grade] != null ? TRADE_GRADE_FACTOR[grade] : 0.5;
    const working = opts.working === false ? 0.35 : 1;   // dead board is scrap
    const accessory = opts.accessories ? 1.05 : 1;

    /* Rounded to the nearest 50 so the figure looks like a price, not a
     * spreadsheet output. */
    const raw = retail * g * working * accessory;
    return Math.max(0, Math.round(raw / 50) * 50);
  },

  /** What the incoming device is worth to AMAYA Industries on its own merits. */
  incomingWorth(u) {
    const dead = u.condition === 'Dead' && num(u.incomingQty) <= 0;
    /* A dead board is parts value only, and its worth comes from the stated
     * value rather than the catalogue, because a scrap handset is not a
     * product anybody is about to sell. */
    if (dead) return Math.max(0, Math.round(num(u.oldValue) * 0.15 / 50) * 50);

    /* A working handset with a clean IMEI goes back into saleable stock at a
     * refurb discount, so its worth is anchored on the market - the catalogue
     * retail for that model, adjusted for condition.
     *
     * The fallback matters and used to be missing. `suggest` deliberately
     * returns 0 for a model it cannot find, which is right when the desk is
     * asking "what is this worth" with nothing else to go on. It was wrong
     * here, because the record always carries the value the customer was
     * quoted, and the result was that a WORKING phone whose model was not in
     * the catalogue - a trade-in for something the shop does not stock, which
     * is the ordinary case - was booked at zero while a dead board in the same
     * condition was valued off that number. The desk then showed a healthy
     * trade gap on a device sitting in the workshop. So: catalogue first,
     * stated value second, and never zero while we have a number to work from. */
    const suggested = Trade.suggest(u.oldModel, num(u.incomingQty) > 0 ? 'A' : 'C');
    if (suggested > 0) return suggested;
    const factor = num(u.incomingQty) > 0 ? TRADE_GRADE_FACTOR.A : TRADE_GRADE_FACTOR.C;
    return Math.max(0, Math.round(num(u.oldValue) * factor / 50) * 50);
  },

  /** Recompute and persist every derived money field. */
  recalc(u) {
    const newPrice = num(u.newPrice);
    const credit = num(u.credit);
    const newCost = num(u.newCost);
    const refundDue = Math.max(0, credit - newPrice);
    u.newGross = newPrice;
    u.creditValue = credit;
    u.payable = Math.max(0, newPrice - credit);
    u.refundDue = refundDue;
    u.margin = newPrice - newCost - refundDue;
    u.incomingWorth = Trade.incomingWorth(u);
    u.tradeGap = credit - u.incomingWorth;
    return u;
  }
};

const TRADE_CONDITION = [
  { id: 'Working',    hint: 'Boots, no fault' },
  { id: 'Faulty',     hint: 'Powers on, needs repair' },
  { id: 'Dead',       hint: 'Does not power on' },
  { id: 'Water',      hint: 'Liquid damage' }
];

/* Fraction of catalogue retail for a given grade. Deliberately conservative:
 * a distributor that over-values trade-ins loses money on every exchange. */
const TRADE_GRADE_FACTOR = {
  A: 0.55,   // unboxed, near new, full working
  B: 0.40,   // working, light wear
  C: 0.22,   // visible wear or a minor fault
  D: 0.10    // parts / scrap only
};
const TRADE_GRADES = Object.keys(TRADE_GRADE_FACTOR);

/* -------------------------------------------------------------- Lifecycle */
/* Valued -> Agreed -> New device issued -> Old device received -> Closed */
const TRADE_STAGES = ['Valued', 'Agreed', 'Issued', 'Received', 'Closed', 'Cancelled'];
const OPEN_TRADE_STAGES = ['Valued', 'Agreed', 'Issued', 'Received'];

function newTradeRef() {
  return nextNumber('TRD', DB.get('upgrades'), 'ref', 4);
}

/**
 * Create or update a trade-in record.
 *
 * Writing is deliberately a single function so that the money fields, the
 * stock movement and the invoice can never be produced out of step.
 */
function saveTrade(u) {
  Trade.recalc(u);
  if (!u.id) {
    u.id = uid('UPG');
    u.ref = newTradeRef();
    u.date = u.date || todayISO();
    u.createdAt = nowISO();
    u.user = state.session ? state.session.user.name : 'System';
  }
  u.updatedAt = nowISO();
  DB.insert('upgrades', u);
  audit(u.status === 'Cancelled' ? 'CANCEL' : 'UPSAVE', 'Trade-in', u.ref,
    `${u.customerName || 'Walk-in'} — ${u.oldModel || '?'} → ${u.newModel || '?'} · credit ${money(u.credit)} · payable ${money(u.payable)}`);
  return u;
}

/**
 * Issue the new device against the trade.
 *
 * This is the point where money and stock both move, so it is written once:
 *   - deducts the outgoing stock
 *   - writes an OUT movement for the ledger
 *   - writes the receivable invoice for the payable amount
 *   - advances the stage
 */
function issueUpgrade(id) {
  const u = DB.byId('upgrades', id);
  if (!u) return null;
  if (!requireWrite('upgrades', 'issue upgraded devices')) return null;

  const line = u.newLineId ? DB.byId('inventory', u.newLineId) : null;
  if (line) {
    if (inHand(line) < 1 && !state.db.settings.allowNegative) {
      toast(`Only ${fmt(inHand(line))} × ${line.sku} available`, 'bad');
      return null;
    }
    bumpLine(line, 'soldQty', 1);
  }
  const trxRef = `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`;
  DB.insert('movements', {
    trxRef, type: 'SALE', sku: u.newModel || (line ? line.sku : ''), brand: u.newBrand || (line ? line.brand : ''),
    itemType: (line ? line.type : 'Regular'), house: u.warehouse || (line ? line.house : ''), color: u.newColor || (line ? line.color : ''),
    qty: 1, date: todayISO(), note: `Trade-in ${u.ref} — ${u.oldModel} in`, source: 'Trade-in',
    user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(),
    imeis: u.newImei ? [{ imei: u.newImei }] : []
  });
  if (u.newImei) {
    DB.insert('imeis', {
      imei: u.newImei, sku: u.newModel || (line ? line.sku : ''), brand: u.newBrand || (line ? line.brand : ''),
      house: u.warehouse || (line ? line.house : ''), color: u.newColor || (line ? line.color : ''),
      status: 'Issued', ticketNo: u.ref, addedAt: nowISO(), note: `Issued on trade-in ${u.ref}`
    });
  }

  const patch = { status: 'Issued', issuedAt: nowISO() };

  /* An invoice only exists for money the customer actually owes. A pure
   * cash-back trade (credit exceeds the new price) has nothing to invoice. */
  if (num(u.payable) > 0) {
    const invoiceNo = nextNumber('INV', DB.get('invoices'), 'invoiceNo');
    patch.invoiceNo = invoiceNo;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 7);
    DB.insert('invoices', {
      invoiceNo, type: 'Service', partyId: u.customerId || '', partyName: u.customerName || 'Walk-in',
      amount: u.payable, paid: 0, status: 'Pending', date: todayISO(),
      dueDate: dueDate.toISOString().slice(0, 10), refId: u.id, notes: `Balance on trade-in ${u.ref} after ${money(u.credit)} credit`
    });
  }
  DB.update('upgrades', id, patch);
  toast(`Trade-in ${u.ref} issued — ${money(u.payable)} payable`, 'good');
  Momentum.celebrate('trade');
  return DB.byId('upgrades', id);
}

/**
 * Receive the old device into the workshop.
 *
 * Books the incoming unit at its own worth, not at the credit we gave. The gap
 * between the two is real margin or real loss and is surfaced, never buried.
 */
function receiveUpgrade(id, opts = {}) {
  const u = DB.byId('upgrades', id);
  if (!u) return null;
  if (!requireWrite('upgrades', 'receive trade-in devices')) return null;

  const house = opts.house || u.warehouse || (DB.get('locations')[0] || {}).name || 'Unassigned';
  const condition = opts.condition || u.condition || 'Working';
  const grade = opts.grade || (condition === 'Working' ? 'C' : 'D');
  const line = resolveLine({
    sku: u.oldModel || 'Unidentified trade-in',
    brand: u.oldBrand || '',
    type: condition === 'Working' ? 'Refurbished' : 'Repair',
    house, color: u.oldColor || 'As received',
    unitCost: u.incomingWorth, unitPrice: Math.round(u.incomingWorth * 1.35)
  });
  bumpLine(line, 'inQty', 1);

  const trxRef = `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`;
  DB.insert('movements', {
    trxRef, type: 'IN', sku: line.sku, brand: line.brand, itemType: line.type,
    house, color: line.color, qty: 1, date: todayISO(),
    note: `Trade-in ${u.ref} received (${condition}, grade ${grade})`, source: 'Trade-in',
    user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(),
    imeis: u.oldImei ? [{ imei: u.oldImei }] : []
  });
  if (u.oldImei) {
    DB.insert('imeis', {
      imei: u.oldImei, sku: line.sku, brand: line.brand, house, color: line.color,
      status: condition === 'Working' ? 'In Stock' : 'In Repair', ticketNo: u.ref,
      addedAt: nowISO(), note: `Received via trade-in ${u.ref}`
    });
  }

  const patch = {
    status: 'Received', receivedAt: nowISO(),
    receiveHouse: house, receiveCondition: condition, receiveGrade: grade,
    receiveLineId: line.id, receivedWorth: u.incomingWorth
  };
  if (condition === 'Working' && num(u.tradeGap) > 0) {
    /* A working unit received above its scrap value is real recovered margin. */
    patch.closedAt = nowISO();
    patch.status = 'Closed';
  }
  DB.update('upgrades', id, patch);
  const after = DB.byId('upgrades', id);
  if (after.status === 'Closed') {
    toast(`Trade-in ${u.ref} closed — ${money(num(u.tradeGap))} recovered on the incoming device`, 'good', 5200);
  } else {
    toast(`Trade-in ${u.ref} received into ${house} as ${condition}`, 'good');
  }
  Momentum.celebrate('trade');
  return after;
}

/* ------------------------------------------------------------------ Page */
function renderUpgrades() {
  const all = DB.get('upgrades');
  const q = norm($('upgSearch')?.value);
  const stage = $('upgStage')?.value || '';
  const series = $('upgSeries')?.value || '';

  let rows = all.slice();
  if (q) rows = rows.filter(u => [u.ref, u.customerName, u.customerPhone, u.oldModel, u.newModel, u.oldImei, u.newImei].join(' ').toLowerCase().includes(q));
  if (stage) rows = rows.filter(u => u.status === stage);
  if (series) rows = rows.filter(u => u.newBrand === series);

  const open = all.filter(u => OPEN_TRADE_STAGES.includes(u.status));
  const closed = all.filter(u => u.status === 'Closed');
  const creditGiven = sum(closed, u => num(u.credit));
  const recovered = sum(closed, u => num(u.tradeGap));
  const awaiting = all.filter(u => u.status === 'Issued').length;
  const marginPct = (() => {
    const g = sum(closed, u => num(u.newGross) - num(u.newCost));
    return g > 0 ? (sum(closed, u => num(u.margin)) / g * 100) : 0;
  })();

  $('upgStats').innerHTML = [
    statCard({ icon: '⇄', label: 'Open trade-ins', value: fmt(open.length), meta: `${awaiting} awaiting receipt`, color: awaiting ? 'amber' : 'blue', onClick: 'upgrades:open' }),
    statCard({ icon: '◍', label: 'Credit given', value: money(creditGiven), meta: `${closed.length} completed trades`, color: 'purple', onClick: 'upgrades:closed' }),
    statCard({ icon: '◫', label: 'Margin retained', value: money(recovered), meta: 'Above scrap value', color: recovered >= 0 ? 'green' : 'red', onClick: 'upgrades:closed' }),
    statCard({ icon: '◔', label: 'Trade margin', value: marginPct.toFixed(1) + '%', meta: 'On gross of new devices', color: marginPct >= 15 ? 'green' : 'amber', onClick: 'upgrades:closed' })
  ].join('');

  Pagers.render('upgrades', {
    mount: 'upgTable', foot: 'upgFoot', rows, unit: 'trade-ins', selectable: canWrite('upgrades'),
    emptyTitle: q || stage ? 'No trade-ins match those filters' : 'No trade-ins recorded yet',
    emptyText: 'Record a trade-in when a customer hands over a device against a new one.',
    onRow: r => openUpgradeDrawer(r.id),
    bulkActions: [
      { key: 'receive', label: 'Receive incoming', icon: '↓', run: (sel, ids) => ids.forEach(i => receiveUpgrade(i, { condition: 'Working' })) }
    ],
    columns: [
      { key: 'ref', label: 'Ref', render: r => `<b class="mono">${esc(r.ref)}</b><span class="row-sub">${esc(fmtDate(r.date))}</span>` },
      { key: 'customerName', label: 'Customer', render: r => `<b>${esc(r.customerName || 'Walk-in')}</b><span class="row-sub">${esc(r.customerPhone || '')}</span>` },
      { key: 'oldModel', label: 'Incoming', render: r => `<b>${esc(r.oldModel || '—')}</b><span class="row-sub">${esc(r.oldBrand || '')} ${esc(r.oldImei ? '· ' + r.oldImei : '')}</span>` },
      { key: 'newModel', label: 'Outgoing', render: r => `<b>${esc(r.newModel || '—')}</b><span class="row-sub">${esc(r.newColor || '')}</span>` },
      { key: 'credit', label: 'Credit', align: 'right', render: r => `<b class="c-purple">${money(r.credit)}</b>` },
      { key: 'payable', label: 'Payable', align: 'right', render: r => `<b>${money(r.payable)}</b>${num(r.refundDue) ? `<span class="row-sub c-amber">refund ${money(r.refundDue)}</span>` : ''}` },
      { key: 'margin', label: 'Margin', align: 'right', render: r => {
        const m = num(r.margin);
        return `<b class="${m >= 0 ? 'c-green' : 'c-red'}">${money(m)}</b>`;
      }},
      { key: 'status', label: 'Stage', render: r => statusBadge(r.status) },
      { key: 'actions', label: '', sortable: false, align: 'right', render: r => `
        <div class="actions">
          <button class="btn xs" data-upg-view="${r.id}">Open</button>
          ${r.status === 'Valued' || r.status === 'Agreed' ? `<button class="btn xs success" data-upg-issue="${r.id}">Issue</button>` : ''}
          ${r.status === 'Issued' ? `<button class="btn xs primary" data-upg-receive="${r.id}">Receive</button>` : ''}
        </div>` }
    ]
  });

  /* The buttons on the same host must be wired per render, since Pagers
   * replaces the table markup each time. */
  $$('[data-upg-view]', $('upgTable')).forEach(b => b.onclick = e => { e.stopPropagation(); openUpgradeDrawer(b.dataset.upgView); });
  $$('[data-upg-issue]', $('upgTable')).forEach(b => b.onclick = e => { e.stopPropagation(); issueUpgrade(b.dataset.upgIssue); renderUpgrades(); });
  $$('[data-upg-receive]', $('upgTable')).forEach(b => b.onclick = e => { e.stopPropagation(); receiveUpgrade(b.dataset.upgReceive, {}); renderUpgrades(); });

  fillSelect('upgSeries', brandOptions(), 'All brands');
  $('upgCount').textContent = `${fmt(rows.length)} of ${fmt(all.length)} trade-ins`;
}

/* ---------------------------------------------------------------- Drawer */
function openUpgradeDrawer(id) {
  const u = DB.byId('upgrades', id);
  if (!u) return;
  Trade.recalc(u);
  const photos = DB.get('attachments').filter(a => a.entity === 'upgrades' && a.entityId === id);

  openModal({
    drawer: true, autofocus: false, title: u.ref,
    sub: `${u.customerName || 'Walk-in'} · ${fmtDate(u.date)}`,
    body: `
      <div class="row-wrap mb-16 gap-6">${statusBadge(u.status)}
        <span class="badge grey">${esc(u.oldModel || '—')} in</span>
        <span class="badge blue">${esc(u.newModel || '—')} out</span>
        <span class="badge ${num(u.margin) >= 0 ? 'green' : 'red'}">Margin ${money(u.margin)}</span></div>

      <div class="section-title">The exchange</div>
      <div class="trade-compare">
        <div class="trade-side">
          <span class="eyebrow">Incoming</span>
          <b>${esc(u.oldModel || 'Not stated')}</b>
          <small>${esc(u.oldBrand || '')}${u.oldColor ? ' · ' + esc(u.oldColor) : ''}</small>
          <dl>
            <div><dt>IMEI</dt><dd class="mono">${esc(u.oldImei || '—')}</dd></div>
            <div><dt>Condition</dt><dd>${esc(u.condition || '—')}</dd></div>
            <div><dt>Grade</dt><dd>${esc(u.grade || '—')}</dd></div>
            <div><dt>Status</dt><dd>${u.receivedAt ? esc(u.receiveHouse || 'Received') : 'Not yet received'}</dd></div>
          </dl>
        </div>
        <div class="trade-arrow">⇄</div>
        <div class="trade-side">
          <span class="eyebrow">Outgoing</span>
          <b>${esc(u.newModel || 'Not chosen')}</b>
          <small>${esc(u.newBrand || '')}${u.newColor ? ' · ' + esc(u.newColor) : ''}</small>
          <dl>
            <div><dt>IMEI</dt><dd class="mono">${esc(u.newImei || '—')}</dd></div>
            <div><dt>Facility</dt><dd>${esc(u.warehouse || '—')}</dd></div>
            <div><dt>Price</dt><dd>${money(u.newPrice)}</dd></div>
            <div><dt>Issued</dt><dd>${u.issuedAt ? esc(fmtDate(u.issuedAt.slice(0, 10))) : 'Not yet issued'}</dd></div>
          </dl>
        </div>
      </div>

      <div class="section-title mt-16">Money</div>
      <div class="kv">
        <div class="kv-row"><span class="k">New device price</span><span class="v">${money(u.newGross)}</span></div>
        <div class="kv-row"><span class="k">Less trade-in credit</span><span class="v c-purple">−${money(u.creditValue)}</span></div>
        <div class="kv-row"><span class="k">Customer pays</span><span class="v" style="font-size:16px"><b>${money(u.payable)}</b></span></div>
        ${num(u.refundDue) ? `<div class="kv-row"><span class="k">Cash refund due</span><span class="v c-amber">${money(u.refundDue)}</span></div>` : ''}
        <div class="kv-row"><span class="k">Device cost to us</span><span class="v c-red">−${money(u.newCost)}</span></div>
        <div class="kv-row" style="border-top:2px solid var(--line)"><span class="k"><b>Margin on this trade</b></span><span class="v ${num(u.margin) >= 0 ? 'c-green' : 'c-red'}" style="font-size:15px"><b>${money(u.margin)}</b></span></div>
      </div>

      <div class="section-title mt-16">Honest valuation</div>
      <div class="callout ${num(u.tradeGap) >= 0 ? 'ok' : 'warn'}">
        <span class="lead">${num(u.tradeGap) >= 0 ? '✓' : '!'}</span>
        <div class="body">
          We credited <b>${money(u.credit)}</b> against a device worth about <b>${money(u.incomingWorth)}</b> to us.
          ${num(u.tradeGap) > 0
            ? `That is <b>${money(u.tradeGap)}</b> held back above scrap value.`
            : num(u.tradeGap) < 0
              ? `That is <b>${money(-num(u.tradeGap))}</b> more than the device is worth to us — this trade loses money.`
              : 'The credit matches the device value exactly.'}
        </div>
      </div>

      ${u.invoiceNo ? `<div class="section-title mt-16">Linked</div>
        <div class="kv"><div class="kv-row"><span class="k">Invoice</span><span class="v mono">${esc(u.invoiceNo)}</span></div></div>` : ''}

      ${u.note ? `<div class="section-title mt-16">Note</div>
        <div class="note-box">${esc(u.note)}</div>` : ''}

      <div class="section-title mt-16">Photos of the incoming device</div>
      <div id="attHost"></div>
      ${photos.length ? '' : '<div class="form-hint">Photograph the device on intake — condition disputes are settled by pictures, not memory.</div>'}`,
    foot: `${Attachments.buttons(canWrite('upgrades'))}
           <button class="btn" data-x>Close</button>
           <button class="btn" data-edit>Edit</button>
           ${u.status === 'Valued' || u.status === 'Agreed' ? `<button class="btn primary" data-issue>Issue new device</button>` : ''}
           ${u.status === 'Issued' ? `<button class="btn primary" data-receive>Receive old device</button>` : ''}`,
    onMount(el) {
      qs('[data-x]', el).onclick = () => closeModal(el);
      const ed = qs('[data-edit]', el);
      if (ed) ed.onclick = () => { closeModal(el); Modals.tradeForm(u); };
      const iss = qs('[data-issue]', el);
      if (iss) iss.onclick = () => { issueUpgrade(u.id); closeModal(el); renderAll(); };
      const rcv = qs('[data-receive]', el);
      if (rcv) rcv.onclick = async () => {
        const choice = await pickReceiveTerms(u);
        if (!choice) return;
        receiveUpgrade(u.id, choice);
        closeModal(el);
        renderAll();
      };
      Attachments.mount(qs('#attHost', el), 'upgrades', id);
    }
  });
}

/**
 * Ask what the incoming device actually is, at the moment of receipt.
 * Guessing here would put wrong condition data into the stock ledger.
 */
async function pickReceiveTerms(u) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); closeModal(overlay); };
    const houses = DB.get('locations').map(l => l.name);
    const overlay = openModal({
      width: 'sm', autofocus: false, title: `Receive ${u.oldModel || 'device'}`,
      sub: 'Confirm the condition it actually arrived in',
      body: `<div class="form-grid">
        ${field('Facility', selectControl('rxHouse', houses.map(h => ({ value: h, label: h })), u.warehouse || houses[0] || ''), { required: true })}
        ${field('Condition', selectControl('rxCond', TRADE_CONDITION.map(c => ({ value: c.id, label: `${c.id} — ${c.hint}` })), u.condition || 'Working'), { required: true })}
        ${field('Grade', selectControl('rxGrade', TRADE_GRADES.map(g => ({ value: g, label: `Grade ${g} — ${Math.round(TRADE_GRADE_FACTOR[g] * 100)}% of retail` })), u.grade || 'C'), { required: true })}
        <div class="span-all form-hint">The device is booked into stock at its own worth, not at the credit given. Any gap is surfaced on the trade.</div>
      </div>`,
      foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Receive into stock</button>`,
      onMount(el) {
        qs('[data-cancel]', el).onclick = () => finish(null);
        qs('[data-ok]', el).onclick = () => finish({
          house: $('rxHouse', el).value,
          condition: $('rxCond', el).value,
          grade: $('rxGrade', el).value
        });
      },
      onClose: () => finish(null)
    });
  });
}

/* ------------------------------------------------------------------ Form */
Modals.tradeForm = function (existing) {
  if (!requireWrite('upgrades', 'record trade-ins')) return;
  const stock = DB.get('inventory').filter(l => inHand(l) > 0);

  openModal({
    width: 'lg', title: existing ? `Edit ${existing.ref}` : 'New trade-in',
    sub: 'Value the incoming device, choose the outgoing one, agree the credit',
    body: `
      <div class="section-title">Customer</div>
      <div class="form-grid three">
        ${field('Customer', `<input class="input" id="trName" list="trNameList" value="${esc(existing ? existing.customerName : '')}" placeholder="Walk-in or registered name">` +
          `<datalist id="trNameList">${DB.get('customers').map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>`, { required: true })}
        ${field('Phone', `<input class="input" id="trPhone" value="${esc(existing ? existing.customerPhone : '')}" placeholder="Contact number">`)}
        ${field('Date', `<input class="input" id="trDate" type="date" value="${existing ? existing.date : todayISO()}">`)}
      </div>

      <div class="section-title mt-16">Incoming device — the customer's old one</div>
      <div class="form-grid three">
        ${field('Model', `<input class="input" id="trOldModel" list="trModelList" value="${esc(existing ? existing.oldModel : '')}" placeholder="e.g. Galaxy A52">` +
          `<datalist id="trModelList">${DB.get('items').map(i => `<option value="${esc(i.model)}"></option>`).join('')}</datalist>`, { required: true })}
        ${field('Brand', `<input class="input" id="trOldBrand" value="${esc(existing ? existing.oldBrand : '')}" placeholder="Samsung">`)}
        ${field('IMEI', `<input class="input" id="trOldImei" placeholder="15 digits">`, { hint: 'Scan or type. Checked against the register for collisions.' })}
        ${field('Condition', selectControl('trCond', TRADE_CONDITION.map(c => ({ value: c.id, label: c.id })), existing ? existing.condition : 'Working'), { required: true })}
        ${field('Grade', selectControl('trGrade', TRADE_GRADES.map(g => ({ value: g, label: `Grade ${g}` })), existing ? existing.grade : 'B'), { required: true })}
        ${field('Colour', `<input class="input" id="trOldColor" value="${esc(existing ? existing.oldColor : '')}" placeholder="Black">`)}
      </div>

      <div class="section-title mt-16">Outgoing device — the new one</div>
      <div class="form-grid three">
        ${field('Stock line', selectControl('trLine', optionsFromList(stock, existing ? existing.newLineId : '', l => `${l.sku} — ${l.color} · ${l.house} (${fmt(inHand(l))} @ ${money(l.unitPrice)})`, 'Choose from stock…')), { span: 2, required: true })}
        ${field('Sale price', `<input class="input" id="trNewPrice" type="number" min="0" step="1" value="${num(existing ? existing.newPrice : 0)}">`, { required: true })}
        ${field('IMEI', `<input class="input" id="trNewImei" placeholder="Assign on issue">`)}
        ${field('Facility', selectControl('trHouse', DB.get('locations').map(l => ({ value: l.name, label: l.name })), existing ? existing.warehouse : (stock[0] || {}).house || ''))}
      </div>

      <div class="section-title mt-16">Valuation</div>
      <div class="form-grid three">
        ${field('Suggested value', `<div class="input readonly" id="trSuggest">—</div>`, { hint: 'From catalogue retail × grade. Adjust freely below.' })}
        ${field('Credit to customer', `<input class="input" id="trCredit" type="number" min="0" step="1" value="${num(existing ? existing.credit : 0)}">`, { required: true })}
        ${field('Old value held', `<input class="input" id="trOldValue" type="number" min="0" step="1" value="${num(existing ? existing.oldValue : 0)}">`, { hint: 'What the device is worth to us on its own.' })}
      </div>
      <div class="dark-panel mt-16" id="trPreview"></div>
      <div class="row-wrap mt-12">
        <label class="check"><input type="checkbox" id="trAgreed" ${existing && existing.status !== 'Valued' ? 'checked' : ''}> Customer has agreed this valuation in person</label>
      </div>
      ${field('Note', `<textarea class="input" id="trNote" rows="2" placeholder="Charger included, screen protector applied, box not returned…">${esc(existing ? existing.note : '')}</textarea>`, { span: 2 })}`,
    foot: `<button class="btn" data-cancel>Cancel</button>
           <button class="btn primary" data-save>${existing ? 'Save trade-in' : 'Create trade-in'}</button>`,
    onMount(el) {
      const base = existing ? Object.assign({}, existing) : {
        customerName: '', customerPhone: '', oldModel: '', oldBrand: '', oldImei: '',
        condition: 'Working', grade: 'B', newPrice: 0, credit: 0, oldValue: 0, status: 'Valued'
      };

      const line = () => DB.byId('inventory', $('trLine', el).value);
      const preview = () => {
        const l = line();
        const credit = num($('trCredit', el).value);
        const price = num($('trNewPrice', el).value);
        const cost = l ? num(l.unitCost) : 0;
        const refund = Math.max(0, credit - price);
        const payable = Math.max(0, price - credit);
        const margin = price - cost - refund;
        const worth = num($('trOldValue', el).value) || Trade.suggest($('trOldModel', el).value, $('trGrade', el).value, { working: $('trCond', el).value !== 'Dead' });
        $('trPreview', el).innerHTML = `
          <div class="eyebrow">What the customer pays</div>
          <h3>${money(payable)}</h3>
          <div class="dark-stat"><small>New device</small><b>${money(price)}</b></div>
          <div class="dark-stat"><small>Less trade-in credit</small><b style="color:#c9a4f0">−${money(credit)}</b></div>
          ${refund ? `<div class="dark-stat"><small>Cash refund due</small><b style="color:#f6d18a">${money(refund)}</b></div>` : ''}
          <div class="dark-stat"><small>Margin to ${esc(BRAND.legalName)}</small><b style="color:${margin >= 0 ? '#7fd6a8' : '#e0685f'}">${money(margin)}</b></div>
          <div class="dark-stat"><small>Incoming device worth</small><b>${money(worth)}</b></div>
          <p class="fs-11" style="color:${credit > worth ? '#f6d18a' : 'rgba(255,255,255,.55)'};margin-top:10px">
            ${credit > worth ? `⚠ Crediting ${money(credit - worth)} more than the device is worth to us.` : 'Credit is within the device value.'}
          </p>`;
        return { payable, refund, margin, worth };
      };

      /* Suggest a value as soon as the operator types a model. */
      const suggest = () => {
        const m = $('trOldModel', el).value.trim();
        if (!m) { $('trSuggest', el).textContent = '—'; return; }
        const v = Trade.suggest(m, $('trGrade', el).value, { working: $('trCond', el).value !== 'Dead' });
        const item = DB.get('items').find(i => norm(i.model) === norm(m));
        $('trSuggest', el).textContent = v
          ? `${money(v)}${item ? ` — ${Math.round(TRADE_GRADE_FACTOR[$('trGrade', el).value] * 100)}% of ${money(item.price)}` : ' — not in catalogue'}`
          : 'Not in catalogue — set the credit by hand';
        if (!$('trCredit', el).value || num($('trCredit', el).value) === 0) $('trCredit', el).value = v;
      };

      $('trLine', el).onchange = () => {
        const l = line();
        if (l) {
          $('trNewPrice', el).value = num(l.unitPrice);
          $('trHouse', el).value = l.house;
          $('trNewImei', el).value = '';
        }
        preview();
      };
      ['trGrade', 'trCond', 'trOldModel', 'trNewPrice', 'trCredit', 'trOldValue'].forEach(id => {
        const n = $(id, el);
        if (!n) return;
        n.oninput = () => { if (id === 'trOldModel' || id === 'trGrade' || id === 'trCond') suggest(); preview(); };
        n.onchange = n.oninput;
      });

      /* An IMEI already on the register is a red flag worth interrupting for. */
      $('trOldImei', el).onblur = () => {
        const v = $('trOldImei', el).value.trim();
        if (!v) return;
        const hit = findImei(v);
        if (hit) toast(`That IMEI is already registered at ${hit.record.house || 'another location'} — check before accepting`, 'warn', 6000);
      };

      qs('[data-cancel]', el).onclick = () => closeModal(el);
      qs('[data-save]', el).onclick = () => {
        const l = line();
        if (!$('trName', el).value.trim()) return toast('Who is the trade-in for?', 'bad');
        if (!$('trOldModel', el).value.trim()) return toast('State the incoming model', 'bad');
        if (!l && num($('trNewPrice', el).value) <= 0) return toast('Choose the outgoing stock line, or set a price', 'bad');
        const imei = $('trOldImei', el).value.trim();

        const rec = Object.assign({}, base, {
          id: existing ? existing.id : null,
          customerId: (DB.get('customers').find(c => norm(c.name) === norm($('trName', el).value)) || {}).id || '',
          customerName: $('trName', el).value.trim(),
          customerPhone: $('trPhone', el).value.trim(),
          date: $('trDate', el).value || todayISO(),
          oldModel: $('trOldModel', el).value.trim(),
          oldBrand: $('trOldBrand', el).value.trim(),
          oldImei: imei,
          oldColor: $('trOldColor', el).value.trim(),
          condition: $('trCond', el).value,
          grade: $('trGrade', el).value,
          newLineId: l ? l.id : '',
          newModel: l ? l.sku : $('trNewPrice', el).value ? 'Non-stock' : '',
          newBrand: l ? l.brand : '',
          newColor: l ? l.color : '',
          newImei: $('trNewImei', el).value.trim(),
          newPrice: num($('trNewPrice', el).value),
          newCost: l ? num(l.unitCost) : 0,
          warehouse: $('trHouse', el).value,
          credit: num($('trCredit', el).value),
          oldValue: num($('trOldValue', el).value),
          note: $('trNote', el).value.trim(),
          status: base.status === 'Valued' && $('trAgreed', el).checked ? 'Agreed' : (base.status || 'Valued')
        });
        if (existing) DB.update('upgrades', existing.id, rec);
        else saveTrade(rec);
        if (existing) renderAll(); else { closeModal(el); renderAll(); }
        toast(existing ? 'Trade-in updated' : `Trade-in ${newTradeRef()} created`, 'good');
        Momentum.celebrate('trade');
      };
      suggest();
      preview();
    }
  });
};

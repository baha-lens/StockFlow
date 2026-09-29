/* ==========================================================================
   AMAYA ERP — Modals & form handlers
   ========================================================================== */

const Modals = {};

/* ---------------------------------------------------- Item (catalogue) */
Modals.itemForm = function (existing) {
  const item = existing || null;
  const lines = item ? DB.get('inventory').filter(l => l.itemId === item.id || norm(l.sku) === norm(item.model)) : [];
  openModal({
    width: 'md',
    title: item ? 'Edit catalogue item' : 'New catalogue item',
    sub: item ? `${item.model} — created ${fmtDate(item.createdAt)}` : 'Add a product line to the catalogue and the stock register.',
    body: `
      <div class="form-grid">
        ${field('Model / SKU name', `<input class="input" id="ifModel" value="${esc(item ? item.model : '')}" placeholder="e.g. HONOR 600 Pro 12/256">`, { required: true })}
        ${field('Brand', `<input class="input" id="ifBrand" value="${esc(item ? item.brand : '')}" placeholder="e.g. HONOR">`, { required: true })}
        ${field('Category', selectControl('ifType', STOCK_TYPES, item ? item.type : 'Regular'))}
        ${field('Configuration', `<input class="input" id="ifConfig" value="${esc(item ? item.config : '')}" placeholder="8/256">`)}
        ${field('Unit cost', `<input class="input" id="ifCost" type="number" min="0" step="0.01" value="${num(item ? item.cost : 0)}">`)}
        ${field('Retail price', `<input class="input" id="ifPrice" type="number" min="0" step="0.01" value="${num(item ? item.price : 0)}">`)}
        ${field('Reorder point', `<input class="input" id="ifReorder" type="number" min="0" value="${num(item ? item.reorderPoint : threshold())}">`, { hint: 'Alerts fire at or below this level' })}
        ${field('Warranty (months)', `<input class="input" id="ifWarranty" type="number" min="0" value="${num(item ? item.warrantyMonths : 12)}">`)}
        ${field('Note', `<input class="input" id="ifNote" value="${esc(item ? item.note : '')}" placeholder="Optional">`, { span: 2 })}
      </div>
      ${!item ? `<div class="section-title mt-16">Opening stock</div>
      <div class="form-grid">
        ${field('Facility', selectControl('ifHouse', housesOptions('', 'Select facility…'), 'Main House'))}
        ${field('Colour', `<input class="input" id="ifColor" value="Standard" placeholder="e.g. Black">`)}
        ${field('Opening units', `<input class="input" id="ifOpening" type="number" min="0" value="0">`, { span: 2 })}
      </div>` : ''}
      ${item && lines.length ? `<div class="section-title mt-16">Current stock lines</div>
      <div class="table-scroll"><table class="dt"><thead><tr><th>Facility</th><th>Colour</th><th class="right">Available</th></tr></thead>
      <tbody>${lines.map(l => `<tr><td>${esc(l.house)}</td><td>${esc(l.color)}</td><td class="right num"><b>${fmt(inHand(l))}</b></td></tr>`).join('')}</tbody>
      </table></div>` : ''}`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${item ? 'Save changes' : 'Create item'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['ifModel', 'ifBrand'])) return;
        const model = $('ifModel', el).value.trim();
        const dup = DB.get('items').find(i => norm(i.model) === norm(model) && (!item || i.id !== item.id));
        if (dup) { $('ifModel', el).classList.add('err'); return toast('A catalogue line with that model already exists', 'bad'); }
        const payload = {
          model, sku: model,
          brand: $('ifBrand', el).value.trim(),
          type: $('ifType', el).value,
          config: $('ifConfig', el).value.trim(),
          cost: num($('ifCost', el).value),
          price: num($('ifPrice', el).value),
          reorderPoint: num($('ifReorder', el).value),
          warrantyMonths: num($('ifWarranty', el).value),
          note: $('ifNote', el).value.trim(),
          active: item ? item.active : true
        };
        if (item) {
          DB.update('items', item.id, payload);
          /* Propagate price changes to stock lines that have no override */
          DB.get('inventory').filter(l => l.itemId === item.id).forEach(l => DB.update('inventory', l.id, { unitCost: payload.cost, unitPrice: payload.price }));
          audit('UPDATE', 'Inventory', payload.model, 'Catalogue item updated');
          toast('Item updated', 'good');
          closeModal(el);
          renderAll();
          return;
        }
        const rec = DB.insert('items', Object.assign({ createdAt: todayISO() }, payload));
        const opening = num($('ifOpening', el).value);
        if (opening > 0) {
          const line = resolveLine({ sku: model, brand: payload.brand, type: payload.type, house: $('ifHouse', el).value, color: $('ifColor', el).value.trim() || 'Standard', unitCost: payload.cost, unitPrice: payload.price });
          DB.update('inventory', line.id, { itemId: rec.id, openingQty: opening });
          DB.insert('movements', {
            trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
            type: 'IN', sku: model, brand: payload.brand, itemType: payload.type,
            house: $('ifHouse', el).value, color: line.color, qty: opening, date: todayISO(),
            note: 'Opening balance', source: 'Opening stock',
            user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(), imeis: []
          });
        }
        audit('CREATE', 'Inventory', model, `Catalogue item created${opening ? ` with ${opening} opening units` : ''}`);
        toast('Item created', 'good');
        closeModal(el);
        renderAll();
      };
    }
  });
};

/* ------------------------------------------------------------ Movement */
Modals.movementForm = function (line, preset = {}) {
  if (!requireWrite('movements', 'record movements')) return;
  const direction = preset.direction || 'IN';
  const lines = DB.get('inventory');
  const skus = uniq(lines.map(l => l.sku)).sort();

  openModal({
    width: 'lg',
    title: 'Record stock movement',
    sub: 'Every movement writes an auditable ledger reference.',
    body: `
      <div class="btn-group mb-16" style="width:100%">
        <button class="btn grow ${direction === 'IN' ? 'success' : 'ghost'}" data-dir="IN" style="border-radius:0">↓ Receive stock (IN)</button>
        <button class="btn grow ${direction === 'OUT' ? 'danger' : 'ghost'}" data-dir="OUT" style="border-radius:0">↑ Issue stock (OUT)</button>
      </div>
      <div class="form-grid three">
        ${field('Stock line', selectControl('mfLine', optionsFromList(lines, line ? line.id : '', l => `${l.sku} — ${l.color} · ${l.house} (${fmt(inHand(l))})`, 'Select a stock line…'), line ? line.id : ''), { required: true, span: 2 })}
        ${field('Quantity', `<input class="input" id="mfQty" type="number" min="1" value="${num(preset.qty || 1)}">`, { required: true })}
        ${field('Movement date', `<input class="input" id="mfDate" type="date" value="${todayISO()}">`)}
        ${field('Destination / Source', `<input class="input" id="mfSource" placeholder="Supplier, customer or department">`, { span: 2 })}
        ${field('Reference note', `<input class="input" id="mfNote" placeholder="Bill of lading, PO or reason">`, { span: 2 })}
        ${field('Serial / IMEI numbers', `<div class="tag-input-wrap" id="mfImeiWrap"><input id="mfImeiInput" placeholder="Type or scan an IMEI then press Enter"></div>`, {
          span: 2,
          hint: 'Attach serials to trace individual devices. Duplicates are flagged automatically.'
        })}
        <div class="span-all" id="mfAlerts"></div>
      </div>
      <div class="dark-panel mt-16" id="mfPreview"></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button>
           <button class="btn" data-reset>Reset</button>
           <button class="btn primary" data-save>Commit movement</button>`,
    onMount(el) {
      let dir = direction;
      const lineSel = $('mfLine', el);

      const sel = () => DB.byId('inventory', lineSel.value);
      const renderPreview = () => {
        const l = sel();
        const q = num($('mfQty', el).value) || 0;
        const cur = l ? inHand(l) : 0;
        const after = dir === 'IN' ? cur + q : cur - q;
        $('mfPreview', el).innerHTML = `
          <div class="eyebrow">Balance preview</div>
          <h3>${esc(l ? l.sku : 'No line selected')}</h3>
          <div class="dark-stat"><small>Facility</small><b>${esc(l ? l.house : '—')}</b></div>
          <div class="dark-stat"><small>Current available</small><b>${fmt(cur)} units</b></div>
          <div class="dark-stat"><small>Balance after this movement</small><b style="color:${after < 0 ? '#e0685f' : '#f6d18a'}">${fmt(after)} units</b></div>
          ${after < 0 && !state.db.settings.allowNegative ? `<p class="fs-11" style="color:#e0685f;margin-top:10px">⚠ This would take the line negative. Reduce the quantity or enable negative stock in settings.</p>` : ''}`;
      };
      const checkImeis = () => {
        const list = imeiList(el);
        const box = $('mfAlerts', el);
        const hits = list.map(i => ({ imei: i, hit: findImei(i) })).filter(x => x.hit);
        const selfDupes = list.filter((v, i) => list.indexOf(v) !== i);
        let html = '';
        if (selfDupes.length) html += `<div class="collide mb-8"><strong>⚠ Repeated in this list</strong>${esc(uniq(selfDupes).join(', '))} appears more than once.</div>`;
        if (hits.length) {
          html += `<div class="collide"><strong>⚠ ${hits.length} identifier(s) already registered</strong>
            ${hits.slice(0, 6).map(h => {
              const src = h.hit.source;
              const rec = h.hit.record;
              const where = src === 'registry' ? `${rec.house} · ${rec.status}` : src === 'repair' ? `Ticket ${rec.ticketNo} · ${rec.status}` : `Movement ${rec.trxRef} · ${rec.house}`;
              return `<div class="mono" style="margin-top:4px">${esc(h.imei)} <span style="opacity:.8">→ ${esc(where)}</span></div>`;
            }).join('')}
          </div>`;
        }
        box.innerHTML = html;
      };

      lineSel.onchange = renderPreview;
      $('mfQty', el).oninput = renderPreview;
      $$('[data-dir]', el).forEach(b => b.onclick = () => {
        dir = b.dataset.dir;
        $$('[data-dir]', el).forEach(x => {
          x.className = 'btn grow ' + (x.dataset.dir === dir ? (dir === 'IN' ? 'success' : 'danger') : 'ghost');
          x.style.borderRadius = '0';
        });
        renderPreview();
      });

      const iwrap = $('mfImeiWrap', el), iinp = $('mfImeiInput', el);
      const addImei = (raw) => {
        const v = String(raw).trim();
        if (!v) return;
        const list = imeiList(el);
        if (list.includes(v)) { toast('That identifier is already in the list', 'warn'); return; }
        list.push(v);
        renderImeiTags(el, list);
        iinp.value = '';
        checkImeis();
      };
      iinp.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') { e.preventDefault(); addImei(iinp.value); }
        if (e.key === 'Backspace' && !iinp.value) { const l = imeiList(el); l.pop(); renderImeiTags(el, l); checkImeis(); }
      };
      iwrap.onclick = e => { if (e.target === iwrap) iinp.focus(); };
      if (preset.imeis) { preset.imeis.forEach(addImei); }

      if (preset.immediate) {
        const a = document.createElement('button');
        a.className = 'btn sm'; a.textContent = '▣ Scan';
        a.style.cssText = 'position:absolute;right:8px;top:6px';
        iwrap.appendChild(a);
        a.onclick = e => { e.stopPropagation(); openScanner(v => addImei(v)); };
        iwrap.style.position = 'relative';
      }

      qs('[data-reset]', el).onclick = () => { closeModal(el); Modals.movementForm(sel(), { direction: dir }); };
      qs('[data-save]', el).onclick = async () => {
        const l = sel();
        const q = num($('mfQty', el).value);
        if (!l) return toast('Select a stock line first', 'bad');
        if (q <= 0) return toast('Quantity must be at least 1', 'bad');
        if (dir === 'OUT' && q > inHand(l) && !state.db.settings.allowNegative) {
          return toast(`Only ${fmt(inHand(l))} units available on this line`, 'bad');
        }
        const imeis = imeiList(el);
        const hits = imeis.map(i => ({ imei: i, hit: findImei(i) })).filter(x => x.hit);
        if (hits.length) {
          const ok = await confirmDialog({
            title: 'Duplicate identifier detected', danger: true, confirmLabel: 'Commit anyway',
            message: `${hits.length} identifier(s) already exist in the register`,
            detail: `${hits.map(h => h.imei).join(', ')}<br><br>Committing may create a collision. Continue only if you are certain.`
          });
          if (!ok) return;
        }
        bumpLine(l, dir === 'IN' ? 'inQty' : 'outQty', q);
        DB.update('inventory', l.id, { lastMovementAt: nowISO() });
        const trxRef = `TRX-${$('mfDate', el).value.replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`;
        DB.insert('movements', {
          trxRef, type: dir, sku: l.sku, brand: l.brand, itemType: l.type,
          house: l.house, color: l.color, qty: q, date: $('mfDate', el).value,
          note: $('mfNote', el).value.trim(), source: $('mfSource', el).value.trim() || (dir === 'IN' ? 'Supplier' : 'Issue'),
          user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(),
          imeis: imeis.map(i => ({ imei: i }))
        });
        imeis.forEach(imei => {
          DB.insert('imeis', {
            imei, sku: l.sku, brand: l.brand, house: l.house, color: l.color,
            status: dir === 'IN' ? 'In Stock' : 'Issued', ticketNo: '',
            addedAt: nowISO(), note: `${dir} via ${trxRef}`
          });
        });
        audit('MOVE', 'Stock', trxRef, `${dir} ${fmt(q)} × ${l.sku} at ${l.house}${imeis.length ? ` (${imeis.length} serial${imeis.length === 1 ? '' : 's'})` : ''}`);
        toast(`${dir} ${fmt(q)} × ${l.sku} committed as ${trxRef}`, 'good');
        closeModal(el);
        renderAll();
      };
      renderPreview();
      checkImeis();
    }
  });
};
function imeiList(root) {
  const el = $('mfImeiWrap', root);
  try { return JSON.parse(el.dataset.list || '[]'); } catch (_) { return []; }
}
function renderImeiTags(root, list) {
  const wrap = $('mfImeiWrap', root);
  const inp = $('mfImeiInput', root);
  wrap.dataset.list = JSON.stringify(list);
  $$('.tag-pill', wrap).forEach(n => n.remove());
  list.forEach((v, i) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill mono';
    pill.innerHTML = `${esc(v)}<button title="Remove">×</button>`;
    pill.querySelector('button').onclick = () => { list.splice(i, 1); renderImeiTags(root, list); };
    wrap.insertBefore(pill, inp);
  });
}

/* --------------------------------------------------------- Reconcile */
Modals.reconcileForm = function (line) {
  if (!requireWrite('movements', 'reconcile stock')) return;
  const lines = DB.get('inventory');
  openModal({
    width: 'md', title: 'Physical stock reconciliation',
    sub: 'Set the counted quantity. The difference is written as an audited adjustment.',
    body: `
      <div class="form-grid">
        ${field('Stock line', selectControl('rfLine', optionsFromList(lines, line ? line.id : '', l => `${l.sku} — ${l.color} · ${l.house} (${fmt(inHand(l))})`, 'Select a line…'), line ? line.id : ''), { required: true, span: 2 })}
        ${field('Counted physical quantity', `<input class="input" id="rfTarget" type="number" min="0" value="${line ? inHand(line) : 0}">`, { required: true, span: 2 })}
        ${field('Reason (required for audit)', `<input class="input" id="rfReason" placeholder="e.g. Weekly cycle count — 2 damaged units written off">`, { required: true, span: 2 })}
      </div>
      <div class="callout info mt-16" id="rfDelta"><span class="lead">⚖</span><div class="body">Select a line to see the variance.</div></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Commit reconciliation</button>`,
    onMount(el) {
      const sel = $('rfLine', el);
      const showDelta = () => {
        const l = DB.byId('inventory', sel.value);
        const target = num($('rfTarget', el).value);
        if (!l) { $('rfDelta', el).innerHTML = '<span class="lead">⚖</span><div class="body">Select a line.</div>'; return; }
        const cur = inHand(l);
        const d = target - cur;
        $('rfDelta', el).className = `callout mt-16 ${d === 0 ? 'ok' : d > 0 ? 'info' : 'warn'}`;
        $('rfDelta', el).innerHTML = `<span class="lead">${d === 0 ? '=' : d > 0 ? '▲' : '▼'}</span>
          <div class="body"><b>System ${fmt(cur)} → counted ${fmt(target)}</b>
          Adjustment of ${d > 0 ? '+' : ''}${fmt(d)} unit${Math.abs(d) === 1 ? '' : 's'} will be applied to ${esc(l.sku)} at ${esc(l.house)}.</div>`;
      };
      sel.onchange = () => {
        const l = DB.byId('inventory', sel.value);
        $('rfTarget', el).value = l ? inHand(l) : 0;
        showDelta();
      };
      $('rfTarget', el).oninput = showDelta;
      qs('[data-save]', el).onclick = async () => {
        const l = DB.byId('inventory', sel.value);
        if (!l) return toast('Select a stock line', 'bad');
        const reason = $('rfReason', el).value.trim();
        if (state.db.settings.requireReasonOnAdjust && !reason) { $('rfReason', el).classList.add('err'); return toast('A reason is required for the audit trail', 'bad'); }
        const target = num($('rfTarget', el).value);
        const delta = target - inHand(l);
        if (delta === 0) { toast('No variance to record', 'warn'); return closeModal(el); }
        bumpLine(l, 'adjustedQty', delta);
        DB.insert('movements', {
          trxRef: `TRX-${todayISO().replace(/-/g, '')}-${String(DB.get('movements').length + 1).padStart(4, '0')}`,
          type: 'ADJUST', sku: l.sku, brand: l.brand, itemType: l.type,
          house: l.house, color: l.color, qty: delta, date: todayISO(),
          /* The sign rides in qty so the ledger can be summed; `source` keeps the
           * plain-English reason a person reads. See movementEffect(). */
          note: reason, source: delta > 0 ? 'Surplus found' : 'Shortage / damage',
          user: state.session.user.name, role: state.session.user.role, timestamp: nowISO(), imeis: []
        });
        audit('ADJUST', 'Stock', l.sku, `${delta > 0 ? '+' : ''}${fmt(delta)} at ${l.house} — ${reason}`);
        toast(`${delta > 0 ? '+' : ''}${fmt(delta)} units recorded on ${l.sku}`, 'good');
        closeModal(el);
        renderAll();
      };
      showDelta();
    }
  });
};

/* ---------------------------------------------------------- Transfer */
Modals.transferForm = function () {
  if (!requireWrite('transfers', 'create transfers')) return;
  const lines = DB.get('inventory').filter(l => inHand(l) > 0);
  openModal({
    width: 'lg', title: 'Create transfer request',
    sub: 'Multi-stage: Pending → Approved → Dispatched → In transit → Received → Complete.',
    body: `
      <div class="form-grid">
        ${field('Origin facility', selectControl('tfFrom', housesOptions('', 'Select origin…'), ''), { required: true })}
        ${field('Destination facility', selectControl('tfTo', housesOptions('', 'Select destination…'), ''), { required: true })}
        ${field('Stock line', selectControl('tfLine', optionsFromList(lines, '', l => `${l.sku} — ${l.color} · ${l.house} (${fmt(inHand(l))})`, 'Select a line…'), ''), { required: true, span: 2 })}
        ${field('Quantity', `<input class="input" id="tfQty" type="number" min="1" value="1">`, { required: true })}
        ${field('Expected dispatch date', `<input class="input" id="tfDate" type="date" value="${todayISO()}">`)}
        ${field('Carrier / transport', `<input class="input" id="tfCarrier" placeholder="e.g. Logistics Van Bay 2 / Driver Shanto">`, { span: 2 })}
        ${field('Tracking reference', `<input class="input" id="tfTracking" placeholder="Optional consignment number">`)}
        ${field('Notes', `<input class="input" id="tfNotes" placeholder="Reason for the transfer">`)}
      </div>
      <div class="callout info mt-16"><span class="lead">◫</span><div class="body"><b>Nothing moves until it is dispatched</b>
        Stock leaves the origin when the request is marked <i>Dispatched</i> and lands in the destination on <i>Complete</i>.</div></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Create transfer request</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        const from = $('tfFrom', el).value, to = $('tfTo', el).value;
        const l = DB.byId('inventory', $('tfLine', el).value);
        const qty = num($('tfQty', el).value);
        if (!from || !to) return toast('Choose both origin and destination', 'bad');
        if (from === to) return toast('Origin and destination must differ', 'bad');
        if (!l) return toast('Select a stock line', 'bad');
        if (qty <= 0) return toast('Quantity must be at least 1', 'bad');
        if (qty > inHand(l)) return toast(`Only ${fmt(inHand(l))} units available at ${from}`, 'bad');
        const date = $('tfDate', el).value || todayISO();
        const ref = `TRF-${date.replace(/-/g, '')}-${String(DB.get('transfers').length + 1).padStart(3, '0')}`;
        DB.insert('transfers', {
          transferRef: ref, fromLocation: from, toLocation: to,
          items: [{ sku: l.sku, color: l.color, qty }],
          totalUnits: qty, status: 'Pending', date,
          requestedBy: state.session.user.name, approvedBy: '', dispatchedBy: '', receivedBy: '',
          carrier: $('tfCarrier', el).value.trim(), tracking: $('tfTracking', el).value.trim(),
          notes: $('tfNotes', el).value.trim(), imeis: []
        });
        audit('TRANSFER', 'Transfers', ref, `${from} → ${to} · ${qty} × ${l.sku}`);
        toast(`Transfer ${ref} created`, 'good');
        closeModal(el);
        renderAll();
      };
    }
  });
};

/* --------------------------------------------------------- Purchase */
Modals.purchaseForm = function (existing) {
  const p = existing || null;
  openModal({
    width: 'lg',
    title: p ? 'Edit purchase order' : 'New purchase order',
    sub: 'Raise a PO against a supplier. Receiving stock updates the inventory automatically.',
    body: `
      <div class="form-grid">
        ${field('Supplier', selectControl('pfSupplier', supplierOptions(), p ? p.supplierId : ''), { required: true })}
        ${field('Order date', `<input class="input" id="pfDate" type="date" value="${p ? p.date : todayISO()}">`)}
        ${field('Catalogue item', selectControl('pfItem', itemOptions(), p ? p.itemId : ''), { required: true, span: 2 })}
        ${field('Quantity', `<input class="input" id="pfQty" type="number" min="1" value="${num(p ? p.qty : 10)}">`, { required: true })}
        ${field('Unit cost', `<input class="input" id="pfCost" type="number" min="0" step="0.01" value="${num(p ? p.cost : 0)}">`, { required: true })}
        ${field('Destination facility', selectControl('pfHouse', housesOptions('', 'Select facility…'), p ? p.house : 'Main House'), { span: 2 })}
        ${field('Expected arrival (ETA)', `<input class="input" id="pfEta" type="date" value="${p ? p.eta : ''}">`)}
        ${field('Status', selectControl('pfStatus', ['Pending', 'In Transit', 'Received', 'Partially Received', 'Cancelled'], p ? p.status : 'Pending'))}
        ${field('Notes', `<input class="input" id="pfNotes" value="${esc(p ? p.notes : '')}" placeholder="Optional">`, { span: 2 })}
      </div>
      <div class="dark-panel mt-16" id="pfPreview"></div>`,
    foot: `${p && p.status !== 'Received' ? `<button class="btn left success" data-receive>✓ Receive now</button>` : ''}
           <button class="btn" data-cancel>Cancel</button>
           <button class="btn primary" data-save>${p ? 'Save changes' : 'Submit purchase order'}</button>`,
    onMount(el) {
      const upd = () => {
        const item = DB.byId('items', $('pfItem', el).value);
        const q = num($('pfQty', el).value);
        const c = num($('pfCost', el).value) || (item ? item.cost : 0);
        $('pfPreview', el).innerHTML = `
          <div class="eyebrow">Order summary</div>
          <h3>${esc(item ? item.model : 'No item selected')}</h3>
          <div class="dark-stat"><small>Quantity</small><b>${fmt(q)} units</b></div>
          <div class="dark-stat"><small>Unit cost</small><b>${money(c)}</b></div>
          <div class="dark-stat"><small>Order total</small><b style="color:#f6d18a">${money(q * c)}</b></div>`;
      };
      $('pfItem', el).onchange = () => { const it = DB.byId('items', $('pfItem', el).value); if (it) $('pfCost', el).value = it.cost; upd(); };
      $('pfQty', el).oninput = upd; $('pfCost', el).oninput = upd;
      const rec = qs('[data-receive]', el);
      if (rec) rec.onclick = () => { closeModal(el); receivePurchase(p.id); };
      qs('[data-save]', el).onclick = () => {
        const sup = DB.byId('suppliers', $('pfSupplier', el).value);
        const item = DB.byId('items', $('pfItem', el).value);
        const qty = num($('pfQty', el).value);
        if (!sup) return toast('Choose a supplier', 'bad');
        if (!item) return toast('Choose a catalogue item', 'bad');
        if (qty <= 0) return toast('Quantity must be at least 1', 'bad');
        const cost = num($('pfCost', el).value);
        const date = $('pfDate', el).value || todayISO();
        const payload = {
          supplierId: sup.id, supplier: sup.name, date,
          itemId: item.id, item: item.model, brand: item.brand, type: item.type,
          house: $('pfHouse', el).value || 'Main House',
          qty, cost, total: qty * cost,
          status: $('pfStatus', el).value,
          eta: $('pfEta', el).value, notes: $('pfNotes', el).value.trim(),
          approvedBy: state.session.user.name
        };
        if (p) {
          DB.update('purchases', p.id, payload);
          audit('UPDATE', 'Purchases', p.poNumber, 'Purchase order updated');
          toast('Purchase order updated', 'good');
        } else {
          const poNumber = `PO-${date.replace(/-/g, '')}-${String(DB.get('purchases').length + 1).padStart(3, '0')}`;
          const rec2 = DB.insert('purchases', Object.assign({ poNumber, receivedQty: 0, createdAt: nowISO() }, payload));
          const due = new Date(); due.setDate(due.getDate() + 30);
          DB.insert('invoices', {
            invoiceNo: poNumber, type: 'Purchase', partyId: sup.id, partyName: sup.name,
            amount: qty * cost, paid: 0, status: 'Pending', date,
            dueDate: due.toISOString().slice(0, 10), refId: rec2.id, notes: 'Supplier bill'
          });
          DB.update('suppliers', sup.id, { balance: num(sup.balance) + qty * cost });
          audit('CREATE', 'Purchases', poNumber, `${fmt(qty)} × ${item.model} from ${sup.name}`);
          toast(`Purchase order ${poNumber} created`, 'good');
        }
        closeModal(el);
        renderAll();
      };
      upd();
    }
  });
};

/* ------------------------------------------------------------- Sale */
Modals.saleForm = function () {
  if (!requireWrite('sales', 'create sales')) return;
  const lines = DB.get('inventory').filter(l => l.type !== 'Repair' && inHand(l) > 0);
  openModal({
    width: 'lg', title: 'Create sales order',
    sub: 'Sold units are deducted from the warehouse ledger immediately.',
    body: `
      <div class="form-grid">
        ${field('Customer', selectControl('sfCustomer', customerOptions(), ''), { required: true })}
        ${field('Payment method', selectControl('sfPayment', ['Cash', 'Card', 'Bank', 'Cheque', 'Credit'], 'Cash'))}
        ${field('Stock line', selectControl('sfLine', optionsFromList(lines, '', l => `${l.sku} — ${l.color} · ${l.house} (${fmt(inHand(l))})`, 'Select a line…'), ''), { required: true })}
        ${field('Quantity', `<input class="input" id="sfQty" type="number" min="1" value="1">`, { required: true })}
        ${field('Unit price', `<input class="input" id="sfPrice" type="number" min="0" step="0.01" value="0">`)}
        ${field('Dispatch from', selectControl('sfHouse', housesOptions('', 'Select facility…'), 'Main House'))}
        ${field('Discount', `<input class="input" id="sfDiscount" type="number" min="0" value="0">`)}
        ${field('Status', selectControl('sfStatus', [['Paid','Paid now'],['Pending','Pending payment'],['Shipped','Shipped']], 'Paid'))}
        ${field('Note', `<input class="input" id="sfNote" placeholder="Optional">`, { span: 2 })}
      </div>
      <div class="callout ok mt-16" id="sfPreview"><span class="lead">◫</span><div class="body">Select a stock line to preview the order.</div></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Create order &amp; print invoice</button>`,
    onMount(el) {
      const upd = () => {
        const l = DB.byId('inventory', $('sfLine', el).value);
        if (l && !num($('sfPrice', el).value)) $('sfPrice', el).value = num(l.unitPrice) || 0;
        const q = num($('sfQty', el).value);
        const p = num($('sfPrice', el).value);
        const d = num($('sfDiscount', el).value);
        if (!l) { $('sfPreview', el).innerHTML = '<span class="lead">◫</span><div class="body">Select a stock line.</div>'; return; }
        $('sfPreview', el).innerHTML = `<span class="lead">◫</span><div class="body">
          <b>${fmt(q)} × ${esc(l.sku)} at ${money(p)}</b>
          Subtotal ${money(q * p)} · discount ${money(d)} · <b>total ${money(Math.max(0, q * p - d))}</b><br>
          <span class="fs-11">Available after sale: ${fmt(inHand(l) - q)} units${q > inHand(l) ? ' — insufficient stock!' : ''}</span></div>`;
      };
      $('sfLine', el).onchange = upd;
      ['sfQty', 'sfPrice', 'sfDiscount'].forEach(id => $(id, el).oninput = upd);
      qs('[data-save]', el).onclick = () => {
        const cust = DB.byId('customers', $('sfCustomer', el).value);
        const l = DB.byId('inventory', $('sfLine', el).value);
        const qty = num($('sfQty', el).value);
        if (!cust) return toast('Choose a customer', 'bad');
        if (!l) return toast('Choose a stock line', 'bad');
        if (qty <= 0) return toast('Quantity must be at least 1', 'bad');
        if (qty > inHand(l)) return toast(`Only ${fmt(inHand(l))} units available`, 'bad');
        const price = num($('sfPrice', el).value) || num(l.unitPrice) || 0;
        const discount = num($('sfDiscount', el).value);
        const status = $('sfStatus', el).value;
        const payment = $('sfPayment', el).value;
        const paid = status === 'Paid';
        const subtotal = qty * price;
        const sale = commitSale({
          customerId: cust.id, customerName: cust.name, customerPhone: cust.phone,
          items: [{ lineId: l.id, sku: l.sku, color: l.color, house: l.house, qty, price, cost: num(l.unitCost) }],
          subtotal, discount, total: Math.max(0, subtotal - discount),
          paymentMethod: payment, warehouse: $('sfHouse', el).value || l.house,
          paid, status, note: $('sfNote', el).value.trim(), source: 'Sales desk'
        });
        toast(`Order ${sale.orderId} created`, 'good');
        closeModal(el);
        renderAll();
        Docs.invoice(sale.id);
      };
      upd();
    }
  });
};

/* --------------------------------------------------------- Dispatch */
Modals.dispatchForm = function () {
  if (!requireWrite('dispatch', 'create dispatches')) return;
  const sales = DB.get('sales');
  const customers = DB.get('customers');
  openModal({
    width: 'lg', title: 'New dispatch',
    sub: 'Send a paid or pending order out for delivery.',
    body: `
      <div class="form-grid">
        ${field('Link to sales order', selectControl('dfSale', optionsFromList(sales, '', s => `${s.orderId} — ${s.customerName} (${money(s.total)})`, 'Standalone dispatch'), ''), { span: 2 })}
        ${field('Customer', `<input class="input" id="dfCustomer" placeholder="Customer name">`, { required: true })}
        ${field('Phone', `<input class="input" id="dfPhone" placeholder="Contact number">`)}
        ${field('Contents', `<input class="input" id="dfItems" placeholder="e.g. HONOR 400 Lite × 2">`, { span: 2 })}
        ${field('Courier', selectControl('dfCourier', COURIERS, 'BlueEx'))}
        ${field('Tracking number', `<input class="input" id="dfTracking" placeholder="Consignment / AWB">`)}
        ${field('Destination route', `<input class="input" id="dfRoute" placeholder="e.g. Dhaka North">`)}
        ${field('Expected delivery', `<input class="input" id="dfEta" type="date" value="${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}">`)}
        ${field('Weight (kg)', `<input class="input" id="dfWeight" type="number" min="0" step="0.01" value="1">`)}
        ${field('Delivery charge', `<input class="input" id="dfCost" type="number" min="0" step="0.01" value="0">`)}
        ${field('Status', selectControl('dfStatus', DISPATCH_FLOW, 'Packed'))}
        ${field('Dispatched by', `<input class="input" id="dfBy" value="${esc(state.session.user.name)}">`)}
        ${field('Notes', `<input class="input" id="dfNotes" placeholder="Optional handling notes">`, { span: 2 })}
      </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Create dispatch</button>`,
    onMount(el) {
      $('dfSale', el).onchange = () => {
        const s = DB.byId('sales', $('dfSale', el).value);
        if (!s) return;
        $('dfCustomer', el).value = s.customerName;
        $('dfPhone', el).value = s.customerPhone || '';
        $('dfItems', el).value = (s.items || []).map(i => `${i.sku} × ${i.qty}`).join(', ');
      };
      qs('[data-save]', el).onclick = () => {
        const name = $('dfCustomer', el).value.trim();
        if (!name) return toast('Customer name is required', 'bad');
        const sale = DB.byId('sales', $('dfSale', el).value);
        const id = `DSP-${todayISO().replace(/-/g, '')}-${String(DB.get('dispatches').length + 1).padStart(4, '0')}`;
        DB.insert('dispatches', {
          dispatchId: id, saleId: sale ? sale.id : '', orderId: sale ? sale.orderId : '',
          date: todayISO(), customer: name, phone: $('dfPhone', el).value.trim(),
          items: $('dfItems', el).value.trim(), courier: $('dfCourier', el).value,
          tracking: $('dfTracking', el).value.trim(), route: $('dfRoute', el).value.trim(),
          status: $('dfStatus', el).value, eta: $('dfEta', el).value,
          weight: num($('dfWeight', el).value), cost: num($('dfCost', el).value),
          dispatchedBy: $('dfBy', el).value.trim(), notes: $('dfNotes', el).value.trim()
        });
        if (sale) DB.update('sales', sale.id, { status: 'Shipped' });
        audit('DISPATCH', 'Dispatch', id, `${name} via ${$('dfCourier', el).value}`);
        toast(`Dispatch ${id} created`, 'good');
        closeModal(el);
        renderAll();
      };
    }
  });
};

/* ----------------------------------------------------------- Repair */
Modals.repairForm = function (existing) {
  const r = existing || null;
  openModal({
    width: 'lg',
    title: r ? 'Edit repair ticket' : 'New repair / BadBin intake',
    sub: 'Register a returned or defective device for triage and workshop repair.',
    body: `
      <div class="form-grid">
        ${field('Ticket number', `<input class="input" id="rfNo" value="${esc(r ? r.ticketNo : `RPR-${todayISO().replace(/-/g, '')}-${String(DB.get('repairs').length + 1).padStart(3, '0')}`)}" readonly>`, { span: 2 })}
        ${field('IMEI', `<input class="input mono" id="rfImei" value="${esc(r ? r.imei : '')}" placeholder="15-digit identifier">`)}
        ${field('IMEI 2', `<input class="input mono" id="rfImei2" value="${esc(r ? r.imei2 : '')}" placeholder="Dual-SIM second IMEI">`)}
        ${field('Serial number', `<input class="input mono" id="rfSerial" value="${esc(r ? r.serialNumber : '')}" placeholder="Serial / SN">`)}
        ${field('Brand', `<input class="input" id="rfBrand" value="${esc(r ? r.brand : '')}" placeholder="HONOR">`)}
        ${field('Model', `<input class="input" id="rfModel" value="${esc(r ? r.model : '')}" placeholder="e.g. HONOR 400 Lite" list="modelList">`, { required: true })}
        <datalist id="modelList">${DB.get('items').map(i => `<option value="${esc(i.model)}">`).join('')}</datalist>
        ${field('Colour', `<input class="input" id="rfColor" value="${esc(r ? r.color : '')}" placeholder="Black">`)}
        ${field('Defect category', selectControl('rfDefect', DEFECT_TYPES, r ? r.defectType : 'Display / Touch'), { required: true })}
        ${field('Customer name', `<input class="input" id="rfCust" value="${esc(r ? r.customerName : '')}" placeholder="Customer">`)}
        ${field('Customer phone', `<input class="input" id="rfPhone" value="${esc(r ? r.customerPhone : '')}" placeholder="01XXXXXXXXX">`)}
        ${field('Intake date', `<input class="input" id="rfIntake" type="date" value="${r ? r.intakeDate : todayISO()}">`)}
        ${field('Promised date', `<input class="input" id="rfPromised" type="date" value="${r ? r.promisedDate : new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)}">`)}
        ${field('Technician', `<input class="input" id="rfTech" value="${esc(r ? r.technician : '')}" placeholder="Assign later if unknown">`)}
        ${field('Status', selectControl('rfStatus', REPAIR_STATUSES, r ? r.status : 'Received'))}
        ${field('Parts cost', `<input class="input" id="rfCost" type="number" min="0" value="${num(r ? r.cost : 0)}">`)}
        ${field('Labour cost', `<input class="input" id="rfLabour" type="number" min="0" value="${num(r ? r.labourCost : 0)}">`)}
        ${field('Discount', `<input class="input" id="rfDisc" type="number" min="0" value="${num(r ? r.discount : 0)}">`)}
        ${field('Warranty claim', `<label class="check" style="height:38px"><input type="checkbox" id="rfWarranty" ${r && r.warrantyClaim ? 'checked' : ''}> Raise against manufacturer warranty</label>`)}
        ${field('Diagnosis notes', `<textarea class="input" id="rfNotes" placeholder="Symptoms reported, inspection findings…">${esc(r ? r.notes : '')}</textarea>`, { span: 2 })}
      </div>
      <div class="span-all" id="rfAlerts"></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${r ? 'Save ticket' : 'Create ticket'}</button>`,
    onMount(el) {
      const checkDup = () => {
        const imei = $('rfImei', el).value.trim();
        const serial = $('rfSerial', el).value.trim();
        const box = $('rfAlerts', el);
        const hits = [];
        if (imei) { const h = findImei(imei); if (h) hits.push({ v: imei, h }); }
        if (serial) { const h = findImei(serial); if (h) hits.push({ v: serial, h }); }
        const inBatch = DB.get('repairs').filter(x => x.id !== (r ? r.id : '') && (norm(x.imei) === norm(imei) || norm(x.serialNumber) === norm(serial))).length;
        if (inBatch) hits.push({ v: `${inBatch} existing ticket(s)`, h: { source: 'repair', record: { ticketNo: 'see registry', status: 'Already registered', house: 'Service Center' } } });
        box.innerHTML = hits.length ? `<div class="collide"><strong>⚠ Identifier already in the system</strong>
          ${hits.map(x => {
            const rec = x.h.record;
            const where = x.h.source === 'registry' ? `${rec.house} · ${rec.status}` : x.h.source === 'repair' ? `Ticket ${rec.ticketNo} · ${rec.status}` : `Movement ${rec.trxRef}`;
            return `<div class="mono" style="margin-top:4px">${esc(x.v)} <span style="opacity:.8">→ ${esc(where)}</span></div>`;
          }).join('')}</div>` : '';
      };
      ['rfImei', 'rfSerial'].forEach(id => $(id, el).onblur = checkDup);
      $('rfModel', el).onchange = () => {
        const it = DB.get('items').find(i => norm(i.model) === norm($('rfModel', el).value));
        if (it) { $('rfBrand', el).value = it.brand; if (!$('rfCost', el).value) $('rfCost', el).value = Math.round(it.cost * 0.06); }
      };
      qs('[data-save]', el).onclick = () => {
        const model = $('rfModel', el).value.trim();
        if (!model) { $('rfModel', el).classList.add('err'); return toast('Model is required', 'bad'); }
        const payload = {
          ticketNo: $('rfNo', el).value, imei: $('rfImei', el).value.trim(), imei2: $('rfImei2', el).value.trim(),
          serialNumber: $('rfSerial', el).value.trim(), model,
          brand: $('rfBrand', el).value.trim(), color: $('rfColor', el).value.trim(),
          defectType: $('rfDefect', el).value, customerName: $('rfCust', el).value.trim(),
          customerPhone: $('rfPhone', el).value.trim(), intakeDate: $('rfIntake', el).value,
          promisedDate: $('rfPromised', el).value, technician: $('rfTech', el).value.trim(),
          status: $('rfStatus', el).value, cost: num($('rfCost', el).value),
          labourCost: num($('rfLabour', el).value), discount: num($('rfDisc', el).value),
          warrantyClaim: $('rfWarranty', el).checked,
          notes: $('rfNotes', el).value.trim(),
          destination: $('rfStatus', el).value === 'Scrapped' ? 'Scrap Yard' : 'Service Lab'
        };
        if (r) {
          DB.update('repairs', r.id, payload);
          audit('UPDATE', 'After-Sales', payload.ticketNo, 'Ticket updated');
          toast('Ticket updated', 'good');
        } else {
          const rec = DB.insert('repairs', Object.assign({ completedDate: '', paid: false }, payload));
          if (payload.imei) {
            const ex = DB.get('imeis').find(i => norm(i.imei) === norm(payload.imei));
            if (ex) DB.update('imeis', ex.id, { status: 'Received', ticketNo: payload.ticketNo, house: 'Service Center' });
            else DB.insert('imeis', { imei: payload.imei, sku: model, brand: payload.brand, house: 'Service Center', color: payload.color, status: 'Received', ticketNo: payload.ticketNo, addedAt: nowISO(), note: 'BadBin intake' });
          }
          audit('CREATE', 'After-Sales', payload.ticketNo, `${model} — ${payload.defectType}`);
          toast(`Ticket ${payload.ticketNo} created`, 'good');
        }
        closeModal(el);
        renderAll();
      };
    }
  });
};

/* -------------------------------------------------- Customer / Supplier */
Modals.customerForm = function (existing) {
  const c = existing || null;
  openModal({
    width: 'md', title: c ? 'Edit customer' : 'New customer',
    sub: 'Credit limit and balance are used by the finance and receivables views.',
    body: `<div class="form-grid">
      ${field('Customer name', `<input class="input" id="cfName" value="${esc(c ? c.name : '')}" placeholder="Business or person name">`, { required: true, span: 2 })}
      ${field('Phone', `<input class="input" id="cfPhone" value="${esc(c ? c.phone : '')}" placeholder="+8801XXXXXXXXX">`)}
      ${field('Email', `<input class="input" id="cfEmail" type="email" value="${esc(c ? c.email : '')}" placeholder="name@example.com">`)}
      ${field('City', `<input class="input" id="cfCity" value="${esc(c ? c.city : '')}" placeholder="City">`)}
      ${field('Address', `<input class="input" id="cfAddress" value="${esc(c ? c.address : '')}" placeholder="Street / area">`)}
      ${field('Credit limit', `<input class="input" id="cfLimit" type="number" min="0" value="${num(c ? c.creditLimit : 0)}">`)}
      ${field('Opening balance', `<input class="input" id="cfBalance" type="number" min="0" value="${num(c ? c.balance : 0)}">`)}
      ${field('Status', selectControl('cfStatus', ['Active', 'Inactive'], c ? c.status : 'Active'))}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${c ? 'Save changes' : 'Create customer'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['cfName'])) return;
        const payload = {
          name: $('cfName', el).value.trim(), phone: $('cfPhone', el).value.trim(),
          email: $('cfEmail', el).value.trim(), city: $('cfCity', el).value.trim(),
          address: $('cfAddress', el).value.trim(), creditLimit: num($('cfLimit', el).value),
          balance: num($('cfBalance', el).value), status: $('cfStatus', el).value
        };
        if (c) { DB.update('customers', c.id, payload); audit('UPDATE', 'Customers', payload.name, 'Customer updated'); toast('Customer updated', 'good'); }
        else { DB.insert('customers', payload); audit('CREATE', 'Customers', payload.name, 'Customer created'); toast('Customer created', 'good'); }
        closeModal(el); renderAll();
      };
    }
  });
};
Modals.supplierForm = function (existing) {
  const s = existing || null;
  openModal({
    width: 'md', title: s ? 'Edit supplier' : 'New supplier',
    sub: 'Payable balance flows into the finance view automatically.',
    body: `<div class="form-grid">
      ${field('Supplier name', `<input class="input" id="sfName" value="${esc(s ? s.name : '')}" placeholder="Company name">`, { required: true, span: 2 })}
      ${field('Phone', `<input class="input" id="sfPhone" value="${esc(s ? s.phone : '')}" placeholder="+8802XXXXXXXXX">`)}
      ${field('Email', `<input class="input" id="sfEmail" type="email" value="${esc(s ? s.email : '')}">`)}
      ${field('City', `<input class="input" id="sfCity" value="${esc(s ? s.city : '')}">`)}
      ${field('Address', `<input class="input" id="sfAddress" value="${esc(s ? s.address : '')}">`)}
      ${field('Account number', `<input class="input mono" id="sfAccount" value="${esc(s ? s.accountNo : '')}">`)}
      ${field('Payment terms', selectControl('sfTerms', ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Cash on delivery'], s ? s.paymentTerms : 'Net 30'))}
      ${field('Opening balance', `<input class="input" id="sfBalance" type="number" min="0" value="${num(s ? s.balance : 0)}">`)}
      ${field('Status', selectControl('sfStatus', ['Active', 'Inactive'], s ? s.status : 'Active'))}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${s ? 'Save changes' : 'Create supplier'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['sfName'])) return;
        const payload = {
          name: $('sfName', el).value.trim(), phone: $('sfPhone', el).value.trim(),
          email: $('sfEmail', el).value.trim(), city: $('sfCity', el).value.trim(),
          address: $('sfAddress', el).value.trim(), accountNo: $('sfAccount', el).value.trim(),
          paymentTerms: $('sfTerms', el).value, balance: num($('sfBalance', el).value),
          status: $('sfStatus', el).value
        };
        if (s) { DB.update('suppliers', s.id, payload); audit('UPDATE', 'Suppliers', payload.name, 'Supplier updated'); toast('Supplier updated', 'good'); }
        else { DB.insert('suppliers', payload); audit('CREATE', 'Suppliers', payload.name, 'Supplier created'); toast('Supplier created', 'good'); }
        closeModal(el); renderAll();
      };
    }
  });
};

/* ------------------------------------------------------------ Invoice */
Modals.invoiceForm = function (existing) {
  const inv = existing || null;
  openModal({
    width: 'md', title: inv ? 'Edit invoice' : 'Create standalone invoice',
    sub: 'Use for service charges and manual documents not tied to a sale.',
    body: `<div class="form-grid">
      ${field('Invoice number', `<input class="input mono" id="ifNo" value="${esc(inv ? inv.invoiceNo : nextNumber('INV', DB.get('invoices'), 'invoiceNo'))}">`, { required: true })}
      ${field('Type', selectControl('ifType', ['Sale', 'Purchase', 'Service'], inv ? inv.type : 'Service'))}
      ${field('Party', `<input class="input" id="ifParty" value="${esc(inv ? inv.partyName : '')}" placeholder="Customer or supplier">`, { required: true, span: 2 })}
      ${field('Amount', `<input class="input" id="ifAmount" type="number" min="0" step="0.01" value="${num(inv ? inv.amount : 0)}">`, { required: true })}
      ${field('Amount settled', `<input class="input" id="ifPaid" type="number" min="0" step="0.01" value="${num(inv ? inv.paid : 0)}">`)}
      ${field('Invoice date', `<input class="input" id="ifDate" type="date" value="${inv ? inv.date : todayISO()}">`)}
      ${field('Due date', `<input class="input" id="ifDue" type="date" value="${inv ? inv.dueDate : new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)}">`)}
      ${field('Status', selectControl('ifStatus', ['Pending', 'Approved', 'Paid', 'Overdue', 'Cancelled'], inv ? inv.status : 'Pending'), { span: 2 })}
      ${field('Notes', `<input class="input" id="ifNotes" value="${esc(inv ? inv.notes : '')}" placeholder="Optional">`, { span: 2 })}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${inv ? 'Save changes' : 'Create invoice'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['ifNo', 'ifParty'])) return;
        const amount = num($('ifAmount', el).value);
        const paid = num($('ifPaid', el).value);
        const payload = {
          invoiceNo: $('ifNo', el).value.trim(), type: $('ifType', el).value,
          partyName: $('ifParty', el).value.trim(), amount, paid,
          status: paid >= amount && amount > 0 ? 'Paid' : $('ifStatus', el).value,
          date: $('ifDate', el).value, dueDate: $('ifDue', el).value,
          notes: $('ifNotes', el).value.trim(), refId: inv ? inv.refId : ''
        };
        if (inv) { DB.update('invoices', inv.id, payload); audit('UPDATE', 'Invoices', payload.invoiceNo, 'Invoice updated'); toast('Invoice updated', 'good'); }
        else { DB.insert('invoices', payload); audit('CREATE', 'Invoices', payload.invoiceNo, `Invoice for ${payload.partyName} — ${money(amount)}`); toast('Invoice created', 'good'); }
        closeModal(el); renderAll();
      };
    }
  });
};

/* ----------------------------------------------------------- Employee */
Modals.employeeForm = function (existing) {
  const e = existing || null;
  openModal({
    width: 'md', title: e ? 'Edit employee' : 'New employee',
    sub: 'Employees drive payroll, leave and attendance.',
    body: `<div class="form-grid">
      ${field('Full name', `<input class="input" id="efName" value="${esc(e ? e.name : '')}" placeholder="Full name">`, { required: true })}
      ${field('Employee code', `<input class="input mono" id="efCode" value="${esc(e ? e.code : `E-${String(DB.get('employees').length + 101)}`)}">`)}
      ${field('Email', `<input class="input" id="efEmail" type="email" value="${esc(e ? e.email : '')}">`, { required: true })}
      ${field('Phone', `<input class="input" id="efPhone" value="${esc(e ? e.phone : '')}">`)}
      ${field('Department', selectControl('efDept', DEPARTMENTS, e ? e.department : 'Operations'))}
      ${field('Designation', `<input class="input" id="efRole" value="${esc(e ? e.role : '')}" placeholder="Job title">`)}
      ${field('Facility', selectControl('efHouse', housesOptions('', 'Select facility…'), e ? e.location : 'Main House'))}
      ${field('Monthly salary', `<input class="input" id="efSalary" type="number" min="0" value="${num(e ? e.salary : 0)}">`)}
      ${field('Joining date', `<input class="input" id="efJoin" type="date" value="${e ? e.joinDate : todayISO()}">`)}
      ${field('Status', selectControl('efStatus', ['Active', 'On Leave', 'Inactive'], e ? e.status : 'Active'))}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${e ? 'Save changes' : 'Add employee'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['efName', 'efEmail'])) return;
        const payload = {
          name: $('efName', el).value.trim(), code: $('efCode', el).value.trim(),
          email: $('efEmail', el).value.trim(), phone: $('efPhone', el).value.trim(),
          department: $('efDept', el).value, role: $('efRole', el).value.trim(),
          location: $('efHouse', el).value || 'Main House', salary: num($('efSalary', el).value),
          joinDate: $('efJoin', el).value, status: $('efStatus', el).value
        };
        if (e) { DB.update('employees', e.id, payload); audit('UPDATE', 'Employees', payload.name, 'Employee updated'); toast('Employee updated', 'good'); }
        else { DB.insert('employees', payload); audit('CREATE', 'Employees', payload.name, 'Employee added'); toast('Employee added', 'good'); }
        closeModal(el); renderAll();
      };
    }
  });
};

/* ------------------------------------------------------ Leave / Punch */
Modals.leaveForm = function () {
  if (!requireWrite('leave', 'submit leave')) return;
  openModal({
    width: 'md', title: 'Request leave',
    sub: 'Day count is calculated automatically from the date range.',
    body: `<div class="form-grid">
      ${field('Employee', selectControl('lfEmp', employeeOptions(), ''), { required: true, span: 2 })}
      ${field('Leave type', selectControl('lfType', LEAVE_TYPES, 'Annual Leave'))}
      ${field('Status', selectControl('lfStatus', ['Pending', 'Approved', 'Rejected'], 'Pending'))}
      ${field('From date', `<input class="input" id="lfFrom" type="date" value="${todayISO()}">`, { required: true })}
      ${field('To date', `<input class="input" id="lfTo" type="date" value="${todayISO()}">`, { required: true })}
      ${field('Reason', `<textarea class="input" id="lfReason" placeholder="Reason for the request"></textarea>`, { span: 2 })}
    </div>
    <div class="callout info mt-16" id="lfDays"><span class="lead">⊚</span><div class="body">Select dates to calculate the duration.</div></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Submit request</button>`,
    onMount(el) {
      const upd = () => {
        const d = daysBetween($('lfFrom', el).value, $('lfTo', el).value);
        $('lfDays', el).innerHTML = `<span class="lead">⊚</span><div class="body"><b>${fmt(d)} day${d === 1 ? '' : 's'}</b> from ${esc(fmtDate($('lfFrom', el).value))} to ${esc(fmtDate($('lfTo', el).value))}</div>`;
      };
      $('lfFrom', el).onchange = upd; $('lfTo', el).onchange = upd; upd();
      qs('[data-save]', el).onclick = () => {
        const emp = DB.byId('employees', $('lfEmp', el).value);
        if (!emp) return toast('Choose an employee', 'bad');
        const from = $('lfFrom', el).value, to = $('lfTo', el).value;
        if (!from || !to) return toast('Both dates are required', 'bad');
        if (to < from) return toast('The end date must not precede the start date', 'bad');
        DB.insert('leaves', {
          employeeId: emp.id, employeeName: emp.name, type: $('lfType', el).value,
          startDate: from, endDate: to, days: daysBetween(from, to),
          reason: $('lfReason', el).value.trim(), status: $('lfStatus', el).value,
          appliedOn: todayISO(), actionBy: $('lfStatus', el).value !== 'Pending' ? state.session.user.name : '', actionDate: todayISO()
        });
        audit('CREATE', 'Leave', emp.name, `${$('lfType', el).value} ${from} → ${to}`);
        toast('Leave request submitted', 'good');
        closeModal(el); renderAll();
      };
    }
  });
};
Modals.attendanceForm = function () {
  if (!requireWrite('attendance', 'record attendance')) return;
  openModal({
    width: 'md', title: 'Manual attendance punch',
    sub: 'Late arrivals are calculated against the configured shift start time.',
    body: `<div class="form-grid">
      ${field('Employee', selectControl('atEmp', employeeOptions(), ''), { required: true, span: 2 })}
      ${field('Check-in date', `<input class="input" id="atDate" type="date" value="${todayISO()}">`, { required: true })}
      ${field('Check-in time', `<input class="input" id="atTime" type="time" value="${state.db.settings.shiftStart || '09:00'}">`, { required: true })}
      ${field('Device', `<input class="input" id="atDevice" value="MANUAL" placeholder="Device or terminal id">`)}
      ${field('Status', selectControl('atStatus', ['Present', 'Late', 'Absent', 'On Duty', 'Off Duty'], 'Present'), { span: 2 })}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Record punch</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        const emp = DB.byId('employees', $('atEmp', el).value);
        if (!emp) return toast('Choose an employee', 'bad');
        const date = $('atDate', el).value, time = $('atTime', el).value || '09:00';
        const iso = new Date(`${date}T${time}:00`).toISOString();
        DB.insert('attendance', {
          employeeId: emp.id, employeeName: emp.name, code: emp.code, department: emp.department,
          deviceId: $('atDevice', el).value.trim() || 'MANUAL', checkTime: iso, date,
          status: $('atStatus', el).value
        });
        audit('CREATE', 'Attendance', emp.name, `Punch recorded ${date} ${time}`);
        toast('Punch recorded', 'good');
        closeModal(el); renderAll();
      };
    }
  });
};

/* ----------------------------------------------------------- Location */
Modals.locationForm = function (existing) {
  if (!requireAdmin()) return;
  const l = existing || null;
  openModal({
    width: 'sm', title: l ? 'Edit facility' : 'New facility',
    sub: 'Facilities drive every stock routing decision.',
    body: `<div class="form-grid">
      ${field('Facility name', `<input class="input" id="lofName" value="${esc(l ? l.name : '')}" placeholder="e.g. Third House">`, { required: true, span: 2 })}
      ${field('Type', `<input class="input" id="lofType" value="${esc(l ? l.type : 'Warehouse')}" placeholder="Warehouse / retail / lab">`, { span: 2 })}
      ${field('Address', `<input class="input" id="lofAddr" value="${esc(l ? l.address : '')}">`, { span: 2 })}
    </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${l ? 'Save' : 'Add facility'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['lofName'])) return;
        const name = $('lofName', el).value.trim();
        if (DB.get('locations').some(x => norm(x.name) === norm(name) && (!l || x.id !== l.id))) return toast('A facility with that name exists', 'bad');
        const payload = { name, type: $('lofType', el).value.trim(), address: $('lofAddr', el).value.trim(), active: true };
        if (l) { DB.update('locations', l.id, payload); audit('UPDATE', 'System', name, 'Facility updated'); toast('Facility updated', 'good'); }
        else { DB.insert('locations', payload); audit('CREATE', 'System', name, 'Facility added'); toast('Facility added', 'good'); }
        closeModal(el); renderAll();
      };
    }
  });
};

/* ---------------------------------------------------------------- User */
Modals.userForm = function (existing) {
  if (!requireAdmin()) return;
  const u = existing || null;
  openModal({
    width: 'md', title: u ? 'Edit user account' : 'New user account',
    sub: 'The role decides which modules and actions the account can reach.',
    body: `<div class="form-grid">
      ${field('Full name', `<input class="input" id="ufName" value="${esc(u ? u.name : '')}" placeholder="Full name">`, { required: true })}
      ${field('Email', `<input class="input" id="ufEmail" type="email" value="${esc(u ? u.email : '')}" placeholder="user@company.com">`, { required: true })}
      ${field('Role', selectControl('ufRole', ROLES, u ? u.role : 'Viewer'), { required: true, span: 2, hint: 'Administrator and Super Admin can see everything' })}
      ${field('Facility', selectControl('ufHouse', housesOptions('', 'Select facility…'), u ? u.location : 'Main House'))}
      ${field('Status', selectControl('ufStatus', ['Active', 'Disabled'], u ? u.status : 'Active'))}
      ${field('Password', `<input class="input" id="ufPass" value="${esc(u ? u.password : 'admin')}" placeholder="Login password">`, { span: 2, hint: 'Stored in this browser. Use a shared team password if you prefer.' })}
      ${field('Quick-switch PIN', `<input class="input" id="ufPin" inputmode="numeric" maxlength="12" value="${esc(u ? u.pin : '123456')}">`)}
    </div>
    <div class="callout warn mt-16"><span class="lead">⚠</span><div class="body"><b>Role permissions</b>Changing the role immediately changes what this account can see and do.</div></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${u ? 'Save account' : 'Create account'}</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = () => {
        if (!validate(el, ['ufName', 'ufEmail'])) return;
        const email = $('ufEmail', el).value.trim();
        if (DB.get('users').some(x => norm(x.email) === norm(email) && (!u || x.id !== u.id))) return toast('That email already has an account', 'bad');
        const payload = {
          name: $('ufName', el).value.trim(), email, role: $('ufRole', el).value,
          location: $('ufHouse', el).value || 'Main House', status: $('ufStatus', el).value,
          password: $('ufPass', el).value || 'admin', pin: $('ufPin', el).value || '123456'
        };
        if (u) {
          DB.update('users', u.id, payload);
          if (state.session.user.id === u.id) {
            state.session.user.role = payload.role;
            store.set(APP.sessionKey, JSON.stringify(state.session));
          }
          audit('UPDATE', 'Admin', email, `Account updated — role ${payload.role}`);
          toast('Account updated', 'good');
        } else {
          DB.insert('users', Object.assign({ joinedAt: todayISO() }, payload));
          audit('CREATE', 'Admin', email, `Account created with role ${payload.role}`);
          toast('Account created', 'good');
        }
        closeModal(el); renderAll();
      };
    }
  });
};

/* -------------------------------------------------------- Bulk import */
Modals.bulkImport = function () {
  if (!requireAdmin()) return;
  const entities = ['items', 'inventory', 'customers', 'suppliers', 'employees', 'sales', 'purchases', 'repairs', 'transfers', 'invoices'];
  openModal({
    width: 'md', title: 'Bulk CSV import',
    sub: 'Map CSV columns onto the selected collection. Existing records with the same id are skipped.',
    body: `
      <div class="field mb-12"><label>Target collection</label>
        ${selectControl('biEntity', entities, 'items')}</div>
      <div class="field mb-12"><label>CSV file</label><input class="input" id="biFile" type="file" accept=".csv,text/csv"></div>
      <div class="field mb-12"><label>Or paste CSV</label><textarea class="input" id="biText" rows="7" placeholder="name,brand,cost,price&#10;HONOR X9b,HONOR,33200,37900"></textarea></div>
      <div class="callout info"><span class="lead">i</span><div class="body"><b>How it works</b>
        Header row names are normalised to lowercase-with-dashes. Missing numeric fields default to zero, booleans to <span class="mono">Active</span>/<span class="mono">true</span>.</div></div>
      <div id="biResult" class="mt-16"></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn" data-template>⭳ Template</button><button class="btn primary" data-go>Import</button>`,
    onMount(el) {
      qs('[data-template]', el).onclick = () => bulkTemplate($('biEntity', el).value);
      qs('[data-go]', el).onclick = async () => {
        const entity = $('biEntity', el).value;
        let text = $('biText', el).value.trim();
        const file = $('biFile', el).files[0];
        if (!text && file) text = await file.text();
        if (!text) return toast('Choose a file or paste CSV content', 'bad');
        const { records } = parseCSV(text);
        if (!records.length) return toast('No data rows found in the CSV', 'bad');
        const ok = await confirmDialog({ title: 'Import rows?', confirmLabel: `Import ${records.length} row(s)`, message: `${records.length} record(s) into ${entity}` });
        if (!ok) return;
        const n = bulkInsert(entity, records);
        audit('IMPORT', 'Admin', entity, `${n} record(s) imported from CSV`);
        toast(`${n} record(s) imported into ${entity}`, 'good');
        $('biResult', el).innerHTML = `<div class="callout ok"><span class="lead">✓</span><div class="body"><b>Imported ${n} of ${records.length} rows</b>Duplicates by id were skipped.</div></div>`;
        renderAll();
      };
    }
  });
};
function bulkTemplate(entity) {
  const cols = {
    items: ['model', 'brand', 'type', 'config', 'cost', 'price', 'reorderPoint', 'warrantyMonths', 'note'],
    inventory: ['sku', 'brand', 'type', 'house', 'color', 'unitCost', 'unitPrice', 'openingQty', 'inQty', 'outQty', 'soldQty', 'adjustedQty'],
    customers: ['name', 'phone', 'email', 'city', 'address', 'creditLimit', 'balance', 'status'],
    suppliers: ['name', 'phone', 'email', 'city', 'address', 'accountNo', 'paymentTerms', 'balance', 'status'],
    employees: ['code', 'name', 'email', 'phone', 'department', 'role', 'location', 'salary', 'joinDate', 'status'],
    sales: ['orderId', 'invoiceNo', 'date', 'customerName', 'customerPhone', 'subtotal', 'discount', 'total', 'paymentMethod', 'status', 'warehouse'],
    purchases: ['poNumber', 'supplier', 'date', 'item', 'qty', 'cost', 'status', 'eta', 'house'],
    repairs: ['ticketNo', 'imei', 'serialNumber', 'model', 'brand', 'defectType', 'customerName', 'customerPhone', 'status', 'intakeDate', 'promisedDate', 'technician', 'cost', 'labourCost'],
    transfers: ['transferRef', 'fromLocation', 'toLocation', 'totalUnits', 'status', 'date', 'requestedBy', 'carrier'],
    invoices: ['invoiceNo', 'type', 'partyName', 'amount', 'paid', 'status', 'date', 'dueDate']
  }[entity] || ['name'];
  downloadFile(`${entity}-import-template.csv`, toCSV([cols, cols.map(() => '')]));
  toast(`${entity} template downloaded`, 'good');
}
function bulkInsert(entity, records) {
  const numeric = new Set(['cost', 'price', 'qty', 'total', 'amount', 'paid', 'balance', 'creditLimit', 'salary', 'subtotal', 'discount', 'unitCost', 'unitPrice', 'openingQty', 'inQty', 'outQty', 'soldQty', 'adjustedQty', 'transferInQty', 'transferOutQty', 'returnQty', 'labourCost', 'reorderPoint', 'warrantyMonths', 'totalUnits', 'receivedQty', 'days', 'weight', 'overtimeHours', 'overtimeRate', 'deductions', 'bonus', 'netSalary', 'baseSalary', 'receivedQty', 'imei2', 'discount']);
  const existing = new Set(DB.get(entity).map(r => r.id));
  let n = 0;
  records.forEach(row => {
    const rec = { id: row.id || uid(entity.slice(0, 3).toUpperCase()) };
    Object.entries(row).forEach(([k, v]) => {
      if (k === 'id') return;
      rec[k] = numeric.has(k) ? num(v) : (v === '' ? '' : v);
    });
    if (!rec.status) rec.status = 'Active';
    if (existing.has(rec.id)) return;
    existing.add(rec.id);
    state.db[entity].unshift(rec);
    n++;
  });
  DB.save(true);
  return n;
}

/* -------------------------------------------------------------- Scanner */
let scanner = { stream: null, raf: null, detector: null };
function openScanner(onDetect) {
  const overlay = openModal({
    width: 'sm', autofocus: false,
    title: 'Barcode / QR scanner',
    sub: 'Point the camera at an IMEI or product barcode, or type it below.',
    body: `
      <div class="scan-stage">
        <video id="scanVideo" autoplay muted playsinline></video>
        <div class="scan-frame"></div>
        <div class="scan-status" id="scanStatus">Starting camera…</div>
      </div>
      <div class="field mt-16">
        <label>Scanned value / manual entry</label>
        <input class="input mono" id="scanInput" placeholder="Scan or type a code, then press Apply">
      </div>`,
    foot: `<button class="btn" data-cancel>Close</button><button class="btn primary" data-apply>Apply value</button>`,
    onMount(el) {
      const video = $('scanVideo', el);
      const status = $('scanStatus', el);
      const input = $('scanInput', el);
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
      qs('[data-apply]', el).onclick = apply;
      function apply() {
        const v = input.value.trim();
        if (!v) return toast('Enter or scan a value first', 'warn');
        closeModal(overlay);
        onDetect(v);
      }
      (async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          status.textContent = 'Camera unavailable — use the manual field below';
          return;
        }
        try {
          scanner.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = scanner.stream;
          await video.play();
          status.textContent = 'Camera ready — frame the code';
          if ('BarcodeDetector' in window) {
            scanner.detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix'] });
            status.textContent = 'Scanning…';
            const loop = async () => {
              if (!scanner.stream) return;
              try {
                const found = await scanner.detector.detect(video);
                if (found.length && found[0].rawValue) {
                  input.value = found[0].rawValue;
                  status.textContent = 'Code captured — press Apply';
                  input.focus();
                  return;
                }
              } catch (_) { status.textContent = 'Use the manual field below'; return; }
              scanner.raf = requestAnimationFrame(loop);
            };
            scanner.raf = requestAnimationFrame(loop);
          } else {
            status.textContent = 'Native scanning unsupported — use the manual field';
          }
        } catch (e) {
          status.textContent = 'Camera permission denied — use the manual field';
        }
      })();
    },
    onClose() { stopScanner(); }
  });
  return overlay;
}
function stopScanner() {
  if (scanner.stream) { scanner.stream.getTracks().forEach(t => t.stop()); scanner.stream = null; }
  if (scanner.raf) { cancelAnimationFrame(scanner.raf); scanner.raf = null; }
}

/* ============================================================================
   Bulk selection and bulk operations
   ----------------------------------------------------------------------------
   `Sel` is the row-selection layer used by the table engine. `Pagers.render`
   opts in with `selectable: true` and optionally supplies `bulkActions`:

       Pagers.render('invLines', {
         mount: 'tblInvLines', foot: 'footInvLines', rows, selectable: true,
         bulkActions: [ Sel.act.status('inventory','status',[…]), Sel.act.delete('inventory') ]
       });

   Selection lives in a Set keyed by pager key, so it survives re-renders,
   sorting and page changes, and is pruned to live ids by the engine.
   ========================================================================= */

const Sel = {
  state: {},

  get(key) {
    if (!Sel.state[key]) Sel.state[key] = new Set();
    return Sel.state[key];
  },

  clear(key) { Sel.get(key).clear(); },

  /**
   * Every action needs a distinct `key`, because the key is what a rendered
   * button carries and what the click handler looks the action up by. Two
   * builders of the same kind on one table collide — `edit` twice means the
   * second button runs the first field's action.
   * Development check, so this can never ship unnoticed.
   */
  assertUniqueKeys(opts) {
    const acts = opts.bulkActions || [];
    const seen = new Map();
    const dups = [];
    acts.forEach((a, i) => {
      if (seen.has(a.key)) dups.push(`"${a.key}" (${acts[seen.get(a.key)].label} and ${a.label})`);
      else seen.set(a.key, i);
    });
    if (!dups.length) return;
    const msg = `bulkActions on "${opts.mount || opts.key}" have duplicate keys: ${dups.join(', ')}. `
      + 'Buttons are dispatched by key, so the later ones would run the first action.';
    /* A missing unique key is a programming error, not a runtime condition a
     * user can cause, so surface it as a hard console error and re-render the
     * table without the ambiguous actions. Throwing here would take out the page
     * render and leave the user staring at a blank page, which hides the bug
     * instead of fixing it. */
    console.error(msg);
    toast('A bulk action is misconfigured — see the console', 'bad');
    opts.bulkActions = acts.filter((a, i) => !dups.length || seen.get(a.key) === i);
  },

  /** Selected rows, in the order the table is currently showing them. */
  rowsFor(key, rows) {
    const sel = Sel.get(key);
    return (rows || []).filter(r => sel.has(r.id));
  },

  /* ------------------------------------------------------------- rendering */

  barHtml(key, opts, rows) {
    const sel = Sel.get(key);
    const n = sel.size;
    const total = (rows || []).length;
    if (!n) return `<div class="bulkbar" hidden data-bulkbar></div>`;
    const allMatching = n >= total;
    /* Checked before the buttons are built: the key is what a button carries,
     * and the click handler resolves it with `.find(a => a.key === act)`, which
     * always returns the first match — so a duplicated key means the later
     * button silently runs the earlier action. */
    Sel.assertUniqueKeys(opts);
    const acts = (opts.bulkActions || []).map(a => `
      <button class="btn sm ${a.danger ? 'danger' : ''}" data-bulk="${esc(a.key)}"${a.disabled ? ' disabled' : ''}>
        ${a.icon ? a.icon + ' ' : ''}${esc(a.label)}
      </button>`).join('');
    return `<div class="bulkbar" data-bulkbar>
      <span class="bulk-count"><b>${n}</b> selected</span>
      <button class="btn sm ghost" data-bulk="__all">${allMatching ? 'Clear selection' : `Select all ${fmt(total)}`}</button>
      <span class="bulk-sep"></span>
      ${acts}
      <button class="btn sm ghost" data-bulk="__clear">✕</button>
    </div>`;
  },

  /** Re-render just the bar, so a checkbox click does not rebuild the table. */
  paint(key, opts) {
    const foot = opts.foot && $(opts.foot);
    if (!foot) return;
    const old = qs('[data-bulkbar]', foot);
    if (!old) return;
    const rows = opts.__lastRows || [];
    old.outerHTML = Sel.barHtml(key, opts, rows);
    Sel.wire(key, opts, rows);
  },

  wire(key, opts, rows) {
    opts.__lastRows = rows;
    const foot = opts.foot && $(opts.foot);
    if (!foot) return;
    const sel = Sel.get(key);
    const bar = qs('[data-bulkbar]', foot);
    if (!bar) return;

    $$('[data-bulk]', bar).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const act = b.dataset.bulk;

      if (act === '__clear') { sel.clear(); Pagers.render(key, opts); return; }
      if (act === '__all') {
        const all = (rows || []).length;
        if (sel.size >= all) sel.clear();
        else (rows || []).forEach(r => sel.add(r.id));
        Pagers.render(key, opts);
        return;
      }

      const picked = Sel.rowsFor(key, rows);
      if (!picked.length) { toast('Nothing selected', 'warn'); return; }
      const def = (opts.bulkActions || []).find(a => a.key === act);
      if (!def) return;
      b.disabled = true;
      try {
        await def.run(picked, {
          sel, key, opts, rows,
          /* `opts` is the live config object the page handed to Pagers.render, and
           * renderAll() re-invokes the page render which builds a fresh one. So
           * re-render the owning page by route, then repaint this bar against
           * the config that render just produced. Painting from a stale config
           * would restore pre-action rows — which is how a deleted record used
           * to reappear in the table. */
          repaint: () => {
            const page = document.querySelector('.page.active');
            if (page && state.route) { go(state.route, { noScroll: true, keepModal: true }); }
            else Pagers.render(key, opts);
          }
        });
      } catch (e) {
        console.error('Bulk action failed', act, e);
        toast(e && e.message ? e.message : 'Bulk action failed', 'bad');
      } finally {
        b.disabled = false;
      }
    });
  },

  /* --------------------------------------------------------- action builders */

  act: {
    /** Delete the selected records through the standard deleteRecord() gate. */
    delete(col, label, nameKey) {
      /* Bulk callers often pass only the collection, so derive a readable
       * label instead of rendering "Delete 40 undefined?". */
      const nice = label || col.replace(/s$/, '');
      return {
        key: 'delete', label: 'Delete', icon: '🗑', danger: true,
        async run(rows, ctx) {
          /* Stock lines are identified by SKU, catalogue items by model, and
           * everything else by name. */
          const key = nameKey || (col === 'inventory' ? 'sku' : (col === 'items' ? 'model' : 'name'));
          const ok = await confirmDialog({
            title: `Delete ${rows.length} ${nice}?`,
            message: `This permanently removes ${rows.length} record${rows.length === 1 ? '' : 's'}.`,
            /* `message` is escaped by confirmDialog, so the record list goes in
             * `detail`, which is rendered as HTML. */
            detail: rows.length <= 5
              ? rows.map(r => `<div>${esc(r[key] || r.id)}${r.color ? ` <span class="text-3">· ${esc(r.color)}</span>` : ''}</div>`).join('')
              : `<div>+ ${rows.length - 5} more</div>`,
            confirmLabel: `Delete ${rows.length}`, danger: true
          });
          if (!ok) return;

          /* The permission gate lives in deleteRecord() and must not be skipped:
           * the bulk bar is reachable from a table a role can read but not
           * write, so a role that cannot delete must not be able to delete a
           * hundred rows at once either. Check it once, before any removal. */
          if (!requireWrite(col, `delete ${nice.toLowerCase()}s`)) return;

          /* deleteRecord re-renders and toasts per record, which is far too
           * slow for a full-table delete and produces a toast per row. Do the
           * removal and the audit entries directly, once. */
          let n = 0;
          bulkApply(rows, r => {
            const rec = DB.byId(col, r.id);
            if (!rec) return;
            DB.remove(col, r.id);
            /* audit() appends to state.db.audit and caps it, so use it rather
             * than hand-rolling the row — one place owns the audit format. */
            audit('DELETE', nice, rec[key] || r.id, `${nice} deleted (bulk, ${rows.length} records)`);
            n++;
          });
          toast(`${n} ${nice}${n === 1 ? '' : 's'} deleted`, 'good');
          Sel.clear(ctx.key);
          ctx.repaint();
        }
      };
    },

    /** Set one field to one of several values on every selected record. */
    status(col, field, values, label) {
      const nice = label || field;
      return {
        /* Keyed by field, not by kind: a table can legitimately offer status on
         * two different columns, and a shared key would make the second button
         * silently run the first. */
        key: 'status:' + field, label: nice.charAt(0).toUpperCase() + nice.slice(1), icon: '⇄',
        async run(rows, ctx) {
          const v = await pickValue('Set status for ' + rows.length + ' record' + (rows.length === 1 ? '' : 's'),
            values.map(x => (typeof x === 'string' ? { value: x, label: x } : x)));
          if (v == null) return;
          const n = bulkApply(rows, r => DB.update(col, r.id, { [field]: v }));
          audit('BULK', nice, 'bulk', `${n} records → ${v}`);
          toast(`${n} updated to ${v}`, 'good');
          ctx.repaint();
        }
      };
    },

    /** Point every selected record at a facility / user / technician. */
    assign(col, field, label, sourceFn) {
      return {
        key: 'assign:' + field, label: label, icon: '⇥',
        async run(rows, ctx) {
          const options = sourceFn();
          if (!options.length) { toast('No options available', 'warn'); return; }
          const v = await pickValue(`${label} — ${rows.length} record${rows.length === 1 ? '' : 's'}`, options);
          if (v == null) return;
          const n = bulkApply(rows, r => DB.update(col, r.id, { [field]: v }));
          audit('BULK', label, 'bulk', `${n} records → ${v}`);
          toast(`${n} records updated`, 'good');
          ctx.repaint();
        }
      };
    },

    /**
     * Bulk-edit an arbitrary field. Numeric fields accept a leading operator so
     * stock can be shifted in bulk: "=0" sets, "+500" adds, "-5" subtracts.
     */
    edit(col, field, label, kind) {
      return {
        key: 'edit:' + field, label: label, icon: '✎',
        async run(rows, ctx) {
          const raw = await promptDialog({
            title: `${label} — ${rows.length} record${rows.length === 1 ? '' : 's'}`,
            label: kind === 'number' ? `New ${label.toLowerCase()} (= / + / −)` : `New ${label.toLowerCase()}`,
            value: '',
            placeholder: kind === 'number' ? '+500' : ''
          });
          if (raw == null) return;
          const val = String(raw).trim();
          if (!val) { toast('Nothing entered — no changes made', 'warn'); return; }

          let op = '=', delta = val;
          if (kind === 'number') {
            const m = /^([+\-=])?\s*(-?\d*\.?\d+)$/.exec(val);
            if (!m) { toast(`"${val}" is not a number. Try =0, +500 or -5.`, 'bad'); return; }
            op = m[1] || '=';
            delta = num(m[2]);
          }

          const n = bulkApply(rows, r => {
            if (kind === 'number') {
              const before = num(r[field]);
              const after = op === '=' ? delta : (op === '+' ? before + delta : before - delta);
              DB.update(col, r.id, { [field]: after });
            } else {
              DB.update(col, r.id, { [field]: val });
            }
          });
          audit('BULK', label, 'bulk', `${n} records → ${val}`);
          toast(`${n} record${n === 1 ? '' : 's'} updated`, 'good');
          ctx.repaint();
        }
      };
    },

    /**
     * Settle the outstanding balance on every selected invoice in one pass.
     * Reconciliation is the reason anyone selects a batch of invoices, and doing
     * it per-row is the chore bulk selection is supposed to remove.
     */
    settleInvoices() {
      return {
        key: 'settle', label: 'Mark paid', icon: '✓',
        async run(rows, ctx) {
          const open = rows.filter(r => num(r.amount) - num(r.paid) > 0);
          if (!open.length) { toast('Selected invoices are already settled', 'warn'); return; }

          const totalDue = sum(open, r => num(r.amount) - num(r.paid));
          const ok = await confirmDialog({
            title: `Settle ${open.length} invoice${open.length === 1 ? '' : 's'}?`,
            message: `${money(totalDue)} outstanding will be recorded as received in full.`,
            detail: open.slice(0, 6).map(r =>
              `<div class="kv-row"><span class="k mono">${esc(r.invoiceNo)}</span><span class="v">${esc(r.partyName)} — ${money(num(r.amount) - num(r.paid))}</span></div>`
            ).join('') + (open.length > 6 ? `<div class="fs-11 text-3 mt-8">and ${open.length - 6} more</div>` : ''),
            confirmLabel: 'Record payment', danger: false
          });
          if (!ok) return;

          let n = 0, val = 0;
          bulkApply(open, r => { val += applyInvoicePayment(r, num(r.amount) - num(r.paid)) || 0; n++; });
          audit('PAYMENT', 'Invoices', 'bulk', `${n} invoices settled — ${money(val)}`);
          toast(`${money(val)} recorded across ${n} invoice${n === 1 ? '' : 's'}`, 'good');
          Sel.clear(ctx.key);
          ctx.repaint();
        }
      };
    },

    /** CSV containing only the selected rows. */
    exportRows(col, filename, buildRows) {
      return {
        key: 'export', label: 'Export selected', icon: '⭳',
        async run(rows, ctx) {
          const table = buildRows(rows);
          exportCSV(filename, table);
          ctx.repaint();
        }
      };
    }
  }
};

/* --------------------------------------------------------- bulk record ops */

/**
 * Apply a change to many records while writing to storage exactly once.
 *
 * DB.update() saves on every call, and each save serialises the entire
 * document. Importing 5,000 rows that way re-serialises the database 5,000
 * times, which is what makes bulk import appear to hang. Suspending the save
 * turns that into a single write at the end.
 */
function bulkApply(rows, fn) {
  DB.suspend();
  let n = 0;
  try {
    for (const r of rows) { fn(r); n++; }
  } finally {
    DB.resume(true);
  }
  return n;
}

/* ------------------------------------------------------------- value picker */

/**
 * Small modal that asks for one value from a list. Resolves to the value, or
 * null if dismissed. Used by the bulk status/assign actions.
 */
function pickValue(title, options) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const ov = openModal({
      width: 'sm', title, autofocus: false,
      body: `<div class="picklist">${options.map(o =>
        `<button class="pick" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`,
      /* Only a dismissal resolves null. */
      onClose() { finish(null); }
    });
    $$('[data-v]', ov).forEach(b => b.onclick = () => {
      /* Resolve before closing: closeModal runs onClose synchronously, which
       * would win the race and discard the chosen value, making every bulk
       * Status and Assign action a silent no-op. */
      const v = b.dataset.v;
      finish(v);
      closeModal(ov);
    });
  });
}

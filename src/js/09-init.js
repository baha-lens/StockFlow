/* ==========================================================================
   AMAYA ERP — Boot, event wiring, global search
   ========================================================================== */

/**
 * Apply a theme by id.
 *
 * Themes are a registry (16-experience.js) plus a matching CSS block per
 * `html[data-theme="..."]`. A stored id that no longer exists - an older build,
 * a typo, a hand-edited value - falls back to light rather than leaving the
 * document with no theme tokens at all, which would render as unstyled text.
 */
function applyTheme(theme) {
  const t = themeById(theme) ? theme : 'light';
  state.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  store.set(APP.themeKey, t);
  renderThemeButton();
  return t;
}

function renderThemeButton() {
  const btn = $('themeBtn');
  if (!btn) return;
  const t = themeById(state.theme) || themeById('light');
  btn.textContent = t.dark ? '☾' : '☀';
  btn.title = `Theme: ${t.label} — click to choose`;
  btn.setAttribute('aria-label', `Theme: ${t.label}. Choose a different theme.`);
}

/** Step to the next theme. Shift-click steps backwards, for keyboard users
 *  who would otherwise have to click through the whole list to get one back. */
function cycleTheme(dir = 1) {
  const i = THEME_IDS.indexOf(state.theme);
  const next = THEME_IDS[(i + dir + THEME_IDS.length) % THEME_IDS.length];
  applyTheme(next);
  renderAll();
}

/** The theme chooser. Also reachable from Settings, so the button in the
 *  top bar is a shortcut rather than the only route. */
function openThemePicker() {
  const overlay = openModal({
    width: 'sm', autofocus: false, title: 'Choose a theme',
    sub: 'Saved on this device. Applies immediately, no reload.',
    body: `<div class="theme-grid">${THEMES.map(t => `
        <button class="theme-swatch ${state.theme === t.id ? 'on' : ''}" data-theme-pick="${t.id}">
          <span class="sw-chips">${t.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="sw-body">
            <b>${esc(t.label)}</b>
            <small>${esc(t.hint)}</small>
          </span>
          <span class="sw-tick">${state.theme === t.id ? '✓' : ''}</span>
        </button>`).join('')}</div>
      <div class="section-title mt-16">Layout</div>
      <div class="btn-group" style="width:100%">
        ${['auto', 'phone', 'desktop'].map(m => `
          <button class="btn grow ${Layout.mode === m ? 'primary' : ''}" data-ff="${m}">
            ${m === 'auto' ? '⤢ Follow device' : m === 'phone' ? '▯ Phone' : '▭ Desktop'}
          </button>`).join('')}
      </div>
      <div class="form-hint mt-8">Layout is currently <b>${esc(Layout.get())}</b>.
        Phone stacks the navigation at the bottom and opens panels full-screen;
        desktop keeps the sidebar and shows tables side by side.</div>`,
    foot: `<button class=\"btn\" data-cancel>Close</button>`,
    onMount(el) {
      $$('[data-theme-pick]', el).forEach(b => b.onclick = () => {
        applyTheme(b.dataset.themePick);
        $$('[data-theme-pick]', el).forEach(x => {
          x.classList.toggle('on', x.dataset.themePick === state.theme);
          qs('.sw-tick', x).textContent = x.dataset.themePick === state.theme ? '✓' : '';
        });
        renderAll();
      });
      $$('[data-ff]', el).forEach(b => b.onclick = () => {
        Layout.set(b.dataset.ff);
        $$('[data-ff]', el).forEach(x => x.classList.toggle('primary', x.dataset.ff === Layout.mode));
      });
      qs('[data-cancel]', el).onclick = () => closeModal(el);
    }
  });
  return overlay;
}

function showLogin() {
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  renderLoginScreen();
  /* Never leave a password sitting in a field on a shared counter machine. */
  $('loginPassword').value = '';
  const btn = $('loginBtn');
  if (btn) btn.disabled = false;
}
function showApp() {
  $('loginScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  applyTheme(state.theme);
  Sync.startAuto();
  /* Populate the identity badge and enforce the role's permissions first. */
  renderAll();
  const hash = (location.hash || '').replace('#/', '');
  go(PAGE_META[hash] && canSee(hash) ? hash : 'dashboard', { silent: true });
}

function renderLoginScreen() {
  const feats = [
    ['▣', 'Master stock ledger with IMEI-level traceability'],
    ['⇋', 'Multi-stage warehouse transfers with printable gate passes'],
    ['◈', 'After-sales BadBin workshop, warranty and GoodBin recovery'],
    ['▤', 'Retail POS, sales, purchasing and dispatch in one flow'],
    ['◉', 'HR module — payroll, leave and biometric attendance'],
    ['◍', 'Finance, analytics and a full audit trail on every action']
  ];
  $('loginFeats').innerHTML = feats.map(f => `<div class="login-feat"><i>${f[0]}</i><span>${esc(f[1])}</span></div>`).join('');

  const inv = DB.get('inventory');
  $('loginStats').innerHTML = `
    <div><b>${esc(state.db.settings.company || APP.company)}</b><small>Deployment</small></div>
    <div><b>${fmt(inv.length)}</b><small>Stock lines</small></div>
    <div><b>${fmt(DB.get('locations').length)}</b><small>Facilities</small></div>`;

  /* The demo quick-login buttons are a first-run convenience and a security
   * problem the moment a real deployment exists: they sign anyone in as a
   * seeded superadmin with the password "admin", one tap away, on a shared
   * counter machine. So they exist only until setup has been completed, and
   * after that they are removed from the DOM entirely rather than hidden -
   * a hidden button is still a button. */
  if (setupComplete()) {
    const host = $('quickUsers');
    if (host) {
      host.innerHTML = '';
      host.classList.add('hidden');
    }
    const wrap = $('quickUsersWrap');
    if (wrap) wrap.classList.add('hidden');
    const hint = $('demoHint');
    if (hint) hint.classList.add('hidden');
  } else {
    const demo = DB.get('users').filter(u => u.status === 'Active');
    $('quickUsers').innerHTML = demo.slice(0, 6).map(u =>
      `<button class="quick-user" data-quick-login="${esc(u.email)}">${esc(u.name.split(' ')[0])} · ${esc(u.role)}</button>`).join('');
    $$('[data-quick-login]').forEach(b => b.onclick = () => {
      $('loginEmail').value = b.dataset.quickLogin;
      $('loginPassword').value = 'admin';
      $('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    /* Pre-fill only while the demo is still the fastest way in. After setup the
     * fields stay empty, so a shared machine never shows the previous user's
     * address sitting in a text box. */
    const seed = DB.get('users').find(u => u.role === 'Super Admin' && u.status === 'Active');
    if (seed) {
      $('loginEmail').value = seed.email;
      $('loginPassword').value = 'admin';
    }
  }
}

/* ------------------------------------------------------------ First run ---
 * A setup wizard that creates the real superadmin. It runs once, before the
 * login screen, and is keyed off APP.setupKey rather than a version number:
 * once an owner exists, re-running it could silently hand a second owner
 * access, so the flag is the single source of truth and it is never cleared
 * except by the explicit "reset deployment" action in Admin.
 *
 * Demo data is kept, deliberately. A blank ERP teaches nothing: there is no
 * stock to count, no invoice to chase, no repair to move. The wizard says so
 * plainly and offers a one-tap erase instead, so the choice is the owner's.
 */

/** True once a real superadmin has been created. */
function setupComplete() {
  return !!store.get(APP.setupKey);
}

/** The demo sign-in buttons only make sense before setup. */
function demoLoginAllowed() { return !setupComplete(); }

function runSetupWizard() {
  if (setupComplete()) return;
  const d = DB.get('users').find(u => u.role === 'Super Admin' && u.status === 'Active') || {};
  const s = state.db.settings || {};

  const overlay = openModal({
    width: 'md', autofocus: false, drawer: false,
    title: 'Welcome to AMAYA ERP',
    sub: `Step 1 of 1 · ${BRAND.legalName}`,
    body: `
      <div class="callout info" style="margin-bottom:16px">
        <span class="lead">◎</span>
        <div class="body">
          <b>One step, then you own this deployment</b>
          Create the superadmin account below. It is the only account with full
          access, and it is the account the demo sign-in buttons are removed for.
        </div>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>Business name</label>
          <input class="input" name="suCompany" value="${esc(s.company || BRAND.legalName)}" placeholder="${esc(BRAND.legalName)}">
        </div>
        <div class="field">
          <label>Your full name <span style="color:var(--red)">*</span></label>
          <input class="input" name="suName" placeholder="e.g. Rahman, A." autocomplete="name">
        </div>
        <div class="field">
          <label>Email <span class="form-hint" style="display:inline">— this is your username</span> <span style="color:var(--red)">*</span></label>
          <input class="input" name="suEmail" type="email" inputmode="email" autocomplete="username"
                 value="${esc(d.email || '')}" placeholder="you@amaya.com">
        </div>
        <div class="field">
          <label>Password <span style="color:var(--red)">*</span></label>
          <input class="input" name="suPass" type="password" autocomplete="new-password" placeholder="At least 8 characters">
          <div class="form-hint">Stored on this device only. Change it any time from Admin.</div>
        </div>
      </div>

      <div class="section-title mt-16">Pick how it should look</div>
      <div class="theme-grid">
        ${THEMES.slice(0, 4).map(t => `
          <button class="theme-swatch ${state.theme === t.id ? 'on' : ''}" data-setup-theme="${t.id}" type="button">
            <span class="sw-chips">${t.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>
            <span class="sw-body"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></span>
            <span class="sw-tick">${state.theme === t.id ? '✓' : ''}</span>
          </button>`).join('')}
      </div>
      <div class="form-hint mt-8">You can change this any time from the sun/moon
        button in the top bar, or from Settings.</div>

      <div class="section-title mt-16">Demo data</div>
      <div class="callout warn" style="margin-bottom:12px">
        <span class="lead">◍</span>
        <div class="body">
          <b>${fmt(DB.get('inventory').length)} stock lines, ${fmt(DB.get('customers').length)} customers and
             ${fmt(DB.get('movements').length)} movements are already loaded.</b>
          Keeping them is the fastest way to see what the app does — every report,
          chart and alert is already showing real numbers. Clear them if you would
          rather start from an empty ledger; this cannot be undone.
        </div>
      </div>
      <div class="btn-group" style="width:100%">
        <button class="btn grow primary" data-demo="keep" type="button">✓ Keep the demo data</button>
        <button class="btn grow" data-demo="wipe" type="button">✕ Start empty instead</button>
      </div>`,
    foot: `<span class="left form-hint">Nothing leaves this device. ${esc(BRAND.legalName)} stores its data locally.</span>
      <button class="btn" data-skip type="button">Skip for now</button>
      <button class="btn primary" data-done type="button">Create superadmin</button>`,
    onMount(el) {
      $$('[data-setup-theme]', el).forEach(b => b.onclick = () => {
        applyTheme(b.dataset.setupTheme);
        $$('[data-setup-theme]', el).forEach(x => {
          x.classList.toggle('on', x.dataset.setupTheme === state.theme);
          qs('.sw-tick', x).textContent = x.dataset.setupTheme === state.theme ? '✓' : '';
        });
      });
      qs('[data-skip]', el).onclick = () => closeModal(el);
      qs('[data-done]', el).onclick = () => {
        const company = qs('[name=suCompany]', el).value.trim();
        const name = qs('[name=suName]', el).value.trim();
        const email = qs('[name=suEmail]', el).value.trim().toLowerCase();
        const pass = qs('[name=suPass]', el).value;
        const wipe = qs('[data-demo=wipe]', el).classList.contains('on')
          || qs('[data-demo=wipe]', el).dataset.armed === '1';

        const fail = (msg) => {
          qs('.modal-body', el).insertAdjacentHTML('afterbegin',
            `<div class="callout danger" style="margin-bottom:12px"><span class="lead">⚠</span><div class="body">${esc(msg)}</div></div>`);
        };
        if (!name) return fail('Enter your name so the app knows who is signed in.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter a valid email address — it is your username.');
        if (pass.length < 8) return fail('Use a password of at least 8 characters.');
        if (DB.get('users').some(u => norm(u.email) === norm(email) && u.status === 'Active' && u.role === 'Super Admin'
            && norm(u.email) !== norm(d.email || ''))) {
          return fail('That email already belongs to a superadmin. Pick a different one.');
        }

        if (wipe) {
          /* Same shape as the Admin "erase everything" action, but without the
           * logout: the owner is being created in this same click. The one
           * thing carried across is the settings block, so the company name and
           * currency chosen above survive. */
          const keep = state.db.settings;
          const fresh = DB.blank();
          fresh.settings = Object.assign(defaultSettings(), keep);
          fresh.locations = [{ id: 'LOC-001', name: 'Main House', type: 'Central warehouse', address: '', active: true }];
          fresh.users = [];
          state.db = fresh;
        }
        if (company) {
          state.db.settings.company = company;
        }

        /* Reuse the seeded superadmin row rather than adding a parallel one, so
         * the user list has exactly one owner from the first session onward. */
        const u = d.id ? DB.get('users').find(x => x.id === d.id) : null;
        if (u) {
          Object.assign(u, { name, email, password: pass, role: 'Super Admin', status: 'Active' });
        } else {
          DB.insert('users', {
            name, email, password: pass, role: 'Super Admin', status: 'Active',
            pin: '', location: company || 'Central', joinedAt: todayISO()
          });
        }
        DB.save(true);
        audit('SETUP', 'settings', 'Superadmin created', `${name} <${email}>`);
        store.set(APP.setupKey, JSON.stringify({
          at: nowISO(),
          name, email,
          demoKept: !wipe,
          version: APP.version
        }));
        Layout.install();
        closeModal(el);
        showLogin();
        $('loginEmail').value = email;
        $('loginPassword').value = '';
        toast('Superadmin created — demo sign-in buttons removed', 'good', 5000);
      };
      /* "Start empty" is destructive, so it needs a confirming second tap
         rather than a checkbox that can be mis-read. */
      qs('[data-demo=wipe]', el).onclick = function () {
        const on = this.dataset.armed === '1';
        this.dataset.armed = on ? '0' : '1';
        this.classList.toggle('primary', !on);
        this.classList.toggle('danger', !on);
        this.textContent = on ? '✕ Start empty instead' : '⚠ Tap again to confirm: erase demo data';
        qs('[data-demo=keep]', el).classList.toggle('primary', on);
      };
      qs('[data-demo=keep]', el).onclick = function () {
        this.classList.add('primary');
        const w = qs('[data-demo=wipe]', el);
        w.dataset.armed = '0'; w.classList.remove('primary', 'danger');
        w.textContent = '✕ Start empty instead';
      };
    }
  });
  return overlay;
}

function handleLogin(e) {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const err = $('loginError');
  const res = login(email, password);
  if (res.error) {
    err.innerHTML = `<div class="callout danger"><span class="lead">⚠</span><div class="body">${esc(res.error)}</div></div>`;
    $('loginPassword').value = '';
    $('loginPassword').focus();
    return;
  }
  err.innerHTML = '';
  $('loginPassword').value = '';
  toast(`Welcome, ${res.user.name.split(' ')[0]}`, 'good');
  showApp();
}

/* ------------------------------------------------------- Global search */
const OMNI_SOURCES = () => ([
  { group: 'Navigation', key: 'nav', items: NAV.flatMap(g => g.items).filter(i => canSee(i.key)).map(i => ({ id: i.key, label: i.label, sub: 'Go to module', icon: i.icon })) },
  { group: 'Catalogue', key: 'items', items: DB.get('items').slice(0, 60).map(i => ({ id: i.id, label: i.model, sub: `${i.brand} · ${typeBadge(i.type)}`, page: 'inventory', open: () => openItemDrawer(i.id) })) },
  { group: 'Stock lines', key: 'inv', items: DB.get('inventory').slice(0, 200).map(l => ({ id: l.id, label: l.sku, sub: `${l.color} · ${l.house} · ${fmt(inHand(l))} left`, open: () => openItemDrawer(null, l.id) })) },
  { group: 'IMEI', key: 'imei', items: DB.get('imeis').slice(0, 300).map(i => ({ id: i.id, label: i.imei, sub: `${i.sku || '—'} · ${i.status}`, page: 'repairs', open: () => { state.ui.repTab = 'imei'; go('repairs'); $('repSearch').value = i.imei; renderRepairs(); } })) },
  { group: 'Repairs', key: 'rep', items: DB.get('repairs').map(r => ({ id: r.id, label: `${r.ticketNo} · ${r.model}`, sub: r.status, page: 'repairs', open: () => { state.ui.repTab = 'tickets'; go('repairs'); openRepairDrawer(r.id); } })) },
  { group: 'Customers', key: 'cust', items: DB.get('customers').map(c => ({ id: c.id, label: c.name, sub: c.phone || c.city || 'Customer', page: 'customers', open: () => { go('customers'); $('custSearch').value = c.name; renderCustomers(); } })) },
  { group: 'Suppliers', key: 'supp', items: DB.get('suppliers').map(s => ({ id: s.id, label: s.name, sub: s.accountNo || 'Supplier', page: 'suppliers', open: () => { go('suppliers'); $('suppSearch').value = s.name; renderSuppliers(); } })) },
  { group: 'Sales', key: 'sale', items: DB.get('sales').slice(0, 120).map(s => ({ id: s.id, label: s.orderId, sub: `${s.customerName} · ${money(s.total)}`, page: 'sales', open: () => { go('sales'); openSaleDrawer(s.id); } })) },
  { group: 'Purchases', key: 'po', items: DB.get('purchases').map(p => ({ id: p.id, label: p.poNumber, sub: `${p.supplier} · ${money(p.total)}`, page: 'purchases', open: () => { go('purchases'); openPODrawer(p.id); } })) },
  { group: 'Dispatches', key: 'dsp', items: DB.get('dispatches').map(d => ({ id: d.id, label: d.dispatchId, sub: `${d.customer} · ${d.status}`, page: 'dispatch', open: () => { go('dispatch'); $('dspSearch').value = d.dispatchId; renderDispatch(); } })) },
  { group: 'Transfers', key: 'trf', items: DB.get('transfers').map(t => ({ id: t.id, label: t.transferRef, sub: `${t.fromLocation} → ${t.toLocation} · ${t.status}`, page: 'transfers', open: () => { go('transfers'); $('trfSearch').value = t.transferRef; renderTransfers(); } })) },
  { group: 'Employees', key: 'emp', items: DB.get('employees').map(e => ({ id: e.id, label: e.name, sub: `${e.department} · ${e.role}`, page: 'employees', open: () => { go('employees'); openEmployeeDrawer(e.id); } })) },
  { group: 'Invoices', key: 'inv', items: DB.get('invoices').map(i => ({ id: i.id, label: i.invoiceNo, sub: `${i.partyName} · ${money(i.amount)}`, page: 'invoices', open: () => { go('invoices'); $('invcSearch').value = i.invoiceNo; renderInvoices(); } })) }
]);

let omniIndex = -1, omniHits = [];
function runOmni(term) {
  const box = $('omniResults');
  if (!term || term.length < 1) { box.classList.add('hidden'); omniHits = []; return; }
  const q = norm(term);
  const srcs = OMNI_SOURCES();
  const hits = [];
  srcs.forEach(g => {
    g.items.forEach(it => {
      if (norm(it.label).includes(q) || norm(it.sub).includes(q)) hits.push(Object.assign({ group: g.group }, it));
    });
  });
  omniHits = hits.slice(0, 40);
  omniIndex = omniHits.length ? 0 : -1;
  if (!omniHits.length) {
    box.innerHTML = `<div class="empty" style="padding:22px"><b>No matches for “${esc(term)}”</b><p>Try a model, IMEI, invoice number, customer or reference.</p></div>`;
    box.classList.remove('hidden');
    return;
  }
  let html = '', lastGroup = '';
  omniHits.forEach((h, i) => {
    if (h.group !== lastGroup) { html += `<div class="omni-sec">${esc(h.group)}</div>`; lastGroup = h.group; }
    html += `<button class="omni-item ${i === 0 ? 'sel' : ''}" data-omni="${i}">
      <span class="gi" style="width:16px;text-align:center;opacity:.7">${h.icon || '▤'}</span>
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.label)}</span>
      <small>${esc(h.sub || '')}</small></button>`;
  });
  box.innerHTML = html;
  box.classList.remove('hidden');
  $$('[data-omni]', box).forEach(b => b.onclick = () => pickOmni(Number(b.dataset.omni)));
}
function pickOmni(i) {
  const h = omniHits[i];
  if (!h) return;
  $('omniResults').classList.add('hidden');
  $('omniInput').value = '';
  if (h.open) h.open();
  else if (h.page) go(h.page);
}
function moveOmni(delta) {
  if (!omniHits.length) return;
  omniIndex = (omniIndex + delta + omniHits.length) % omniHits.length;
  $$('[data-omni]', $('omniResults')).forEach((el, i) => el.classList.toggle('sel', i === omniIndex));
  const el = qs(`[data-omni="${omniIndex}"]`, $('omniResults'));
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------- Alerts */
function showNotifications() {
  const alerts = buildAlerts();
  const tasks = DB.get('tasks').filter(t => t.status === 'Open');
  const mine = tasks.filter(t => t.assigneeEmail === (state.session ? state.session.user.email : ''));
  openModal({
    width: 'md', title: 'Alerts & tasks',
    sub: `${alerts.length} condition(s) need attention · ${mine.length} task(s) assigned to you`,
    body: `
      ${alerts.length ? `<div class="section-title">Conditions</div>${alerts.map(a => `
        <div class="list-row clickable" data-go="${a.page}">
          <span class="lead" style="background:${a.bg};color:${a.fg}">${a.icon}</span>
          <span class="body"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span>
          <span class="trail"><span class="badge ${a.cls}">${a.count}</span></span>
        </div>`).join('')}` : '<div class="callout ok mb-16"><span class="lead">✓</span><div class="body"><b>Nothing critical</b>All monitored conditions are within tolerance.</div></div>'}
      <div class="section-title mt-16">Open tasks</div>
      ${tasks.length ? tasks.slice(0, 12).map(t => `
        <div class="list-row">
          <span class="lead" style="background:var(--amber-soft);color:var(--amber-strong)">•</span>
          <span class="body"><b>${esc(t.title)}</b><small>${esc(t.assigneeName || t.assigneeEmail)}${t.due ? ' · due ' + esc(fmtDate(t.due)) : ''}</small></span>
          <span class="trail">${t.assigneeEmail === (state.session ? state.session.user.email : '') ? '<span class="badge amber">Yours</span>' : ''}</span>
        </div>`).join('') : '<p class="text-3 fs-12">No open tasks.</p>'}`,
    foot: `<button class="btn" data-cancel>Close</button>`,
    onMount(el) {
      $$('[data-go]', el).forEach(r => r.onclick = () => { closeModal(el); go(r.dataset.go); });
    }
  });
}

/* ------------------------------------------------------------- Wiring */
function wireEvents() {
  /* Theme. The button opens the chooser; a shift-click is the quick path and
   * steps to the next theme without opening anything. */
  $('themeBtn').onclick = (e) => {
    if (e.shiftKey) return cycleTheme(e.altKey ? -1 : 1);
    openThemePicker();
  };

  /* Navigation */
  $('hamburger').onclick = () => document.body.classList.toggle('nav-open');
  $$('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  $$('[data-quick]').forEach(b => b.onclick = () => {
    const a = b.dataset.quick;
    if (a === 'movement') { if (requireWrite('movements', 'record movements')) Modals.movementForm(); }
    else go(a);
  });
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#/', '');
    if (h && h !== state.route && PAGE_META[h] && canSee(h)) go(h, { noScroll: true });
  });

  /* Sync badge */
  $('syncChip').onclick = async () => {
    if (Sync.mode === 'local' || !Sync.url) {
      go('settings');
      return;
    }
    await Sync.pull();
    toast('Synchronised with the backend', 'good');
  };

  /* Search */
  const omni = $('omniInput');
  omni.oninput = debounce(e => runOmni(e.target.value.trim()), 140);
  omni.onfocus = () => { if (omni.value.trim()) runOmni(omni.value.trim()); };
  omni.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveOmni(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveOmni(-1); }
    if (e.key === 'Enter') { e.preventDefault(); pickOmni(omniIndex); }
    if (e.key === 'Escape') { $('omniResults').classList.add('hidden'); omni.blur(); }
  };
  document.addEventListener('mousedown', e => {
    if (!$('omniWrap').contains(e.target)) $('omniResults').classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); omni.focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); omni.focus(); omni.select(); }
  });

  /* Header actions */
  $('scanBtn').onclick = () => openScanner(v => Modals.movementForm(null, { imeis: [v], immediate: true }));
  $('notifyBtn').onclick = showNotifications;
  $('quickAddBtn').onclick = () => {
    const menu = [
      ['⇄', 'Record movement', 'movements', () => Modals.movementForm()],
      ['▣', 'New item', 'inventory', () => Modals.itemForm()],
      ['◌', 'New sale', 'sales', () => Modals.saleForm()],
      ['⌂', 'Purchase order', 'purchases', () => Modals.purchaseForm()],
      ['⇋', 'New transfer', 'transfers', () => Modals.transferForm()],
      ['◈', 'Repair ticket', 'repairs', () => Modals.repairForm()],
      ['✦', 'New dispatch', 'dispatch', () => Modals.dispatchForm()],
      ['▦', 'New supplier', 'suppliers', () => Modals.supplierForm()],
      ['◎', 'New customer', 'customers', () => Modals.customerForm()],
      ['▤', 'New invoice', 'invoices', () => Modals.invoiceForm()],
      ['◉', 'New employee', 'employees', () => Modals.employeeForm()],
      ['⊚', 'Leave request', 'leave', () => Modals.leaveForm()],
      ['✓', 'Manual punch', 'attendance', () => Modals.attendanceForm()],
      ['⚖', 'Reconcile stock', 'movements', () => Modals.reconcileForm()],
      ['⭳', 'Bulk CSV import', 'admin', () => Modals.bulkImport()],
      ['◫', 'Print stock report', null, () => Docs.stockReport()]
    ].filter(m => m[2] === null || canWrite(m[2]));
    openModal({
      width: 'sm', autofocus: false, title: 'Create new', sub: 'Pick the record type you want to add.',
      body: `<div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin:0">
        ${menu.map((m, i) => `<button class="btn" data-menu="${i}" style="justify-content:flex-start;min-height:44px">${m[0]} ${esc(m[1])}</button>`).join('')}
      </div>`,
      foot: `<button class="btn" data-cancel>Close</button>`,
      onMount(el) {
        $$('[data-menu]', el).forEach(b => b.onclick = () => { const fn = menu[Number(b.dataset.menu)][3]; closeModal(el); fn(); });
      }
    });
  };

  /* Account pill */
  $('userPill').onclick = () => {
    const u = state.session.user;
    const per = perms();
    openModal({
      width: 'sm', title: 'Account & session', sub: u.email,
      body: `
        <div class="row mb-16 gap-12">${avatarNode(u.name, 44)}
          <div><b style="font-size:15px">${esc(u.name)}</b><div class="fs-12 text-2">${esc(u.role)} · ${esc(u.location || 'Central')}</div></div>
        </div>
        <div class="section-title">Your access</div>
        <div class="kv mb-16">
          <div class="kv-row"><span class="k">Modules visible</span><span class="v">${per.pages === '*' ? 'All modules' : per.pages.length}</span></div>
          <div class="kv-row"><span class="k">Can change</span><span class="v">${per.write === '*' ? 'Everything' : (per.write.length ? per.write.join(', ') : 'Read only')}</span></div>
          <div class="kv-row"><span class="k">Signed in</span><span class="v">${esc(fmtDateTime(state.session.at))}</span></div>
          <div class="kv-row"><span class="k">Backend</span><span class="v">${esc(Sync.mode === 'local' ? 'Local (offline)' : Sync.mode)}</span></div>
          <div class="kv-row"><span class="k">Queued changes</span><span class="v">${state.queue.length}</span></div>
        </div>
        <div class="section-title">Switch user</div>
        <div class="field mb-12"><label>Act as</label>
          ${selectControl('swUser', DB.get('users').filter(x => x.status === 'Active').map(x => [x.id, `${x.name} (${x.role})`]), u.id)}</div>
        <div class="row-wrap">
          <button class="btn" data-settings>⚙ Settings</button>
          <button class="btn danger" data-logout>Sign out</button>
        </div>`,
      foot: `<button class="btn" data-cancel>Close</button><button class="btn primary" data-switch>Switch account</button>`,
      onMount(el) {
        qs('[data-cancel]', el).onclick = () => closeModal(el);
        qs('[data-settings]', el).onclick = () => { closeModal(el); go('settings'); };
        qs('[data-logout]', el).onclick = () => { logout(); closeAllModals(); showLogin(); toast('Signed out', 'warn'); };
        qs('[data-switch]', el).onclick = () => {
          const target = $('swUser', el).value;
          if (target === u.id) return closeModal(el);
          switchUser(target);
          closeAllModals();
          toast('Now acting as ' + state.session.user.name, 'good');
          /* Land on a page the new role is actually allowed to open. */
          const h = (location.hash || '').replace('#/', '');
          if (!PAGE_META[h] || !canSee(h)) {
            location.hash = '#/dashboard';
            go('dashboard', { silent: true });
          } else {
            showApp();
            go(h);
          }
          renderAll();
        };
      }
    });
  };

  /* Login form */
  $('loginForm').addEventListener('submit', handleLogin);

  /* Filter re-render bindings */
  const bindFilter = (id, fn) => { const el = $(id); if (el) { el.addEventListener('input', fn); el.addEventListener('change', fn); } };
  bindFilter('invSearch', debounce(renderInventory, 200));
  ['invType', 'invBrand', 'invHouse', 'invStatus'].forEach(id => bindFilter(id, renderInventory));
  $$('#invViewSeg button').forEach(b => b.onclick = () => {
    $$('#invViewSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); renderInventory();
  });
  bindFilter('mvSearch', debounce(renderMovements, 200));
  ['mvType', 'mvHouse', 'mvDays'].forEach(id => bindFilter(id, renderMovements));
  $$('#dashTrendSeg button').forEach(b => b.onclick = () => {
    $$('#dashTrendSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); renderRevenueChart(Number(b.dataset.days));
  });
  bindFilter('trfSearch', debounce(renderTransfers, 200));
  bindFilter('poSearch', debounce(renderPurchases, 200)); bindFilter('poStatus', renderPurchases);
  bindFilter('saleSearch', debounce(renderSales, 200)); ['saleStatus', 'salePay'].forEach(id => bindFilter(id, renderSales));
  bindFilter('posSearch', debounce(renderPOS, 200)); ['posBrand', 'posHouse'].forEach(id => bindFilter(id, renderPOS));
  bindFilter('dspSearch', debounce(renderDispatch, 200)); bindFilter('dspStatus', renderDispatch);
  bindFilter('repSearch', debounce(renderRepairs, 200)); ['repStatus', 'repDefect'].forEach(id => bindFilter(id, renderRepairs));
  $$('#repTabs button').forEach(b => b.onclick = () => { state.ui.repTab = b.dataset.tab; renderRepairs(); });
  bindFilter('upgSearch', debounce(renderUpgrades, 200)); ['upgStage', 'upgSeries'].forEach(id => bindFilter(id, renderUpgrades));
  bindFilter('custSearch', debounce(renderCustomers, 200)); bindFilter('custStatus', renderCustomers);
  bindFilter('suppSearch', debounce(renderSuppliers, 200)); bindFilter('suppStatus', renderSuppliers);
  bindFilter('invcSearch', debounce(renderInvoices, 200)); ['invcType', 'invcStatus'].forEach(id => bindFilter(id, renderInvoices));
  bindFilter('empSearch', debounce(renderEmployees, 200)); ['empDept', 'empStatus'].forEach(id => bindFilter(id, renderEmployees));
  bindFilter('paySearch', debounce(renderPayroll, 200)); ['payMonth', 'payStatus'].forEach(id => bindFilter(id, renderPayroll));
  bindFilter('leaveSearch', debounce(renderLeave, 200)); bindFilter('leaveStatus', renderLeave);
  bindFilter('attSearch', debounce(renderAttendance, 200)); ['attDate', 'attStatus'].forEach(id => bindFilter(id, renderAttendance));
  bindFilter('auditSearch', debounce(renderAudit, 200)); ['auditModule', 'auditAction'].forEach(id => bindFilter(id, renderAudit));

  /* Page action buttons */
  $('btnAddItem').onclick = () => { if (requireWrite('inventory', 'add catalogue items')) Modals.itemForm(); };
  $('btnReconcile').onclick = () => { if (requireWrite('movements', 'reconcile stock')) Modals.reconcileForm(); };
  $('btnExportInv').onclick = exportInventoryCSV;
  $('btnExportMv').onclick = exportMovementsCSV;
  $('btnExportUpg').onclick = exportTradeInCSV;
  $('btnNewTransfer').onclick = () => Modals.transferForm();
  $('btnNewPO').onclick = () => { if (requireWrite('purchases', 'raise purchase orders')) Modals.purchaseForm(); };
  $('btnNewSale').onclick = () => { if (requireWrite('sales', 'create sales')) Modals.saleForm(); };
  $('btnNewDispatch').onclick = () => { if (requireWrite('dispatch', 'create dispatches')) Modals.dispatchForm(); };
  $('btnNewTrade').onclick = () => Modals.tradeForm();
  $('btnNewRepair').onclick = () => { if (requireWrite('repairs', 'log repairs')) Modals.repairForm(); };
  $('btnNewCustomer').onclick = () => { if (requireWrite('customers', 'add customers')) Modals.customerForm(); };
  $('btnNewSupplier').onclick = () => { if (requireWrite('suppliers', 'add suppliers')) Modals.supplierForm(); };
  $('btnNewInvoice').onclick = () => { if (requireWrite('invoices', 'create invoices')) Modals.invoiceForm(); };
  $('btnNewEmployee').onclick = () => { if (requireWrite('employees', 'add employees')) Modals.employeeForm(); };
  $('btnNewLeave').onclick = () => Modals.leaveForm();
  $('btnNewAtt').onclick = () => { if (requireWrite('attendance', 'record attendance')) Modals.attendanceForm(); };
  $('btnRunPayroll').onclick = () => runPayrollMonth();
  $('btnImportAtt').onclick = importAttendanceDialog;

  /* ---- Live attendance ---- */
  $('btnLiveRefresh').onclick = async () => { await DeviceHub.sync(); renderLive(); toast('Live view refreshed', 'good'); };
  $('btnCopyLive').onclick = () => {
    if (!DeviceHub.configured) return toast('No bridge configured — set the URL in Settings first', 'warn');
    copyText(DeviceHub.liveUrl, 'Live view link copied to your clipboard');
  };
  $('btnForcePoll').onclick = async () => {
    try { await DeviceHub.forcePoll(); renderLive(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  $$('#liveFilterSeg button').forEach(b => b.onclick = () => {
    $$('#liveFilterSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.ui.liveFilter = b.dataset.lf;
    renderLive();
  });
  $('btnAddLocation').onclick = () => Modals.locationForm();
  $('btnSaveSettings').onclick = saveCompanySettings;
  $('btnBulkImport').onclick = () => Modals.bulkImport();
  $('btnBulkTemplate').onclick = () => bulkTemplate($('bulkEntity').value);
  $('btnExportAudit').onclick = exportAuditCSV;
  $('btnClearAudit').onclick = clearAudit;
  $('btnPrintReport').onclick = () => { $$('.page').forEach(p => p.classList.remove('print-active')); $('page-reports').classList.add('print-active'); window.print(); setTimeout(() => $('page-reports').classList.remove('print-active'), 500); };
  $('btnReportExport').onclick = exportFullReport;
  $('btnExportPO').onclick = exportPurchaseCSV;
  $('btnExportSales').onclick = exportSalesCSV;
  $('btnExportDsp').onclick = exportDispatchCSV;
  $('btnExportRep').onclick = exportRepairCSV;
  $('btnExportCust').onclick = exportCustomerCSV;
  $('btnExportSupp').onclick = exportSupplierCSV;
  $('btnExportInv2').onclick = exportInvoiceCSV;
  $('btnExportEmp').onclick = exportEmployeeCSV;
  $('btnExportPay').onclick = exportPayrollCSV;
  $('btnExportAtt').onclick = exportAttendanceCSV;
  $('btnExportFin').onclick = exportFinanceCSV;

  /* Choosing a CSV on the settings page opens the import dialog */
  $('bulkFile').onchange = () => { Modals.bulkImport(); };

  /* Delegated stat-card navigation. A card with a drill key opens the records
   * behind the number; a card naming only a page falls through to navigation.
   * One listener covers every card in the app, including ones rendered later. */
  document.addEventListener('click', e => {
    const stat = e.target.closest('[data-stat]');
    if (stat && stat.dataset.stat) {
      /* A card inside a row must not double-fire with the row's own handler. */
      e.preventDefault();
      e.stopPropagation();
      openStatTarget(stat.dataset.stat);
      return;
    }
    const empty = e.target.closest('[data-empty]');
    if (empty && empty.dataset.empty) {
      const label = empty.dataset.empty;
      const map = { inventory: () => go('inventory'), item: () => Modals.itemForm(), purchase: () => Modals.purchaseForm(), sale: () => Modals.saleForm(), trade: () => Modals.tradeForm() };
      (map[label] || (() => {}))();
    }
  });

  /* Online / offline */
  window.addEventListener('online', () => {
    toast('Connection restored', 'good');
    if (Sync.mode !== 'local' && Sync.url) { Sync.drain().then(() => Sync.pull()); }
    else Sync.setStatus('idle', 'Local mode');
  });
  window.addEventListener('offline', () => {
    toast('You are offline — changes will be queued', 'warn');
    Sync.setStatus('offline', state.queue.length ? `Offline (${state.queue.length} queued)` : 'Offline');
  });

  /* Persist on unload */
  window.addEventListener('beforeunload', () => DB.save(true));
}

/* ---------------------------------------------------------- CSV exports */
function exportInventoryCSV() {
  const rows = [['SKU', 'Brand', 'Category', 'Facility', 'Colour', 'Unit cost', 'Retail price', 'Opening', 'IN', 'OUT', 'Transfer in', 'Transfer out', 'Returned', 'Sold', 'Adjusted', 'Available', 'Value']];
  DB.get('inventory').forEach(l => rows.push([l.sku, l.brand, l.type, l.house, l.color, l.unitCost, l.unitPrice, l.openingQty, l.inQty, l.outQty, l.transferInQty, l.transferOutQty, l.returnQty, l.soldQty, l.adjustedQty, inHand(l), round2(lineValue(l))]));
  exportCSV('amaya-inventory', rows);
}
function exportCatalogueCSV() {
  const rows = [['Model', 'Brand', 'Category', 'Config', 'Cost', 'Price', 'Reorder point', 'Warranty (months)', 'Note']];
  DB.get('items').forEach(i => rows.push([i.model, i.brand, i.type, i.config, i.cost, i.price, i.reorderPoint, i.warrantyMonths, i.note]));
  exportCSV('amaya-catalogue', rows);
}
function exportMovementsCSV() {
  const rows = [['Reference', 'Date', 'Type', 'SKU', 'Brand', 'Facility', 'Colour', 'Qty', 'Source', 'Note', 'Serials', 'User', 'Role']];
  DB.get('movements').forEach(m => rows.push([m.trxRef, m.date, m.type, m.sku, m.brand, m.house, m.color, m.qty, m.source, m.note, (m.imeis || []).map(i => i.imei).join(' '), m.user, m.role]));
  exportCSV('amaya-movements', rows);
}
function exportPurchaseCSV() {
  const rows = [['PO number', 'Date', 'Supplier', 'Item', 'Category', 'Destination', 'Qty', 'Received', 'Unit cost', 'Total', 'Status', 'ETA']];
  DB.get('purchases').forEach(p => rows.push([p.poNumber, p.date, p.supplier, p.item, p.type, p.house, p.qty, p.receivedQty, p.cost, p.total, p.status, p.eta]));
  exportCSV('amaya-purchase-orders', rows);
}
function exportSalesCSV() {
  const rows = [['Order', 'Invoice', 'Date', 'Customer', 'Phone', 'Facility', 'Items', 'Subtotal', 'Discount', 'Total', 'Payment', 'Status', 'Sold by']];
  DB.get('sales').forEach(s => rows.push([s.orderId, s.invoiceNo, s.date, s.customerName, s.customerPhone, s.warehouse, (s.items || []).map(i => `${i.sku} x${i.qty}`).join(' | '), s.subtotal, s.discount, s.total, s.paymentMethod, s.status, s.user]));
  exportCSV('amaya-sales', rows);
}
function exportDispatchCSV() {
  const rows = [['Dispatch', 'Order', 'Date', 'Customer', 'Phone', 'Contents', 'Courier', 'Tracking', 'Route', 'Weight', 'Charge', 'ETA', 'Status', 'By']];
  DB.get('dispatches').forEach(d => rows.push([d.dispatchId, d.orderId, d.date, d.customer, d.phone, d.items, d.courier, d.tracking, d.route, d.weight, d.cost, d.eta, d.status, d.dispatchedBy]));
  exportCSV('amaya-dispatches', rows);
}
function exportRepairCSV() {
  const rows = [['Ticket', 'Intake', 'IMEI', 'IMEI 2', 'Serial', 'Model', 'Brand', 'Colour', 'Defect', 'Customer', 'Phone', 'Technician', 'Status', 'Promised', 'Completed', 'Destination', 'Parts', 'Labour', 'Discount', 'Paid']];
  DB.get('repairs').forEach(r => rows.push([r.ticketNo, r.intakeDate, r.imei, r.imei2, r.serialNumber, r.model, r.brand, r.color, r.defectType, r.customerName, r.customerPhone, r.technician, r.status, r.promisedDate, r.completedDate, r.destination, r.cost, r.labourCost, r.discount, r.paid ? 'Yes' : 'No']));
  exportCSV('amaya-repairs', rows);
}
function exportCustomerCSV() {
  const rows = [['Name', 'Phone', 'Email', 'City', 'Address', 'Credit limit', 'Balance', 'Status']];
  DB.get('customers').forEach(c => rows.push([c.name, c.phone, c.email, c.city, c.address, c.creditLimit, c.balance, c.status]));
  exportCSV('amaya-customers', rows);
}
function exportSupplierCSV() {
  const rows = [['Name', 'Phone', 'Email', 'City', 'Address', 'Account', 'Terms', 'Balance', 'Status']];
  DB.get('suppliers').forEach(s => rows.push([s.name, s.phone, s.email, s.city, s.address, s.accountNo, s.paymentTerms, s.balance, s.status]));
  exportCSV('amaya-suppliers', rows);
}
function exportInvoiceCSV() {
  const rows = [['Invoice', 'Type', 'Party', 'Amount', 'Settled', 'Outstanding', 'Date', 'Due', 'Status']];
  DB.get('invoices').forEach(i => rows.push([i.invoiceNo, i.type, i.partyName, i.amount, i.paid, round2(num(i.amount) - num(i.paid)), i.date, i.dueDate, i.status]));
  exportCSV('amaya-invoices', rows);
}
function exportTradeInCSV() {
  /* The margin and the trade gap are both exported deliberately. A trade-in
   * sheet that only carried the credit given would hide the one number that
   * tells the owner whether the desk is profitable. */
  const rows = [['Reference', 'Date', 'Customer', 'Phone', 'Incoming model', 'Incoming brand', 'Incoming IMEI',
    'Condition', 'Grade', 'Outgoing model', 'Outgoing IMEI', 'Facility', 'New price', 'Credit given',
    'Payable', 'Refund due', 'New cost', 'Margin', 'Incoming worth', 'Credit above worth', 'Stage',
    'Received on', 'Invoice', 'Note']];
  DB.get('upgrades').forEach(u => rows.push([
    u.ref, u.date, u.customerName, u.customerPhone, u.oldModel, u.oldBrand, u.oldImei,
    u.condition, u.grade, u.newModel, u.newImei, u.warehouse,
    u.newGross, u.creditValue, u.payable, u.refundDue, u.newCost, u.margin,
    u.incomingWorth, u.tradeGap, u.status,
    u.receivedAt ? u.receivedAt.slice(0, 10) : '', u.invoiceNo || '', u.note || ''
  ]));
  exportCSV('amaya-trade-ins', rows);
}
function exportEmployeeCSV() {
  const rows = [['Code', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Facility', 'Salary', 'Joined', 'Status']];
  DB.get('employees').forEach(e => rows.push([e.code, e.name, e.email, e.phone, e.department, e.role, e.location, e.salary, e.joinDate, e.status]));
  exportCSV('amaya-employees', rows);
}
function exportPayrollCSV() {
  const rows = [['Employee', 'Code', 'Month', 'Base', 'Overtime hours', 'Overtime rate', 'Overtime pay', 'Bonus', 'Deductions', 'Net', 'Status', 'Paid on']];
  DB.get('payroll').forEach(p => rows.push([p.employeeName, p.code, p.month, p.baseSalary, p.overtimeHours, p.overtimeRate, round2(p.overtimeHours * p.overtimeRate), p.bonus, p.deductions, p.netSalary, p.status, p.paidDate]));
  exportCSV('amaya-payroll', rows);
}
function exportAttendanceCSV() {
  const rows = [['Employee', 'Code', 'Department', 'Device', 'Date', 'Check in', 'Status']];
  DB.get('attendance').forEach(a => rows.push([a.employeeName, a.code, a.department, a.deviceId, a.date, a.checkTime, a.status]));
  exportCSV('amaya-attendance', rows);
}
function exportAuditCSV() {
  const rows = [['Timestamp', 'User', 'Role', 'Action', 'Module', 'Reference', 'Detail']];
  DB.get('audit').forEach(a => rows.push([a.timestamp, a.user, a.role, a.action, a.module, a.recordId, a.details]));
  exportCSV('amaya-audit-log', rows);
}
function exportFinanceCSV() {
  const rows = [['Invoice', 'Type', 'Party', 'Amount', 'Settled', 'Outstanding', 'Date', 'Due', 'Status']];
  DB.get('invoices').forEach(i => rows.push([i.invoiceNo, i.type, i.partyName, i.amount, i.paid, round2(num(i.amount) - num(i.paid)), i.date, i.dueDate, i.status]));
  const inv = DB.get('inventory');
  rows.push([]);
  rows.push(['STOCK VALUATION BY FACILITY']);
  rows.push(['Facility', 'Units', 'At cost', 'At retail']);
  Object.entries(groupBy(inv, l => l.house || 'Unassigned')).forEach(([h, l]) => rows.push([h, sum(l, inHand), round2(sum(l, lineValue)), round2(sum(l, x => inHand(x) * num(x.unitPrice)))]));
  rows.push(['TOTAL', totalUnits(), round2(inventoryValue()), round2(sum(inv, l => inHand(l) * num(l.unitPrice)))]);
  exportCSV('amaya-finance-summary', rows);
}
function exportFullReport() {
  const lines = [
    ['AMAYA INDUSTRIES ERP — CONSOLIDATED REPORT'],
    ['Generated', new Date().toLocaleString()],
    [''],
    ['HEADLINE FIGURES'],
    ['Total units in hand', totalUnits()],
    ['Inventory value at cost', round2(inventoryValue())],
    ['Inventory value at retail', round2(sum(DB.get('inventory'), l => inHand(l) * num(l.unitPrice)))],
    ['Stock lines', DB.get('inventory').length],
    ['Catalogue items', DB.get('items').length],
    ['Facilities', DB.get('locations').length],
    [''],
    ['STOCK BY FACILITY'],
    ['Facility', 'Lines', 'Units', 'Value at cost']
  ];
  Object.entries(groupBy(DB.get('inventory'), l => l.house || 'Unassigned')).forEach(([h, l]) => lines.push([h, l.length, sum(l, inHand), round2(sum(l, lineValue))]));
  lines.push([''], ['STOCK BY CATEGORY'], ['Category', 'Lines', 'Units', 'Value']);
  Object.entries(groupBy(DB.get('inventory'), l => l.type || 'Regular')).forEach(([t, l]) => lines.push([t, l.length, sum(l, inHand), round2(sum(l, lineValue))]));
  lines.push([''], ['MOVEMENT SUMMARY'], ['Type', 'Entries', 'Units']);
  ['IN', 'OUT', 'SALE', 'RETURN', 'ADJUST', 'TRANSFER IN', 'TRANSFER OUT'].forEach(t => {
    const m = DB.get('movements').filter(x => x.type === t);
    if (m.length) lines.push([t, m.length, sum(m, x => x.qty)]);
  });
  lines.push([''], ['FINANCIAL POSITION'],
    ['Revenue (all time)', round2(sum(DB.get('sales'), s => s.total))],
    ['Receivables', round2(sum(DB.get('invoices').filter(i => i.type === 'Sale' && i.status !== 'Paid'), i => num(i.amount) - num(i.paid)))],
    ['Payables', round2(sum(DB.get('invoices').filter(i => i.type === 'Purchase' && i.status !== 'Paid'), i => num(i.amount) - num(i.paid)))],
    ['Payroll processed', round2(sum(DB.get('payroll').filter(p => p.status === 'Processed'), p => p.netSalary))]
  );
  lines.push([''], ['SERVICE CENTRE'], ['Tickets', DB.get('repairs').length], ['Open', DB.get('repairs').filter(r => !['Repaired', 'GoodBin Returned', 'Scrapped', 'Returned to Customer'].includes(r.status)).length], ['IMEIs registered', DB.get('imeis').length]);
  exportCSV('amaya-consolidated-report', lines);
}

/* --------------------------------------------------------- Dialogs */
function saveCompanySettings() {
  const s = state.db.settings;
  s.company = $('setCompany').value.trim() || s.company;
  s.address = $('setAddress').value.trim();
  s.phone = $('setPhone').value.trim();
  s.email = $('setEmail').value.trim();
  s.taxNo = $('setTax').value.trim();
  s.currency = ($('setCurrency').value || '৳').trim();
  s.threshold = Math.max(0, num($('setThreshold').value));
  s.shiftStart = $('setShift').value || '09:00';
  s.footerNote = $('setFooter').value.trim();
  DB.save(true);
  audit('UPDATE', 'System', 'settings', 'Company settings updated');
  toast('Settings saved', 'good');
  renderAll();
}
function importAttendanceDialog() {
  openModal({
    width: 'md', title: 'Import attendance device log',
    sub: 'Paste the JSON payload exported from your biometric terminal.',
    body: `
      <div class="callout info mb-16"><span class="lead">i</span><div class="body"><b>Expected format</b>
        An array of objects with <span class="mono">employee_name</span>, <span class="mono">employee_id</span>,
        <span class="mono">device_id</span>, <span class="mono">check_time</span> and optional <span class="mono">status</span>.</div></div>
      <div class="field">
        <label>JSON payload</label>
        <textarea class="input mono" id="imJson" rows="10" style="font-size:11px">[
  {"employee_name":"Ayesha Khan","employee_id":"E-101","device_id":"ZKT-01","check_time":"${new Date().toISOString().slice(0, 11)}08:52:00Z","status":"in"}
]</textarea>
      </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-go>Import punches</button>`,
    onMount(el) {
      qs('[data-go]', el).onclick = () => {
        const n = importAttendanceLogs($('imJson', el).value);
        if (n) { toast(`${n} punch(es) imported`, 'good'); closeModal(el); renderAll(); }
      };
    }
  });
}
async function clearAudit() {
  const ok = await confirmDialog({
    title: 'Clear the audit log?', danger: true, confirmLabel: 'Clear log',
    message: `${DB.get('audit').length} events will be deleted.`,
    detail: 'The audit trail is your accountability record. Export a copy first if you need it.'
  });
  if (!ok) return;
  state.db.audit = [];
  DB.save(true);
  toast('Audit log cleared', 'warn');
  renderAudit();
}

/* ---------------------------------------------------------------- Boot */
function boot() {
  /* The form factor has to be known before anything renders, because the CSS
   * keys off html[data-ff] and a wrong value means a visible reflow. It also
   * needs the database loaded, because Layout.detect() asks Native, and the
   * native bridge is only meaningful once the app knows it is running. */
  DB.load();
  Layout.install();
  applyTheme(state.theme);
  paintBrand();

  /* Drill registry. Registered after the pages are declared but before the
   * first render, so a stat card painted in the very first frame already has
   * something behind it. */
  registerPageDrills();
  registerMetricDrills();
  registerCardDrills();

  wireEvents();

  /* Hardware back handling. On the web this installs an Escape fallback, which
   * the existing modal handler also uses; BackNav defers to the modal stack
   * first, so the two cannot fight over the same press. */
  BackNav.install();
  BackNav.reset('dashboard');

  if (!store.available) {
    setTimeout(() => toast('Browser storage is blocked - data will reset when this tab closes. Use Settings → Backup to keep a copy.', 'warn', 9000), 900);
  }

  if (restoreSession()) {
    showApp();
    if (state.db.settings.backendMode !== 'local' && Sync.url && navigator.onLine) Sync.pull();
  } else {
    showLogin();
    /* First run, and only first run: ask the owner to create the superadmin.
     * Deferred a tick so the login screen paints first, otherwise the wizard
     * appears over a blank page and the transition reads as a glitch. */
    if (!setupComplete()) setTimeout(runSetupWizard, 90);
  }

  /* Keep the sync badge honest even in local mode */
  if (Sync.mode === 'local') Sync.setStatus('idle', state.db.meta.updatedAt ? `Local · ${relTime(state.db.meta.updatedAt)}` : 'Local mode');
  else Sync.setStatus('idle', 'Not synced yet');

  /* Start the terminal bridge if one is configured. It pings and syncs
     immediately, then keeps running on its own interval. */
  DeviceHub.start();

  /* Keep the sidebar badge live between pages. */
  setInterval(() => {
    if (document.hidden || !state.session) return;
    if (state.modalStack.length) return;
    if (DeviceHub.configured && state.route === 'live') renderLive();
    renderNav();
  }, 60000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* ==========================================================================
   StockFlow ERP — Google Sign-In (GSI) Integration
   Uses Google Identity Services (GIS) One Tap + Button rendering.
   Client ID is set via Settings → companyGoogleClientId.
   ========================================================================== */

const GoogleAuth = {
  clientId: null,

  init() {
    // Read client ID from settings or fall back to a placeholder
    this.clientId = state.db.settings.googleClientId || '';
    if (!this.clientId || typeof google === 'undefined' || !google.accounts) {
      /* GIS not loaded or no client ID configured — render a setup hint */
      const btn = $('googleSignInBtn');
      if (btn && !this.clientId) {
        btn.innerHTML = `<div style="font-size:11px;color:var(--text-3);text-align:center;padding:8px 0;">
          <a href="#" onclick="go('settings');return false;" style="color:var(--amber);">Configure Google Client ID in Settings</a> to enable Google Sign-In.
        </div>`;
      }
      return;
    }

    /* Initialize Google Identity Services */
    google.accounts.id.initialize({
      client_id: this.clientId,
      callback: this.handleCredential.bind(this),
      auto_select: false,
      cancel_on_tap_outside: true
    });

    /* Render the styled Google button */
    const btnHost = $('googleSignInBtn');
    if (btnHost) {
      google.accounts.id.renderButton(btnHost, {
        type: 'standard',
        shape: 'rectangular',
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        text: 'signin_with',
        width: 300
      });
    }

    /* One Tap prompt (only in non-setup/production context) */
    if (setupComplete()) google.accounts.id.prompt();
  },

  /**
   * Callback from Google after the user selects their account.
   * Decodes the JWT credential and maps it to a StockFlow user by email.
   */
  handleCredential(response) {
    try {
      /* Decode payload (NOT verified on client — HTTPS + GSI handles this) */
      const parts = response.credential.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

      const email = (payload.email || '').toLowerCase();
      const name = payload.name || payload.given_name || email;
      const picture = payload.picture || null;
      const googleId = payload.sub;

      /* Match against registered StockFlow users by email */
      const user = DB.get('users').find(u => norm(u.email) === norm(email) && u.status === 'Active');

      if (!user) {
        const errEl = $('loginError');
        if (errEl) errEl.innerHTML = `<div class="alert alert-error">
          No active StockFlow account found for <b>${esc(email)}</b>.<br>
          Ask your administrator to register this email address first.
        </div>`;
        toast(`No StockFlow account for ${email}`, 'bad', 6000);
        return;
      }

      /* Update user's Google identity metadata */
      DB.update('users', user.id, { googleId, googlePicture: picture, lastLoginAt: nowISO() });

      /* Update user pill avatar with Google photo */
      if (picture) {
        const av = $('sideAvatar');
        if (av) av.innerHTML = `<img src="${picture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="${esc(name)}">`;
      }

      /* Create session and enter the app */
      state.session = {
        user: { ...user, googlePicture: picture },
        loginAt: nowISO(),
        via: 'google'
      };
      store.set(APP.sessionKey, JSON.stringify(state.session));
      audit('LOGIN', 'Auth', user.id, `Google Sign-In: ${email}`);
      toast(`Welcome, ${user.name}! Signed in via Google.`, 'good');
      showApp();

    } catch (e) {
      console.error('Google Sign-In error:', e);
      toast('Google Sign-In failed: ' + e.message, 'bad');
    }
  },

  signOut() {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
  }
};

/* Initialize Google Auth after GIS script loads */
window.addEventListener('load', () => {
  /* Small delay to let GIS library fully initialize */
  setTimeout(() => {
    if (!state.session) GoogleAuth.init();
  }, 500);
});

/* Re-init Google button when login screen is shown */
const _origShowLogin = showLogin;
window.showLogin = function() {
  _origShowLogin();
  setTimeout(() => GoogleAuth.init(), 200);
};

/* ==========================================================================
   StockFlow ERP — Enhanced Analytics Engine
   ========================================================================== */

function renderAnalyticsEnhanced() {
  const host = $('page-analytics');
  if (!host) return;

  const inv = DB.get('inventory');
  const movements = DB.get('movements');
  const sales = DB.get('sales');
  const repairs = DB.get('repairs');
  const customers = DB.get('customers');
  const now = new Date();

  /* ---- Key metrics ---- */
  const totalInventoryValue = inv.reduce((s, l) => s + (inHand(l) * num(l.unitCost)), 0);
  const totalRetailValue = inv.reduce((s, l) => s + (inHand(l) * num(l.unitPrice)), 0);
  const potentialMargin = totalRetailValue - totalInventoryValue;

  const last30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const recentSales = sales.filter(s => (s.date || s.createdAt || '') >= last30);
  const recentRevenue = recentSales.reduce((s, sale) => s + num(sale.totalAmount || sale.netAmount), 0);

  const reorderAlerts = StockFlowAnalytics.predictiveReorder().filter(r => r.needsReorder);
  const integrityResult = LedgerIntegrity.verifyChain();

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Business Intelligence</div>
        <h2>Advanced Analytics & KPI Dashboard</h2>
        <p>Real-time performance metrics, predictive reorder intelligence, and ledger integrity status.</p>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="stat-grid mb-20">
      ${statCard({ icon: '₳', label: 'Inventory Value (Cost)', value: money(totalInventoryValue), meta: `${fmt(inv.length)} stock lines`, color: 'blue' })}
      ${statCard({ icon: '◆', label: 'Retail Value', value: money(totalRetailValue), meta: 'At selling price', color: 'teal' })}
      ${statCard({ icon: '◍', label: 'Potential Gross Margin', value: money(potentialMargin), meta: `${totalInventoryValue > 0 ? ((potentialMargin / totalInventoryValue) * 100).toFixed(1) : 0}% margin`, color: 'green' })}
      ${statCard({ icon: '◌', label: '30-Day Revenue', value: money(recentRevenue), meta: `${fmt(recentSales.length)} orders`, color: 'amber' })}
      ${statCard({ icon: '⚠', label: 'Reorder Alerts', value: fmt(reorderAlerts.length), meta: 'Items need restocking', color: reorderAlerts.length > 0 ? 'red' : 'green' })}
      ${statCard({ icon: integrityResult.valid ? '✓' : '⚠', label: 'Ledger Integrity', value: integrityResult.valid ? 'Verified' : 'CORRUPTED', meta: `${fmt(integrityResult.totalRecords)} movements`, color: integrityResult.valid ? 'green' : 'red' })}
    </div>

    <div class="grid col-2 gap-16 mb-16">
      <!-- Predictive Reorder Table -->
      <div class="card">
        <div class="card-head">
          <h3>⚠ Predictive Reorder Alerts</h3>
          <span class="badge ${reorderAlerts.length > 0 ? 'red' : 'green'}">${reorderAlerts.length} items</span>
        </div>
        <div class="card-body">
          <div class="table-scroll" style="max-height:300px">
            <table class="dt">
              <thead><tr><th>SKU</th><th>Brand</th><th>In Hand</th><th>Daily Vel.</th><th>Days Left</th><th>EOQ</th></tr></thead>
              <tbody>
                ${reorderAlerts.length ? reorderAlerts.slice(0, 20).map(r => `
                  <tr>
                    <td><b class="mono">${esc(r.line.sku)}</b></td>
                    <td>${esc(r.line.brand || '—')}</td>
                    <td><span class="${r.currentStock <= 0 ? 'c-red' : 'c-amber'}">${fmt(r.currentStock)}</span></td>
                    <td class="mono">${r.dailyVelocity}/day</td>
                    <td><span class="badge ${r.daysRemaining <= 3 ? 'red' : 'amber'}">${r.daysRemaining === 999 ? '∞' : r.daysRemaining + 'd'}</span></td>
                    <td class="c-green"><b>${fmt(r.eoq)}</b></td>
                  </tr>`).join('') : '<tr><td colspan="6"><div class="empty" style="padding:16px"><b>All stock levels healthy ✓</b></div></td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Top Selling Products -->
      <div class="card">
        <div class="card-head"><h3>🔥 Top Selling Products (30 Days)</h3></div>
        <div class="card-body">
          <div class="table-scroll" style="max-height:300px">
            <table class="dt">
              <thead><tr><th>SKU</th><th>Units Sold</th><th>Revenue</th></tr></thead>
              <tbody>
                ${(() => {
                  const skuMap = {};
                  movements.filter(m => m.type === 'SALE' && m.date >= last30).forEach(m => {
                    if (!skuMap[m.sku]) skuMap[m.sku] = { sku: m.sku, brand: m.brand, qty: 0, rev: 0 };
                    skuMap[m.sku].qty += num(m.qty);
                  });
                  sales.filter(s => (s.date || '') >= last30).forEach(s => {
                    (s.items || []).forEach(it => {
                      if (!skuMap[it.sku]) skuMap[it.sku] = { sku: it.sku, brand: '', qty: 0, rev: 0 };
                      skuMap[it.sku].rev += num(it.total || it.qty * it.price);
                    });
                  });
                  return Object.values(skuMap).sort((a, b) => b.qty - a.qty).slice(0, 15).map(p => `
                    <tr>
                      <td><b class="mono">${esc(p.sku)}</b><span class="row-sub">${esc(p.brand || '')}</span></td>
                      <td><b>${fmt(p.qty)}</b></td>
                      <td>${money(p.rev)}</td>
                    </tr>`).join('') || '<tr><td colspan="3"><div class="empty" style="padding:16px"><b>No sales in last 30 days</b></div></td></tr>';
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Repairs + Customer metrics row -->
    <div class="grid col-3 gap-16">
      <div class="card">
        <div class="card-head"><h3>🛠 Repair Pipeline</h3></div>
        <div class="card-body">
          ${['Received', 'Diagnosed', 'In Repair', 'Waiting Parts', 'Repaired', 'Returned to Customer'].map(st => {
            const c = repairs.filter(r => r.status === st).length;
            return `<div class="kv-row"><span class="k">${esc(st)}</span><span class="v"><b>${fmt(c)}</b></span></div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>👥 Customer Health</h3></div>
        <div class="card-body">
          ${statCard({ icon: '◎', label: 'Total Customers', value: fmt(customers.length), meta: 'Registered', color: 'blue' })}
          ${statCard({ icon: '₳', label: 'Outstanding Balance', value: money(customers.reduce((s, c) => s + num(c.balance), 0)), meta: 'Receivables', color: 'amber' })}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🔗 Ledger Hash Status</h3></div>
        <div class="card-body">
          <div class="kv-row"><span class="k">Status</span><span class="v"><span class="badge ${integrityResult.valid ? 'green' : 'red'}">${integrityResult.valid ? '✓ Valid' : '✗ Corrupted'}</span></span></div>
          <div class="kv-row"><span class="k">Records Verified</span><span class="v"><b>${fmt(integrityResult.totalRecords)}</b></span></div>
          ${!integrityResult.valid ? `<div class="kv-row"><span class="k c-red">Corrupted at row</span><span class="v c-red"><b>#${integrityResult.corruptedIndex + 1}</b></span></div>` : ''}
          <button class="btn sm mt-8" onclick="LedgerIntegrity.verifyChain(); renderAnalyticsEnhanced(); toast('Ledger re-verified', 'good')">Re-verify Ledger</button>
        </div>
      </div>
    </div>`;
}

/* Patch renderAnalytics to use the enhanced version */
const _origRenderAnalytics = typeof renderAnalytics === 'function' ? renderAnalytics : null;
window.renderAnalytics = function() {
  renderAnalyticsEnhanced();
};

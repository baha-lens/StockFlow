/* ==========================================================================
   AMAYA ERP — Live attendance page, bridge settings, PIN mapping
   ========================================================================== */

const liveFilter = () => state.ui.liveFilter || 'all';

function renderLive() {
  /* Date picker covers the last fortnight plus anything already recorded. */
  const dates = uniq([localDayOf(new Date()), ...DB.get('attendance').map(a => a.date).filter(Boolean)]).sort().reverse().slice(0, 30);
  const sel = $('liveDate');
  const chosen = state.ui.liveDate || localDayOf(new Date());
  if (sel) {
    sel.innerHTML = dates.map(d => `<option value="${d}" ${d === chosen ? 'selected' : ''}>${esc(fmtDate(d))}${d === localDayOf(new Date()) ? ' · today' : ''}</option>`).join('');
    sel.onchange = () => { state.ui.liveDate = sel.value; renderLive(); };
  }

  renderBridgeBanner();
  const day = DeviceHub.board(chosen);
  const t = day.totals;

  $('liveStats').innerHTML = [
    statCard({ onClick: 'att:onsite', icon: '◉', label: 'On site', value: fmt(t.present), meta: day.isWeekend ? 'Weekend' : `Shift ${day.shift.start}–${day.shift.end}`, color: 'green' }),
    statCard({ onClick: 'att:late', icon: '◴', label: 'Late', value: fmt(t.late), meta: `After ${day.shift.start} +${day.shift.graceMinutes}m`, color: t.late ? 'amber' : 'green' }),
    statCard({ onClick: 'att:half', icon: '◑', label: 'Half day / early leave', value: fmt(t.halfDay + t.earlyLeave), meta: `${t.halfDay} half · ${t.earlyLeave} early`, color: 'purple' }),
    statCard({ icon: '⚠', label: 'Unmatched PINs', value: fmt(t.unmapped), meta: t.unmapped ? 'Map them to employees' : 'All punches attributed', color: t.unmapped ? 'red' : 'green', onClick: 'live:unmapped' }),
    statCard({ onClick: 'att:punches', icon: '⇄', label: 'Punches today', value: fmt(sum(day.rows, r => r.punchCount)), meta: DeviceHub.lastSync ? `Synced ${relTime(DeviceHub.lastSync)}` : 'Not synced yet', color: 'blue' })
  ].join('');

  $('liveBoardSub').textContent = `${fmtDate(chosen)} · ${fmt(t.people)} person(s) seen`;

  let rows = day.rows;
  const mode = liveFilter();
  if (mode === 'flag') rows = rows.filter(r => ['Late', 'Half Day', 'Early Leave', 'Single Punch'].includes(r.status));
  if (mode === 'unmapped') rows = rows.filter(r => !r.matched);

  Pagers.render('liveBoard', {
    rows, mount: 'liveBoard', foot: 'liveFoot', per: 25, unit: 'people',
    emptyTitle: 'Nothing to show',
    emptyText: mode === 'all' ? 'No punches recorded for this date yet.' : 'No one matches this filter.',
    columns: [
      { key: 'name', label: 'Person', render: r => `<div class="row gap-6">${avatarNode(r.name, 26)}<span><b>${esc(r.name)}</b><span class="row-sub">${esc(r.code || '—')}${r.matched ? '' : ` · PIN ${esc(r.pin)}`}</span></span></div>` },
      { key: 'site', label: 'Terminal', render: r => `<span class="badge ${r.site ? 'teal' : 'grey'}">${esc(r.deviceId || '—')}</span><span class="row-sub">${esc(r.site || '')}</span>` },
      { key: 'firstIn', label: 'In', align: 'center', sortVal: r => r.firstIn, render: r => `<b>${esc(localClockOf(r.firstIn))}</b><span class="row-sub">${esc(r.firstVerify || '')}</span>` },
      { key: 'lastOut', label: 'Out', align: 'center', sortVal: r => r.lastOut, render: r => r.punchCount > 1 ? `<b>${esc(localClockOf(r.lastOut))}</b><span class="row-sub">${esc(r.lastVerify || '')}</span>` : '<span class="text-3">—</span>' },
      { key: 'workedMinutes', label: 'Worked', align: 'right', render: r => `<b>${esc(r.workedLabel)}</b><span class="row-sub">${r.punchCount} punch(es)</span>` },
      { key: 'lateBy', label: 'Late by', align: 'right', render: r => r.lateBy ? `<span class="badge amber">${r.lateBy} min</span>` : '—' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'actions', label: '', sortable: false, align: 'right', render: r => r.matched
        ? `<div class="actions"><button class="btn xs" data-live-emp="${r.employeeId}">Record</button></div>`
        : `<div class="actions"><button class="btn xs primary" data-live-map="${r.deviceId}|${esc(r.pin)}">Map PIN</button></div>` }
    ]
  });
  bindTableButtons('liveBoard', {
    'live-emp': id => { const e = DB.byId('employees', id); if (e) openEmployeeDrawer(id); },
    'live-map': key => { const [d, p] = key.split('|'); Modals.mapPinModal(d, p); }
  });

  renderTerminals();
  renderPunchFeed(chosen);
}

function renderTerminals() {
  const host = $('liveDevices');
  const devs = DeviceHub.devices || [];
  if (!devs.length) {
    const body = !DeviceHub.configured
      ? { b: 'Not connected', p: 'The app and the terminals are served by one program on your office machine. Start it with <span class="mono">bridge\\start-server.bat</span>, then paste the API token it prints into <b>Settings → Biometric terminals</b>.' }
      : DeviceHub.status === 'error'
        ? { b: 'Server unreachable', p: 'Last error: ' + esc(DeviceHub.lastError || 'no response') + '. Check that the program is still running on <span class="mono">' + esc(DeviceHub.base) + '</span>.' }
        : { b: 'No terminals registered yet', p: 'The server is reachable but has nothing to read. Run <span class="mono">node find-devices.js</span> on that machine, add what it finds to <span class="mono">bridge\\devices.json</span>, and restart it.' };
    host.innerHTML = `<div class="empty" style="padding:22px"><b>${body.b}</b><p>${body.p}</p></div>`;
    return;
  }
  host.innerHTML = devs.map(d => {
    const warn = d.parseWarning || (d.parseNotes && d.parseNotes.length ? d.parseNotes.join('; ') : '');
    return `<div class="list-row">
      <span class="lead" style="background:${d.online ? 'var(--green-soft)' : 'var(--red-soft)'};color:${d.online ? 'var(--green)' : 'var(--red)'}">${d.online ? '✓' : '✕'}</span>
      <span class="body">
        <b>${esc(d.id)}${d.model ? ` · ${esc(d.model)}` : ''}</b>
        <small>${esc(d.host)}${d.sn ? ' · SN ' + esc(d.sn) : ''}</small>
        ${d.lastError ? `<small class="c-red">${esc(d.lastError)}</small>` : ''}
        ${warn ? `<small class="c-amber">parser: ${esc(warn)}</small>` : ''}
      </span>
      <span class="trail">
        <b>${fmt(num(d.lastAdded))}</b><br><span class="fs-11 text-3">new punches</span>
      </span>
    </div>`;
  }).join('');
}

function renderPunchFeed(dateKey) {
  const host = $('liveFeed');
  const list = sortBy(DB.get('attendance').filter(a => a.date === dateKey), a => a.checkTime, -1).slice(0, 40);
  $('liveFeedSub').textContent = list.length ? `${list.length} most recent` : 'No punches yet';
  host.innerHTML = list.length ? list.map(a => `
    <div class="list-row">
      <span class="lead" style="background:${a.employeeId ? 'var(--green-soft)' : 'var(--red-soft)'};color:${a.employeeId ? 'var(--green)' : 'var(--red)'}">${a.employeeId ? '✓' : '?'}</span>
      <span class="body">
        <b>${esc(a.employeeName || `Unmapped · PIN ${a.pin}`)}</b>
        <small>${esc(a.deviceId || '')} · ${esc(a.verify || '')}</small>
      </span>
      <span class="trail"><b class="mono">${esc(a.clock || localClockOf(a.checkTime))}</b></span>
    </div>`).join('')
    : '<div class="empty" style="padding:24px"><b>No punches</b><p>Nothing recorded for this date.</p></div>';
}

function renderBridgeBanner() {
  const host = $('liveBridgeBanner');
  if (!host) return;
  if (!DeviceHub.configured) {
    host.innerHTML = `<div class="callout warn mb-16">
      <span class="lead">▣</span>
      <div class="body"><b>Not connected to the terminal server</b>
      The terminals are on your office LAN, so a program on your network reads them and serves
      this app too. Start it with <span class="mono">bridge\\start-server.bat</span>, then paste the
      API token it prints into <b>Settings → Biometric terminals</b>.
      Until then the register below still shows anything entered by hand or imported by CSV.</div></div>`;
    return;
  }
  if (!(DeviceHub.devices || []).length && DeviceHub.status !== 'error') {
    host.innerHTML = `<div class="callout info mb-16">
      <span class="lead">▣</span>
      <div class="body"><b>Connected — but no terminals are registered yet</b>
      Everything else in AMAYA ERP works normally; only live attendance is waiting.
      Run <span class="mono">node find-devices.js</span> on the server machine, add what it finds to
      <span class="mono">bridge\\devices.json</span>, and restart it.</div></div>`;
    return;
  }
  if (DeviceHub.status === 'error') {
    host.innerHTML = `<div class="callout danger mb-16">
      <span class="lead">✕</span>
      <div class="body"><b>Cannot reach the bridge</b>${esc(DeviceHub.lastError || 'No response.')}
      <br>Check that <span class="mono">node bridge.js</span> is still running on
      <span class="mono">${esc(DeviceHub.base)}</span>, and that this URL is reachable from your browser.</div></div>`;
  }
}

/* ------------------------------------------------------- Bridge settings */
function renderBridgePanel() {
  const host = $('bridgePanel');
  if (!host) return;
  const s = state.db.settings;
  const devs = DeviceHub.devices || [];
  const unmapped = DeviceHub.unmappedPins();

  const badge = $('bridgeBadge');
  if (badge) {
    const online = devs.filter(d => d.online).length;
    const unreachable = DeviceHub.status === 'error' && devs.length > 0;
    badge.textContent = !DeviceHub.configured ? 'Not connected'
      : unreachable ? 'Unreachable'
      : !devs.length ? 'No terminals yet'
      : `${online}/${devs.length} online`;
    badge.className = 'badge ' + (!DeviceHub.configured ? 'grey' : unreachable ? 'red' : !devs.length ? 'grey' : online ? 'green' : 'amber');
  }

  host.innerHTML = `
    <div class="callout ${DeviceHub.configured ? (DeviceHub.status === 'error' && devs.length ? 'danger' : 'ok') : 'info'} mb-16">
      <span class="lead">▣</span>
      <div class="body">
        <b>${DeviceHub.configured ? (DeviceHub.status === 'error' && devs.length ? 'Bridge unreachable' : 'Bridge connected') : 'Bridge not configured'}</b>
        ${DeviceHub.configured
          ? `Pulling from <span class="mono">${esc(DeviceHub.base)}</span> · ${devs.length
              ? `${devs.filter(d => d.online).length}/${devs.length} terminal(s) online`
              : 'no terminals added yet'} · last sync ${DeviceHub.lastSync ? esc(relTime(DeviceHub.lastSync)) : 'never'}`
          : 'The ERP app and the terminals are served by one program. Start it with <span class="mono">bridge\\start-server.bat</span>, then paste the API token it prints here.'}
      </div>
    </div>

    ${DeviceHub.configured && !devs.length ? `<div class="callout info mb-16"><span class="lead">i</span><div class="body">
      <b>No terminals are registered yet</b>
      Everything else in AMAYA ERP works as normal — this only affects live attendance.
      On the machine running the server: run <span class="mono">node find-devices.js</span> to scan the
      network, put what it finds in <span class="mono">bridge\\devices.json</span>, then restart the server.
    </div></div>` : ''}

    <div class="form-grid">
      ${field('Bridge URL', `<input class="input mono" id="brUrl" value="${esc(s.bridgeUrl || '')}" placeholder="http://192.168.1.50:8787">`, { span: 2, hint: 'The address the bridge printed on startup, reachable from this browser.' })}
      ${field('API token', `<input class="input mono" id="brToken" value="${esc(s.bridgeToken || '')}" placeholder="printed by the bridge on startup">`)}
      ${field('Live-view token', `<input class="input mono" id="brLiveToken" value="${esc(s.bridgeLiveToken || '')}" placeholder="optional, for the shareable link">`)}
      ${field('Sync every (seconds)', `<input class="input" id="brPoll" type="number" min="20" value="${Math.round(num(s.bridgePollMs) / 1000) || 60}">`)}
      ${field('Shift end', `<input class="input" id="brShiftEnd" value="${esc(s.shiftEnd || '18:00')}" placeholder="18:00">`)}
    </div>

    <div class="row-wrap mt-12">
      <label class="check"><input type="checkbox" id="brAuto" ${s.bridgeAutoSync !== false ? 'checked' : ''}> Sync automatically while this app is open</label>
    </div>

    <div class="row-wrap mt-12">
      <button class="btn primary" id="brSave">Save &amp; connect</button>
      <button class="btn" id="brTest">Test connection</button>
      <button class="btn" id="brRefreshUsers">⇄ Read terminal users</button>
      <button class="btn" id="brSync">⟳ Sync punches</button>
      ${s.bridgeUrl ? `<button class="btn ghost" id="brOpen">Open live view ↗</button>` : ''}
    </div>

    ${s.bridgeUrl ? `<div class="form-hint mt-8">Shareable read-only link:
      <span class="mono" id="brLiveUrl" style="word-break:break-all;color:var(--amber)">${esc(DeviceHub.liveUrl)}</span>
      <button class="btn xs" id="brCopyLive" style="margin-left:6px">Copy</button></div>` : ''}

    ${devs.length ? `<div class="section-title mt-16">Registered terminals</div>
      <div class="table-scroll"><table class="dt sm">
        <thead><tr><th>Terminal</th><th>Model</th><th>Address</th><th>Serial</th><th>Site</th><th>Status</th><th class="right">New</th></tr></thead>
        <tbody>${devs.map(d => `<tr>
          <td><b>${esc(d.id)}</b></td>
          <td>${esc(d.model || '—')}</td>
          <td class="mono">${esc(d.host)}:${esc(d.port || 80)}</td>
          <td class="mono fs-11">${esc(d.sn || '—')}</td>
          <td>${esc(d.site || '—')}</td>
          <td>${d.online ? '<span class="badge green">Online</span>' : `<span class="badge red">${esc(d.lastError || 'Offline')}</span>`}</td>
          <td class="right num">${fmt(num(d.lastAdded))}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}

    ${unmapped.length ? `<div class="section-title mt-16">Unmatched terminal PINs</div>
      <div class="callout warn mb-8"><span class="lead">⚠</span><div class="body">
        <b>${unmapped.length} PIN(s) have punches but no employee</b>
        These punches are stored but not attributed, so they will not reach payroll.
        Assign each PIN to an employee.</div></div>
      <div class="table-scroll"><table class="dt sm">
        <thead><tr><th>Terminal</th><th>PIN</th><th>Name on terminal</th><th>Facility</th><th class="right">Punches</th><th class="right">Last seen</th><th></th></tr></thead>
        <tbody>${unmapped.map(u => {
          const linked = DeviceHub.linkFor(u.deviceId, u.pin);
          const who = linked ? (DB.byId('employees', linked.employeeId) || {}).name : null;
          return `<tr>
            <td><span class="badge teal">${esc(u.deviceId)}</span></td>
            <td class="mono"><b>${esc(u.pin)}</b></td>
            <td>${esc(u.deviceName || '<span class="text-3">not on terminal</span>')}</td>
            <td>${esc(u.lastSite || '—')}</td>
            <td class="right num">${fmt(u.count)}</td>
            <td class="right fs-11 text-3">${esc(fmtDate(u.last))}</td>
            <td class="right"><div class="actions">
              <button class="btn xs primary" data-map-pin="${u.deviceId}|${esc(u.pin)}">${who ? 'Change' : 'Assign'}</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : ''}`;

  $('brSave').onclick = async () => {
    s.bridgeUrl = $('brUrl').value.trim().replace(/\/+$/, '');
    s.bridgeToken = $('brToken').value.trim();
    s.bridgeLiveToken = $('brLiveToken').value.trim();
    s.bridgePollMs = Math.max(20000, num($('brPoll').value) * 1000);
    s.bridgeAutoSync = $('brAuto').checked;
    s.shiftEnd = $('brShiftEnd').value.trim() || '18:00';
    DB.save(true);
    audit('UPDATE', 'System', 'bridge', s.bridgeUrl ? `Bridge set to ${s.bridgeUrl}` : 'Bridge cleared');
    if (!s.bridgeUrl) { DeviceHub.setStatus('idle', 'No bridge configured'); renderBridgePanel(); return; }
    toast('Connecting to the bridge…', 'good');
    const ok = await DeviceHub.ping();
    renderBridgePanel();
    if (ok) { toast('Bridge connected', 'good'); DeviceHub.start(); await DeviceHub.sync(); }
    else toast('Could not reach the bridge — check the URL and that it is running', 'bad', 6000);
  };
  $('brTest').onclick = async () => {
    const ok = await DeviceHub.ping();
    renderBridgePanel();
    toast(ok ? 'Bridge reachable' : 'Bridge unreachable', ok ? 'good' : 'bad');
  };
  $('brRefreshUsers').onclick = async () => {
    try {
      const u = await DeviceHub.loadUsers(true);
      toast(`${u.length} terminal user(s) read`, 'good');
      renderBridgePanel(); renderLive();
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('brSync').onclick = async () => { await DeviceHub.sync(); renderBridgePanel(); renderLive(); };
  const open = $('brOpen'); if (open) open.onclick = () => window.open(DeviceHub.liveUrl, '_blank', 'noopener');
  const copy = $('brCopyLive');
  if (copy) copy.onclick = () => copyText(DeviceHub.liveUrl, 'Live view link copied');
  $$('[data-map-pin]').forEach(b => b.onclick = () => {
    const [d, p] = b.dataset.mapPin.split('|');
    Modals.mapPinModal(d, p);
  });
}

function copyText(text, message) {
  if (!text) return toast('Nothing to copy', 'warn');
  const done = () => toast(message || 'Copied', 'good');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-2000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { toast('Could not copy automatically — select the text and copy manually', 'warn'); }
  ta.remove();
}

/* --------------------------------------------------------- PIN mapping */
Modals.mapPinModal = function (deviceId, pin) {
  const link = DeviceHub.linkFor(deviceId, pin);
  const deviceUser = (state.db.deviceUsers || []).find(u => u.deviceId === deviceId && String(u.pin) === String(pin));
  const punches = DB.get('attendance').filter(a => a.deviceId === deviceId && String(a.pin) === String(pin));
  const currentEmp = link && link.employeeId ? DB.byId('employees', link.employeeId) : null;
  const today = DeviceHub.board(localDayOf(new Date()));
  const todayRow = today.rows.find(r => !r.matched && r.deviceId === deviceId && String(r.pin) === String(pin));

  /* Offer the likeliest candidates first, so the common case is one click. */
  const suggestions = [];
  const push = (e) => { if (e) suggestions.push(e); };
  push(currentEmp);
  DB.get('employees').forEach(e => { if (norm(e.code) === norm(pin) || norm(e.id) === norm(pin)) push(e); });
  const pinDigits = String(pin).replace(/\D/g, '');
  if (pinDigits) DB.get('employees').forEach(e => { if (String(e.code || '').replace(/\D/g, '') === pinDigits) push(e); });
  if (deviceUser && deviceUser.name) {
    DB.get('employees').forEach(e => { if (norm(e.name) === norm(deviceUser.name)) push(e); });
  }
  DB.get('employees').forEach(e => {
    const n = norm(e.name);
    if (n && deviceUser && (n.includes(norm(deviceUser.name)) || norm(deviceUser.name).includes(n)) && Math.abs(n.length - norm(deviceUser.name).length) <= 4) push(e);
  });
  DB.get('employees').forEach(push);

  const options = [];
  const seenIds = new Set();
  suggestions.forEach(e => { if (e && !seenIds.has(e.id)) { seenIds.add(e.id); options.push(e); } });

  /* Only preselect a person when the PIN genuinely resolved. Silently
     preselecting the first employee would make a mis-click attribute punches
     to whoever happens to be top of the list. */
  const autoPicked = currentEmp
    || DB.get('employees').find(e => norm(e.code) === norm(pin) || norm(e.id) === norm(pin))
    || (pinDigits ? DB.get('employees').find(e => String(e.code || '').replace(/\D/g, '') === pinDigits) : null)
    || (deviceUser && deviceUser.name ? DB.get('employees').find(e => norm(e.name) === norm(deviceUser.name)) : null);
  const defaultValue = autoPicked ? autoPicked.id : '';

  openModal({
    width: 'md',
    title: 'Assign terminal PIN',
    sub: `${deviceId} · PIN ${pin}${deviceUser && deviceUser.name ? ' · ' + deviceUser.name : ''}`,
    body: `
      <div class="callout ${punches.length ? 'warn' : 'info'} mb-16">
        <span class="lead">${punches.length ? '⚠' : 'i'}</span>
        <div class="body">
          <b>${fmt(punches.length)} punch(es) carry this PIN</b>
          ${todayRow ? `Today: ${todayRow.punchCount} punch(es), status ${esc(todayRow.status)}.` : 'No punches today.'}
          ${punches.length ? 'Assigning the PIN re-attributes every past punch for this terminal to the chosen employee.' : ''}
        </div>
      </div>
      <div class="form-grid">
        ${field('Employee', selectControl('mpEmp', [['', '— choose an employee —']].concat(options.map(e => [e.id, `${e.name} — ${e.role} (${e.code})`])), defaultValue), { required: true, span: 2 })}
      </div>
      ${autoPicked
        ? `<div class="callout ok mt-12"><span class="lead">✓</span><div class="body"><b>Matched automatically</b>${esc(deviceUser && deviceUser.name ? 'The terminal name matches this employee.' : 'The PIN matches this employee’s staff number.')}</div></div>`
        : (deviceUser && deviceUser.name
            ? `<div class="callout warn mt-12"><span class="lead">⚠</span><div class="body"><b>No automatic match</b>The terminal calls this person “${esc(deviceUser.name)}”, which does not match any employee record. Pick who it is.</div></div>`
            : '<div class="form-hint mt-8">This PIN does not match any employee code, so you must choose who it belongs to.</div>')}
      ${deviceUser && deviceUser.name ? `<div class="form-hint mt-8">The terminal calls this person “${esc(deviceUser.name)}”.</div>` : ''}
      ${punches.length ? `<div class="section-title mt-16">Recent punches for this PIN</div>
      <div class="table-scroll" style="max-height:180px"><table class="dt sm">
        <thead><tr><th>Date</th><th>Time</th><th>Method</th><th>Facility</th></tr></thead>
        <tbody>${sortBy(punches, p => p.checkTime, -1).slice(0, 12).map(p => `<tr>
          <td>${esc(fmtDate(p.date))}</td><td class="mono">${esc(p.clock || localClockOf(p.checkTime))}</td>
          <td>${esc(p.verify || '—')}</td><td>${esc(p.site || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}`,
    foot: `${link ? '<button class="btn left danger" data-unlink>Unassign</button>' : ''}
           <button class="btn" data-cancel>Cancel</button>
           <button class="btn primary" data-save>Assign PIN</button>`,
    onMount(el) {
      qs('[data-save]', el).onclick = async () => {
        const employeeId = $('mpEmp', el).value;
        if (!employeeId) { $('mpEmp', el).classList.add('err'); return toast('Choose an employee', 'bad'); }
        const emp = DB.byId('employees', employeeId);
        if (!emp) return toast('Choose an employee', 'bad');
        try {
          await DeviceHub.linkPin(deviceId, pin, emp.id, emp.name);
          /* Re-attribute the punches already in the register. */
          const affected = DB.get('attendance').filter(a => a.deviceId === deviceId && String(a.pin) === String(pin) && !a.employeeId);
          affected.forEach(a => {
            a.employeeId = emp.id; a.employeeName = emp.name;
            a.code = emp.code; a.department = emp.department; a.matchVia = 'link';
          });
          if (affected.length) { applyShiftRules(affected); DB.save(true); }
          audit('MAPPING', 'Attendance', `${deviceId}:${pin}`, `PIN assigned to ${emp.name} · ${affected.length} punch(es) re-attributed`);
          toast(`PIN ${pin} assigned to ${emp.name}${affected.length ? ` · ${affected.length} punch(es) re-attributed` : ''}`, 'good');
          closeModal(el);
          renderLive(); renderBridgePanel();
          if (state.route === 'attendance') renderAttendance();
        } catch (e) { toast(e.message, 'bad'); }
      };
      const un = qs('[data-unlink]', el);
      if (un) un.onclick = async () => {
        try {
          await DeviceHub.unlinkPin(deviceId, pin);
          DB.get('attendance').filter(a => a.deviceId === deviceId && String(a.pin) === String(pin))
            .forEach(a => { a.employeeId = ''; a.employeeName = ''; a.code = ''; });
          DB.save(true);
          audit('MAPPING', 'Attendance', `${deviceId}:${pin}`, 'PIN unassigned');
          toast('PIN unassigned', 'warn');
          closeModal(el); renderLive(); renderBridgePanel();
        } catch (e) { toast(e.message, 'bad'); }
      };
    }
  });
};

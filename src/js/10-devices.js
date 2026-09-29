/* ==========================================================================
   AMAYA ERP — ZKTeco device layer
   --------------------------------------------------------------------------
   Talks to the local Attendance Bridge (bridge/bridge.js), never to the
   terminals directly: the terminals are on the LAN, send no CORS headers, and
   are plain HTTP, so a browser page cannot read them.

   Responsibilities:
     • hold the bridge connection (URL + token) and device health
     • pull punches and turn them into attendance records
     • map a terminal PIN to an employee (explicit link, then code, then name)
     • surface anything that could not be matched, so nobody's punch is lost
   ========================================================================== */

/** Minutes-since-midnight for a "HH:MM" string, or null. */
function clockMinutes(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** "09:07" from a Date, in the reader's own timezone. */
function localClockOf(d) {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}
/** Local calendar day, so a 01:00 punch is not filed under the previous day. */
function localDayOf(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const DeviceHub = {
  status: 'idle',        // idle | connecting | online | offline | error
  message: 'Not connected',
  lastSync: null,
  lastError: null,
  devices: [],
  punching: false,
  _timer: null,
  _inflight: false,

  get configured() { return !!String(state.db.settings.bridgeUrl || '').trim(); },
  get base() { return String(state.db.settings.bridgeUrl || '').trim().replace(/\/+$/, ''); },
  get token() { return String(state.db.settings.bridgeToken || '').trim(); },
  get autoSync() { return state.db.settings.bridgeAutoSync !== false; },
  get pollMs() { return Math.max(20000, num(state.db.settings.bridgePollMs) || 60000); },
  /** Base for the shareable live view, which is served by the bridge itself. */
  get liveUrl() {
    const t = String(state.db.settings.bridgeLiveToken || '').trim();
    return this.base ? `${this.base}/live${t ? `?token=${encodeURIComponent(t)}` : ''}` : '';
  },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['X-Bridge-Token'] = this.token;
    return h;
  },

  async call(path, opts = {}) {
    if (!this.configured) throw new Error('No bridge URL configured — set it in Settings → Devices.');
    const res = await fetch(this.base + path, Object.assign({
      method: 'GET', headers: this.headers(), cache: 'no-store'
    }, opts));
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
    if (!res.ok) throw new Error(data.error || data.hint || `Bridge returned HTTP ${res.status}`);
    return data;
  },

  setStatus(status, message) {
    this.status = status;
    this.message = message || '';
    if (status === 'error') this.lastError = message || 'error';
    const chip = $('bridgeChip'), txt = $('bridgeText');
    if (chip) {
      chip.classList.toggle('hidden', !this.configured);
      chip.className = 'sync-chip' + (this.configured ? ' ' + (status === 'online' ? '' : status === 'idle' ? 'offline' : status) : ' hidden');
    }
    if (txt) txt.textContent = this.configured ? (message || status) : 'No bridge';
  },

  /** Cheap reachability probe. Safe to call on a schedule. */
  async ping() {
    if (!this.configured) { this.setStatus('idle', 'No bridge configured'); return false; }
    try {
      const h = await this.call('/health');
      this.devices = h.devices || [];
      const online = this.devices.filter(d => d.online).length;
      /* Three distinct situations, so the badge never alarms unnecessarily. */
      if (!this.devices.length) this.setStatus('online', 'Bridge up — no terminals added yet');
      else if (online === this.devices.length) this.setStatus('online', `${online}/${this.devices.length} terminal(s) online`);
      else if (online) this.setStatus('connecting', `${online}/${this.devices.length} terminal(s) online`);
      else this.setStatus('error', 'Bridge up, no terminal responding');
      return true;
    } catch (e) {
      this.devices = [];
      this.lastError = e.message === 'Failed to fetch' ? 'Bridge unreachable' : e.message;
      this.setStatus('error', this.lastError);
      return false;
    }
  },

  /** Force the bridge to poll the terminals now, then re-read status. */
  async forcePoll() {
    if (!this.configured) throw new Error('No bridge URL configured');
    this.setStatus('connecting', 'Polling terminals…');
    const r = await this.call('/api/devices/refresh', { method: 'POST' });
    this.devices = r.devices || [];
    const added = this.devices.reduce((s, d) => s + num(d.lastAdded), 0);
    toast(added ? `${added} new punch(es) read from the terminals` : 'Terminals polled — no new punches', added ? 'good' : 'warn');
    await this.sync();
    return r;
  },

  /** Terminal user lists, so PINs can be shown with names while mapping. */
  async loadUsers(force) {
    const r = await this.call('/api/users' + (force ? '?refresh=1' : ''));
    const users = (r.users || []).map(u => ({
      deviceId: u.deviceId,
      pin: String(u.pin),
      name: u.name || '',
      group: u.group || ''
    }));
    state.db.deviceUsers = users;
    DB.save(true);
    return users;
  },

  /** Tell the bridge which employee a terminal PIN belongs to. */
  async linkPin(deviceId, pin, employeeId, name) {
    const r = await this.call('/api/links', {
      method: 'POST',
      body: JSON.stringify({ deviceId, pin, employeeId, name })
    });
    state.db.deviceLinks = r.links || {};
    DB.save(true);
    return r;
  },
  async unlinkPin(deviceId, pin) {
    const r = await this.call('/api/links', {
      method: 'POST',
      body: JSON.stringify({ deviceId, pin, clear: true })
    });
    state.db.deviceLinks = r.links || {};
    DB.save(true);
    return r;
  },

  /* ------------------------------------------------------------ matching */
  linkFor(deviceId, pin) {
    return (state.db.deviceLinks || {})[`${deviceId}:${pin}`] || null;
  },

  /**
   * Resolve a terminal PIN to an employee, in order of confidence:
   *   1. an explicit link set in the mapping screen
   *   2. the employee code equals the PIN (what most sites enrol)
   *   3. the name the terminal holds matches an employee name
   * Returns the employee record, or null when nothing matches.
   */
  resolve(deviceId, pin) {
    const p = String(pin);

    const link = this.linkFor(deviceId, p);
    if (link && link.employeeId) {
      const emp = DB.byId('employees', link.employeeId) || DB.get('employees').find(e => e.id === link.employeeId);
      if (emp) return { employee: emp, via: 'link' };
    }

    const byCode = DB.get('employees').find(e => norm(e.code) === norm(p) || norm(e.id) === norm(p));
    if (byCode) return { employee: byCode, via: 'code' };

    /* Most sites enrol the staff number as the terminal PIN, so someone coded
       "E-101" is badged in as "101". Comparing digits covers that without
       needing a mapping row for every person. */
    const pinDigits = p.replace(/\D/g, '');
    if (pinDigits) {
      const byDigits = DB.get('employees').find(e => String(e.code || '').replace(/\D/g, '') === pinDigits);
      if (byDigits) return { employee: byDigits, via: 'staff no.' };
    }

    const deviceName = norm(((state.db.deviceUsers || []).find(u => u.deviceId === deviceId && String(u.pin) === p) || {}).name);
    if (deviceName) {
      const byName = DB.get('employees').find(e => norm(e.name) === deviceName);
      if (byName) return { employee: byName, via: 'name' };
      const loose = DB.get('employees').find(e => {
        const n = norm(e.name);
        return n && (n.includes(deviceName) || deviceName.includes(n)) && Math.abs(n.length - deviceName.length) <= 4;
      });
      if (loose) return { employee: loose, via: 'name~' };
    }

    return { employee: null, via: 'none' };
  },

  /* --------------------------------------------------------------- sync */
  /**
   * Pull punches from the bridge and fold them into the attendance register.
   * Idempotent: a punch already present (same device, PIN and instant) is
   * skipped, so re-syncing never inflates the register.
   */
  async sync(sinceOverride) {
    if (!this.configured || this.punching) return { added: 0, skipped: 0, unmapped: 0 };
    this.punching = true;
    this.setStatus('connecting', 'Syncing punches…');
    try {
      /* Resume from the last cursor. Note the deliberate name: `state` is the
         app's central store and must not be shadowed in this scope. */
      const cursorRaw = store.get('sf_erp_bridge_cursor');
      let cursorSince = sinceOverride || null;
      if (!cursorSince && cursorRaw) {
        try { cursorSince = (JSON.parse(cursorRaw) || {}).since || null; } catch (_) { cursorSince = null; }
      }
      const query = cursorSince ? `?since=${encodeURIComponent(cursorSince)}&limit=5000` : '?limit=5000';
      const r = await this.call('/api/attendance' + query);
      const punches = r.punches || [];

      const existing = new Set(DB.get('attendance').map(a => `${a.deviceId || ''}|${a.pin || ''}|${a.checkTime}`));
      let added = 0, skipped = 0, unmapped = 0;
      const pending = [];
      let maxSeen = cursorSince;

      for (const p of punches) {
        if (p.receivedAt && (!maxSeen || p.receivedAt > maxSeen)) maxSeen = p.receivedAt;
        const key = `${p.deviceId}|${p.pin}|${p.at}`;
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);

        const { employee, via } = this.resolve(p.deviceId, p.pin);
        const when = new Date(p.at);
        if (Number.isNaN(when.getTime())) { skipped++; continue; }

        pending.push({
          employeeId: employee ? employee.id : '',
          employeeName: employee ? employee.name : '',
          code: employee ? employee.code : '',
          department: employee ? employee.department : '',
          deviceId: p.deviceId || '',
          deviceModel: p.deviceModel || '',
          site: p.site || '',
          pin: String(p.pin || ''),
          checkTime: p.at,
          date: p.localDate || localDayOf(when),
          clock: p.localTime || localClockOf(when),
          status: 'Pending',
          source: 'device',
          matchVia: via,
          verify: p.verifyName || ''
        });
        added++;
        if (!employee) unmapped++;
      }

      if (pending.length) {
        /* Insert oldest first so the register reads chronologically. */
        pending.sort((a, b) => a.checkTime.localeCompare(b.checkTime));
        state.db.attendance = pending.concat(DB.get('attendance'));
        applyShiftRules(pending);
        audit('SYNC', 'Attendance', 'bridge',
          `${added} punch(es) from ${uniq(pending.map(p => p.deviceId)).join(', ')}${unmapped ? ` · ${unmapped} unmapped` : ''}`);
        if (unmapped) {
          toast(`${added} punches synced · ${unmapped} could not be matched to an employee`, 'warn', 7000);
        } else {
          toast(`${added} punch(es) synced from the terminals`, 'good');
        }
      } else {
        if (punches.length) toast('Attendance already up to date', 'warn');
      }

      store.set('sf_erp_bridge_cursor', JSON.stringify({ since: maxSeen || cursorSince, at: nowISO() }));
      DB.save(true);

      this.lastSync = nowISO();
      const health = await this.ping().catch(() => false);
      if (!pending.length && !unmapped) this.setStatus(health ? 'online' : 'error', this.message);
      renderAll();
      return { added, skipped, unmapped };
    } catch (e) {
      this.setStatus('error', e.message === 'Failed to fetch'
        ? 'Bridge unreachable — is it running on the local machine?'
        : e.message);
      toast('Attendance sync failed: ' + e.message, 'bad');
      return { added: 0, skipped: 0, unmapped: 0, error: e.message };
    } finally {
      this.punching = false;
    }
  },

  /** Day-by-day rollup from the raw register, for the live board. */
  board(dateKey) {
    const key = dateKey || localDayOf(new Date());
    const shift = this.shift();
    const startMin = clockMinutes(shift.start) ?? 540;
    const endMin = clockMinutes(shift.end) ?? 1080;
    const rows = new Map();

    DB.get('attendance').filter(a => a.date === key).forEach(a => {
      const id = a.employeeId || `unmapped:${a.deviceId}:${a.pin}`;
      if (!rows.has(id)) {
        rows.set(id, {
          employeeId: a.employeeId || '',
          name: a.employeeName || `Unmapped · PIN ${a.pin}`,
          code: a.code || '',
          department: a.department || '',
          deviceId: a.deviceId || '',
          site: a.site || '',
          pin: a.pin || '',
          matched: !!a.employeeId,
          punches: []
        });
      }
      rows.get(id).punches.push(a);
    });

    const weekday = new Date(key + 'T12:00:00').getDay();
    const isWeekend = (shift.weekendDays || []).includes(weekday);

    const out = [...rows.values()].map(rec => {
      rec.punches.sort((a, b) => a.checkTime.localeCompare(b.checkTime));
      const first = rec.punches[0], last = rec.punches[rec.punches.length - 1];
      const inMin = clockMinutes(first.clock || localClockOf(first.checkTime));
      const outMin = clockMinutes(last.clock || localClockOf(last.checkTime));
      const worked = (inMin != null && outMin != null && outMin > inMin) ? outMin - inMin : 0;

      let status = 'Present';
      if (isWeekend) status = 'Weekend';
      else if (rec.punches.length === 1) status = 'Single Punch';
      else {
        if (inMin != null && inMin > startMin + num(shift.graceMinutes)) status = 'Late';
        if (worked < num(shift.halfDayHours) * 60) status = 'Half Day';
        else if (outMin != null && outMin < endMin - num(shift.earlyLeaveGraceMinutes)) status = 'Early Leave';
      }

      return Object.assign(rec, {
        status,
        firstIn: first.checkTime,
        lastOut: last.checkTime,
        punchCount: rec.punches.length,
        workedMinutes: worked,
        workedLabel: `${Math.floor(worked / 60)}h ${String(worked % 60).padStart(2, '0')}m`,
        lateBy: inMin != null ? Math.max(0, inMin - startMin - num(shift.graceMinutes)) : 0,
        firstVerify: first.verify, lastVerify: last.verify
      });
    });

    out.sort((a, b) => (a.matched !== b.matched ? (a.matched ? -1 : 1) : a.name.localeCompare(b.name)));
    const count = (s) => out.filter(r => r.status === s).length;
    return {
      date: key, isWeekend, shift,
      totals: {
        people: out.length,
        matched: out.filter(r => r.matched).length,
        unmapped: out.filter(r => !r.matched).length,
        present: count('Present') + count('Weekend'),
        late: count('Late'),
        halfDay: count('Half Day'),
        earlyLeave: count('Early Leave')
      },
      rows: out
    };
  },

  shift() {
    return Object.assign({
      start: state.db.settings.shiftStart || '09:00',
      end: state.db.settings.shiftEnd || '18:00',
      graceMinutes: 10, earlyLeaveGraceMinutes: 15, halfDayHours: 4, weekendDays: [5, 6]
    }, state.db.settings.bridgeShift || {});
  },

  /** Terminal PINs seen in the register that no employee owns. */
  unmappedPins() {
    const seen = new Map();
    DB.get('attendance').forEach(a => {
      if (a.employeeId) return;
      const key = `${a.deviceId}:${a.pin}`;
      if (!seen.has(key)) {
        const u = (state.db.deviceUsers || []).find(x => x.deviceId === a.deviceId && String(x.pin) === String(a.pin));
        seen.set(key, {
          deviceId: a.deviceId, pin: a.pin, deviceName: u ? u.name : '',
          count: 0, last: '', lastSite: a.site || ''
        });
      }
      const rec = seen.get(key);
      rec.count++;
      if (a.checkTime > rec.last) { rec.last = a.checkTime; rec.lastSite = a.site || rec.lastSite; }
    });
    return [...seen.values()].sort((a, b) => b.count - a.count);
  },

  start() {
    clearInterval(DeviceHub._timer);
    if (!DeviceHub.configured) { DeviceHub.setStatus('idle', 'No bridge configured'); return; }
    DeviceHub.setStatus('connecting', 'Connecting to bridge…');
    DeviceHub.ping().then(() => DeviceHub.sync()).catch(() => {});
    DeviceHub._timer = setInterval(() => {
      if (document.hidden || !state.session) return;
      if (DeviceHub.punching || !navigator.onLine) return;
      DeviceHub.sync().catch(() => {});
    }, DeviceHub.pollMs);
  }
};

/**
 * Fill in Present / Late / Half Day on freshly imported punches.
 * Runs on the import only — anything a human edited by hand is left alone.
 */
function applyShiftRules(records) {
  const shift = DeviceHub.shift();
  const startMin = clockMinutes(shift.start) ?? 540;
  const endMin = clockMinutes(shift.end) ?? 1080;
  const byDay = groupBy(records, r => r.date);

  Object.entries(byDay).forEach(([day, list]) => {
    const weekday = new Date(day + 'T12:00:00').getDay();
    const isWeekend = (shift.weekendDays || []).includes(weekday);
    const byPerson = groupBy(list, r => r.employeeId || `${r.deviceId}:${r.pin}`);

    Object.values(byPerson).forEach(person => {
      person.sort((a, b) => a.checkTime.localeCompare(b.checkTime));
      person.forEach((r, i) => {
        if (isWeekend) r.status = 'Weekend';
        else if (i > 0) r.status = 'Present';
        else {
          const m = clockMinutes(r.clock || localClockOf(r.checkTime));
          r.status = (m != null && m > startMin + num(shift.graceMinutes)) ? 'Late' : 'Present';
        }
        r.shiftRef = person[0].checkTime;
        r.workedLabel = null;
      });
      /* A lone punch does not prove a half day; only mark it when there are
         at least two and the span is genuinely short. */
      if (person.length > 1 && !isWeekend) {
        const inM = clockMinutes(person[0].clock || localClockOf(person[0].checkTime));
        const outM = clockMinutes(person[person.length - 1].clock || localClockOf(person[person.length - 1].checkTime));
        if (inM != null && outM != null && outM > inM && (outM - inM) < num(shift.halfDayHours) * 60) {
          person.forEach(r => { r.status = 'Half Day'; });
        } else if (inM != null && outM != null && outM < endMin - num(shift.earlyLeaveGraceMinutes)) {
          person[person.length - 1].status = 'Early Leave';
        }
      }
    });
  });
}

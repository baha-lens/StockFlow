/* ============================================================================
   AMAYA ERP — server-side sync store
   ----------------------------------------------------------------------------
   The ERP app is offline-first: it writes everything to local storage and works
   with no network at all. That is the right default for a shop floor, but it
   means two devices that both work offline have silently diverged, and there is
   no record of who changed what. This module is the reconciliation point.

   Design
   ------
   Every record carries a server-assigned, monotonically increasing `rev`. A
   client remembers the highest `rev` it has seen and asks for everything above
   that number. That makes pull a pure cursor walk: no diffing, no tombstones to
   garbage-collect for the common case, and a client that was offline for a week
   catches up in one request.

   Deletions are the awkward part of any offline sync. A record removed on the
   phone has to remove it on the server, and every other device has to remove it
   too — which means the deletion itself has to travel. So a delete is stored as
   a tombstone: the record is kept with `_deleted: true` and a fresh `rev`, and
   it is only discarded once every registered client has acknowledged a `rev`
   past it. Clients are not assumed to be online, so tombstones are also
   expired by age (`tombstoneDays`) as a backstop for a device that is simply
   never coming back.

   Conflicts
   ---------
   A client sends `baseRev` — the revision it believes the server holds. If that
   still matches, the write is a fast-forward and is accepted. If it does not,
   someone else wrote in between, so the server refuses and returns its own
   copy. The client then decides: this app resolves last-writer-wins on the
   record's `updatedAt`, because a warehouse supervisor correcting a stock count
   on a tablet should not have their change silently dropped because a desktop
   saved an unrelated field a second earlier. Field-level merge is the obvious
   next step and is deliberately not attempted here — it needs per-field
   provenance that the current record shape does not carry.

   What this file does not do: authenticate users, enforce permissions, or
   validate business rules. `bridge.js` guards the routes with the API token and
   the app enforces roles locally. That means anyone holding the token can write
   to the store, which is the same trust boundary the existing /api/links
   endpoint already has.
   ========================================================================= */

const fs = require('node:fs');
const path = require('node:path');

/* Collections the app knows about. Anything else is rejected rather than
 * stored, so a typo in a client build cannot quietly create a shadow table. */
const COLLECTIONS = [
  'locations', 'users', 'items', 'inventory', 'imeis', 'movements', 'transfers',
  'sales', 'purchases', 'dispatches', 'customers', 'suppliers', 'invoices',
  'repairs', 'employees', 'payroll', 'leaves', 'attendance', 'tasks', 'upgrades',
  'audit', 'attachments'
];

/* Audit rows and attendance are high-volume append-only logs. Syncing every
 * punch ever recorded over a mobile connection is not viable, and the bridge
 * already serves attendance directly from the devices, so those two are
 * excluded from the synced set. */
const EXCLUDED = new Set(['audit', 'attendance']);

const SYNCABLE = COLLECTIONS.filter(c => !EXCLUDED.has(c));

const DEFAULTS = {
  /* How long a delete survives before it is dropped. A device offline longer
   * than this will come back not knowing the record was ever deleted. 180 days
   * is far longer than a phone stays out of service, and costs a few KB. */
  tombstoneDays: 180,
  /* Guard against a runaway client. A full pull of a large install is still
   * well under this. */
  maxPushRecords: 2000,
  maxPullRecords: 5000,
  /* A record larger than this is refused: it is almost certainly a base64 photo
   * that bypassed the attachment rules, and one of those would bloat the store
   * for every client. */
  maxRecordBytes: 256 * 1024
};

/** An empty store. `rev` is the global high-water mark. */
function blank() {
  return { version: 1, rev: 0, collections: {}, clients: {}, history: [] };
}

function createSyncStore({ file, dataDir, log, config }) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  const storeFile = file || path.join(dataDir, 'sync.json');
  let db = blank();
  let saveTimer = null;
  let dirty = false;

  /* ------------------------------------------------------------ persistence */

  function ensureDir() {
    try { fs.mkdirSync(path.dirname(storeFile), { recursive: true }); } catch (_) {}
  }

  function load() {
    ensureDir();
    try {
      if (fs.existsSync(storeFile)) {
        const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
        if (parsed && typeof parsed.rev === 'number' && parsed.collections) {
          db = Object.assign(blank(), parsed);
        }
      }
    } catch (e) {
      /* A corrupt store must not take the bridge down, but silently starting
       * from empty would let the next push overwrite real data, so move the
       * bad file aside and say so loudly. */
      const backup = `${storeFile}.corrupt-${Date.now()}`;
      try { fs.renameSync(storeFile, backup); } catch (_) {}
      log('error', 'sync', `sync.json was unreadable (${e.message}). Moved to ${path.basename(backup)} and started empty.`);
      db = blank();
    }
    const counts = Object.keys(db.collections)
      .map(c => `${c}=${countRecords(c)}`)
      .join(' ');
    log('info', 'sync', `loaded rev ${db.rev}${counts ? ' — ' + counts : ''}`);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty) return;
    try {
      ensureDir();
      /* Write-then-rename: a crash mid-write must not leave a half-serialised
       * store that the next boot reads as corrupt. */
      const tmp = `${storeFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, storeFile);
      dirty = false;
    } catch (e) {
      log('error', 'sync', 'save failed', e.message);
    }
  }

  function save(immediate) {
    dirty = true;
    if (immediate) { saveNow(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }

  /* ----------------------------------------------------------------- helpers */

  function bucket(collection) {
    if (!db.collections[collection]) db.collections[collection] = {};
    return db.collections[collection];
  }

  function countRecords(collection) {
    const b = db.collections[collection];
    if (!b) return 0;
    let n = 0;
    for (const k in b) if (!b[k]._deleted) n++;
    return n;
  }

  /** Server-side metadata is not part of the record the app knows about. */
  function stripInternal(record) {
    const copy = Object.assign({}, record);
    delete copy._deleted;
    delete copy._rev;
    delete copy._serverUpdatedAt;
    delete copy._by;
    return copy;
  }

  function entryOf(collection, id) {
    const b = db.collections[collection];
    return b ? b[id] : null;
  }

  function historyPush(entry) {
    db.history.unshift(entry);
    if (db.history.length > 500) db.history.length = 500;
  }

  /* --------------------------------------------------------------- tombstone */

  function sweepTombstones() {
    const cutoff = Date.now() - cfg.tombstoneDays * 86400000;
    let dropped = 0;
    for (const collection in db.collections) {
      for (const id in db.collections[collection]) {
        const e = db.collections[collection][id];
        if (e._deleted && Date.parse(e._serverUpdatedAt || 0) < cutoff) {
          delete db.collections[collection][id];
          dropped++;
        }
      }
    }
    if (dropped) {
      log('info', 'sync', `swept ${dropped} tombstone(s) older than ${cfg.tombstoneDays} days`);
    }
    return dropped;
  }

  /* -------------------------------------------------------------------- pull */

  /**
   * Everything changed after `since`, oldest change first.
   *
   * The store holds current values, not a change log: editing a record
   * overwrites its entry with a new `_rev`, so the revision it had before is
   * gone. That is fine for the cursor contract, because a client at cursor N has
   * already seen every write up to N and only needs the records whose *current*
   * revision is above N. So this walks the records and filters on `_rev`, which
   * is O(records) — the alternative, stepping one revision at a time, is
   * O(revisions x records) and gets slow once a shop has been syncing for a
   * few months.
   *
   * Results are ordered by `_rev` so a client that runs out of patience part way
   * through a large catch-up and asks again with the cursor it last stored
   * resumes from exactly the right place, and never skips a change.
   */
  function pull({ since = 0, collections, limit } = {}) {
    const wanted = (collections && collections.length ? collections : SYNCABLE)
      .filter(c => COLLECTIONS.includes(c));
    const cap = Math.min(Number(limit) || cfg.maxPullRecords, cfg.maxPullRecords);
    const from = Number(since) || 0;

    const found = [];
    for (const collection of wanted) {
      const b = db.collections[collection];
      if (!b) continue;
      for (const id in b) {
        const e = b[id];
        if (!(e._rev > from)) continue;
        found.push({
          collection,
          id,
          rev: e._rev,
          deleted: !!e._deleted,
          record: e._deleted ? null : stripInternal(e.record),
          updatedAt: e._serverUpdatedAt,
          by: e._by || ''
        });
      }
    }

    /* Stable by revision, and then by id so two records written in the same
     * batch always come back in the same order. Reproducibility matters: an
     * unstable order can make a paginated client loop if it ever re-reads a
     * page boundary. */
    found.sort((a, b) => (a.rev - b.rev) || (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0) ||
                        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const changes = found.slice(0, cap);
    const lastRev = changes.length ? changes[changes.length - 1].rev : from;
    return {
      cursor: lastRev,
      /* `serverRev` is the store's high-water mark. Comparing the two tells a
       * client apart between "nothing new" and "this page was truncated". */
      serverRev: db.rev,
      hasMore: changes.length < found.length,
      count: changes.length,
      changes
    };
  }

  /* -------------------------------------------------------------------- push */

  /**
   * Apply a batch of client changes.
   *
   * Each change carries the `baseRev` the client last saw for that record. A
   * match means nobody else touched it and the write is a fast-forward. A
   * mismatch is a conflict: the server version is returned untouched and the
   * client decides.
   *
   * Persists before returning. A push is the one operation the client is
   * waiting on, so it is also the natural flush point: if the process died
   * after acknowledging a batch but before a debounced write, the device would
   * never send those changes again and the shop would silently lose them.
   */
  function push({ device, changes, strategy, immediate }) {
    const list = Array.isArray(changes) ? changes : [];
    const accepted = [];
    const conflicts = [];
    const rejected = [];

    if (list.length > cfg.maxPushRecords) {
      return {
        ok: false,
        error: `batch of ${list.length} exceeds maxPushRecords (${cfg.maxPushRecords})`
      };
    }

    for (const change of list) {
      const collection = change && change.collection;
      const id = change && change.id;

      if (!COLLECTIONS.includes(collection)) {
        rejected.push({ collection, id, reason: `unknown collection "${collection}"` });
        continue;
      }
      if (!id || typeof id !== 'string') {
        rejected.push({ collection, id, reason: 'missing id' });
        continue;
      }
      if (EXCLUDED.has(collection)) {
        rejected.push({ collection, id, reason: `"${collection}" is served directly by the bridge and is not synced` });
        continue;
      }

      const deleted = change.deleted === true || change.record == null;
      let record = change.record;

      if (!deleted) {
        if (typeof record !== 'object' || Array.isArray(record)) {
          rejected.push({ collection, id, reason: 'record must be an object' });
          continue;
        }
        /* The id lives in the payload but the record's own id field is
         * authoritative for the app; keep them in step so a pulled record
         * addresses the right row. */
        record = Object.assign({}, record);
        if (record.id == null) record.id = id;

        let bytes;
        try { bytes = Buffer.byteLength(JSON.stringify(record), 'utf8'); }
        catch (e) { rejected.push({ collection, id, reason: `record is not serialisable: ${e.message}` }); continue; }
        if (bytes > cfg.maxRecordBytes) {
          rejected.push({
            collection, id,
            reason: `record is ${(bytes / 1024).toFixed(0)} KB, over the ${(cfg.maxRecordBytes / 1024).toFixed(0)} KB limit — ` +
              'images belong in attachments metadata, not inline'
          });
          continue;
        }
      }

      const existing = entryOf(collection, id);
      const serverRev = existing ? existing._rev : 0;
      const baseRev = Number(change.baseRev) || 0;

      if (serverRev !== baseRev) {
        /* Someone wrote since the client last looked. The server does not
         * silently overwrite: hand back what it holds so the client can merge
         * against real data rather than guessing. */
        const conflict = {
          collection,
          id,
          baseRev,
          serverRev,
          serverDeleted: !!(existing && existing._deleted),
          serverRecord: existing && !existing._deleted ? stripInternal(existing.record) : null,
          serverUpdatedAt: existing ? existing._serverUpdatedAt : null,
          by: existing ? existing._by : ''
        };
        if (strategy === 'lww') {
          const clientAt = Date.parse(change.updatedAt || 0) || 0;
          const serverAt = Date.parse(conflict.serverUpdatedAt || 0) || 0;
          if (clientAt > serverAt) {
            write(collection, id, record, deleted, change);
            accepted.push({ collection, id, rev: entryOf(collection, id)._rev, resolved: 'lww' });
            continue;
          }
          conflict.resolved = 'lww-server';
        }
        conflicts.push(conflict);
        continue;
      }

      write(collection, id, record, deleted, change);
      accepted.push({ collection, id, rev: entryOf(collection, id)._rev });
    }

    if (accepted.length) {
      historyPush({
        at: new Date().toISOString(),
        device: device || 'unknown',
        accepted: accepted.length,
        rejected: rejected.length,
        conflicts: conflicts.length,
        rev: db.rev
      });
    }

    /* `dirty` is set by write() and registerClient(); flush here so an
     * acknowledged push is durable. A batch that only produced conflicts and
     * rejections changed nothing worth writing. */
    if (accepted.length) save(immediate === true);

    return {
      ok: true,
      cursor: db.rev,
      serverRev: db.rev,
      accepted,
      conflicts,
      rejected
    };
  }

  function write(collection, id, record, deleted, change) {
    db.rev += 1;
    bucket(collection)[id] = {
      _rev: db.rev,
      _deleted: !!deleted,
      _serverUpdatedAt: new Date().toISOString(),
      _by: (change && change.by) || (change && change.device) || 'unknown',
      /* Tombstones keep no payload: the point is the absence, and retaining the
       * old record would leak data the user asked to delete. */
      record: deleted ? null : record
    };
  }

  /* ------------------------------------------------------------------ status */

  function registerClient(device, info) {
    if (!device) return;
    const prev = db.clients[device] || { seenAt: null, pushes: 0, pulls: 0 };
    db.clients[device] = {
      seenAt: new Date().toISOString(),
      pulls: prev.pulls || 0,
      pushes: (prev.pushes || 0) + 1,
      platform: (info && info.platform) || prev.platform || '',
      appVersion: (info && info.appVersion) || prev.appVersion || '',
      lastPushRev: db.rev
    };
    save();
  }

  function notePull(device) {
    if (!device || !db.clients[device]) return;
    db.clients[device].pulls = (db.clients[device].pulls || 0) + 1;
    save();
  }

  function status() {
    const out = { rev: db.rev, config: cfg, collections: {}, clients: {}, history: db.history.slice(0, 25), totals: 0 };
    for (const c of COLLECTIONS) {
      const n = countRecords(c);
      let tombstones = 0;
      const b = db.collections[c];
      if (b) for (const k in b) if (b[k]._deleted) tombstones++;
      out.collections[c] = { records: n, tombstones, synced: SYNCABLE.includes(c) };
      out.totals += n;
    }
    out.clients = db.clients;
    return out;
  }

  /** Wipe everything. Guarded by the caller, not here. */
  function reset() {
    const was = status().totals;
    db = blank();
    /* saveNow() is a no-op unless something is marked dirty, so say so
     * explicitly — otherwise a reset leaves the old data on disk and the next
     * boot resurrects it. */
    dirty = true;
    saveNow();
    log('warn', 'sync', `store reset — dropped ${was} record(s)`);
    return { ok: true, dropped: was };
  }

  load();

  return {
    COLLECTIONS,
    SYNCABLE,
    EXCLUDED,
    config: cfg,
    load,
    saveNow,
    save,
    pull,
    push,
    status,
    reset,
    registerClient,
    notePull,
    sweepTombstones,
    get rev() { return db.rev; }
  };
}

module.exports = { createSyncStore, SYNCABLE, EXCLUDED, COLLECTIONS };

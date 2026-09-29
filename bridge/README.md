# AMAYA Local Server

One program that does two jobs on a machine on your office network:

- **Serves the AMAYA ERP app** over HTTP, so it is reachable from your phone or any
  machine on the network
- **Reads punches from ZKTeco K40 / K50i terminals** and feeds them to the app

Nothing else needs installing. No npm dependencies.

## Why not just open the HTML file?

The terminals are on your office LAN, and a browser cannot talk to them:

| Problem | Consequence |
| --- | --- |
| Terminals send no `Access-Control-Allow-Origin` header | The browser blocks the response. This is not configurable on the device. |
| Terminals speak plain HTTP on the LAN | An app served over HTTPS is blocked as mixed content. |
| Background tabs get throttled | Polling stops when nobody is looking at the tab. |

Serving over HTTP also fixes a second problem: browsers restrict `localStorage` on
`file://` pages in some configurations, so a double-clicked app can lose your data.
Served over HTTP it behaves normally.

## Start it

Double-click **`start-server.bat`** and leave the window open. It prints:

```
  Open the app:
    http://192.168.0.114:8787/

  Bridge URL     http://192.168.0.114:8787
  API token      iddbhxM62GebACEtEaHKRrCf

  Live attendance board (share this, no login needed):
    http://192.168.0.114:8787/live?token=7AeQjIdQugbrnd2A
```

Then open `http://192.168.0.114:8787/` and sign in with `admin@stockflow.app` / `admin`.

The app works immediately — inventory, sales, payroll and the rest are all usable. Only
live attendance waits on terminals.

### Connecting the app to itself

The app and the server are normally the same address, so in **Settings → Biometric
terminals**:

1. *Bridge URL* → `http://192.168.0.114:8787` (the address it printed)
2. *API token* → the token it printed
3. *Live-view token* → the live token, which is what makes the shareable link work
4. **Save & connect**

### Where things are

| Address | What it is |
| --- | --- |
| `/` | The AMAYA ERP app |
| `/live?token=…` | Read-only attendance board, no login, works on a phone |
| `/status` | Server and terminal status |
| `/health` | JSON status, no token needed |

---

## Adding the terminals later

### 1. Find them on the network

```powershell
node find-devices.js
```

It scans your subnet for anything serving the ZKTeco `/iclock` interface and prints what
each one is, ready to paste into the config. If your network is split, point it at
another range: `node find-devices.js --subnet 192.168.1`.

### 2. Give them fixed IP addresses

In your router, set a **DHCP reservation** for each terminal. Without this the server
loses them whenever addresses are reassigned.

### 3. Fill in `devices.json`

```json
"devices": [
  { "id": "K40",  "model": "ZK K40",  "host": "192.168.0.201", "site": "Main House" },
  { "id": "K50i", "model": "ZK K50i", "host": "192.168.0.202", "site": "New House" }
]
```

- `id` — any short label; it appears throughout the app and the live board
- `host` — the terminal's IP address
- `sn` — leave blank. The serial is detected on first poll and remembered
- `site` — the facility, used to group attendance

Set your shift in the `shift` block: `start`, `end`, `graceMinutes`,
`earlyLeaveGraceMinutes`, `halfDayHours`, and `weekendDays` (0 = Sunday, so `[5,6]` is
Friday and Saturday).

### 4. Restart and confirm

```powershell
node bridge.js --diagnose
```

This prints the raw replies and the first parsed records for each terminal, so you can
confirm it understands your firmware *before* trusting any numbers:

```
  K40  (ZK K40)  http://192.168.0.201
    serial: 8BGDD18507000028
    HTTP 200  17 record(s) parsed
    raw: 1	201	15	2026-09-27 08:35:00	0	2	105	2	...
      · {"pin":"201","at":"2026-09-27T02:35:00.000Z","verify":15,"verifyName":"Face"}
```

If `record(s) parsed` is `0` while the raw line clearly contains data, the parser does not
understand that firmware — send the raw output and it can be adjusted. Both dialects are
supported:

- **Tab separated** — `index ⇥ pin ⇥ verify ⇥ date time ⇥ workcode …` (most K40 firmware)
- **XML** — `<ATTLOG><Row><Pin>…</Pin><DateTime>…</DateTime></Row></ATTLOG>` (newer K50i)

The server also reads each terminal's own user list (`/iclock/user`), so PINs are shown
with the names the device holds.

---

## Mapping PINs to employees

A terminal only knows a number — the PIN (enroll number). The app turns that into a person:

1. **An explicit assignment** you make in the app (highest confidence, always wins)
2. **The employee code equals the PIN.** Staff coded `E-101` who is badged in as `101`
   match automatically
3. **The name on the terminal** matches an employee name

Anything unresolved is listed under **Settings → Biometric terminals → Unmatched terminal
PINs** and in the *Unmapped* view on the Live Attendance page. Those punches are **stored
but not attributed**, so they will not reach payroll until you assign them. Assigning a
PIN re-attributes every past punch for that terminal, so a mistake is fixable without
losing history.

---

## The shareable live view

```
http://192.168.0.114:8787/live?token=…
```

Anyone with that link sees today's board, live counters, terminal status and a punch
feed — no login, works on a phone, refreshes every 15 seconds. **Live Attendance → Copy
live link** in the app puts it on your clipboard.

Because the same person may have a different PIN on each terminal, the server only merges
someone across two terminals once you have explicitly linked them. Until then they appear
separately and marked *unmapped* — deliberate, not a fault.

### Accessing it from outside the office

The server speaks plain HTTP and is meant for a trusted LAN. To reach it from elsewhere,
tunnel it rather than opening the port on your router:

```powershell
cloudflared tunnel --url http://localhost:8787
```

or `ngrok http 8787`. Then share the `https://…` live link it prints.

---

## Confirming the terminals are really talking

Before trusting the data, verify the bridge understands your firmware:

```powershell
node bridge.js --diagnose
```

This prints the raw replies and the first few parsed records for each terminal:

```
  K40  (ZK K40)  http://192.168.1.201
    serial: 8BGDD18507000028
    HTTP 200  17 record(s) parsed
    raw: 1	201	15	2026-09-27 08:35:00	0	2	105	2	...
      · {"pin":"201","at":"2026-09-27T02:35:00.000Z","verify":15,"verifyName":"Face"}
```

If `record(s) parsed` is `0` while the raw line clearly contains data, the bridge does not
understand that firmware. Send the raw output over and the parser can be adjusted. Both
dialects are supported:

- **Tab separated** — `index ⇥ pin ⇥ verify ⇥ date time ⇥ workcode …` (most K40 firmware)
- **XML** — `<ATTLOG><Row><Pin>…</Pin><DateTime>…</DateTime></Row></ATTLOG>` (newer K50i)

The bridge also reads the terminal's own user list (`/iclock/user`), so PINs are shown
with the names the device holds.

---

## Mapping PINs to employees

A terminal only knows a number — the PIN (enroll number). The app turns that into a person:

1. **An explicit assignment** you make in the app (highest confidence, always wins)
2. **The employee code equals the PIN.** Staff coded `E-101` who is badged in as `101`
   match automatically
3. **The name on the terminal** matches an employee name

Anything unresolved is listed under **Settings → Biometric terminals → Unmatched terminal
PINs** and in the *Unmapped* view on the Live Attendance page. Those punches are **stored
but not attributed**, so they will not reach payroll until you assign them. Assigning a
PIN re-attributes every past punch for that terminal, so a mistake is fixable without
losing history.

---

## Running two ways

Both work simultaneously and de-duplicate, so it does not matter which your terminals use.

- **Poll** (default) — the bridge asks each terminal for its records every
  `pollIntervalMs`. This is the normal arrangement.
- **Push** — the terminal is configured to upload to the bridge's `/iclock/…` endpoints.
  Answer `devicecmd?cmd=ATTLOG`, `getrequest`, `cdata` and batched `records` are all handled.

In bridge mode, records are **not** deleted from the terminal. They stay in the device's
own buffer, and the bridge tracks a per-terminal watermark so nothing is counted twice.

---

## Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `8787` | HTTP port. Change if something else uses it. |
| `host` | `0.0.0.0` | Bind address. Use `127.0.0.1` to refuse outside connections. |
| `appFile` | `../index.html` | The single-file app to serve. Re-read from disk on every request, so a rebuild shows up without a restart. |
| `pollIntervalMs` | `15000` | How often to ask each terminal. 15 s is responsive without being noisy. |
| `pageSize` | `5000` | Max records requested per poll. |
| `requestTimeoutMs` | `8000` | Per-request timeout. |
| `keepDays` | `120` | Punches older than this are pruned from `data/`. |
| `liveToken` | generated | Guards the `/live` page. |
| `apiToken` | generated | Guards every `/api/*` endpoint. |
| `corsOrigin` | `*` | CORS header value. Narrow it if the app is served from a known domain. |
| `shift.*` | see above | Working hours used to derive Present / Late / Half Day / Early Leave. |
| `sync.tombstoneDays` | `180` | How long a delete is remembered so offline devices learn about it. |
| `sync.maxPushRecords` | `2000` | Cap on one push batch. Split larger ones; each change carries its own `baseRev`. |
| `sync.maxPullRecords` | `5000` | Cap on one pull page. Follow `next` until `hasMore` is false. |
| `sync.maxRecordBytes` | `262144` | Largest single record accepted. Stops an inline photo bloating the store. |

`devices[]`: `id`, `model`, `host`, `port`, `path`, `sn`, `site`, `enabled`.

---

## Command line

```powershell
node bridge.js                        # uses devices.json
node bridge.js --config my.json       # a different config
node bridge.js --port 9000            # override the port
node bridge.js --app ../index.html    # serve a different app file
node bridge.js --verbose=debug        # log every poll
node bridge.js --diagnose             # probe terminals and print raw replies
node find-devices.js                  # scan the network for terminals
```

---

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /` | The AMAYA ERP app |
| `GET /live?token=…` | Read-only attendance board |
| `GET /status` | Server and terminal status page |
| `GET /health` | JSON status. No token. |
| `GET /api/live?token=…` | Everything the live board needs, in one call |
| `GET /api/devices` | Terminal list with status and latency |
| `POST /api/devices/refresh` | Poll the terminals now |
| `GET /api/attendance?since=ISO&limit=` | Raw punches, newest last |
| `GET /api/attendance/today?date=` | Per-person day rollup |
| `GET /api/users?refresh=1` | Terminal user lists (PIN → name) |
| `GET/POST /api/links` | Read or set PIN → employee assignments |
| `GET /api/diagnostics?device=ID` | Raw device probes for debugging |
| `GET /api/logs` | Recent log entries |
| `GET /api/sync/status` | Sync store summary: revision, per-collection counts, clients |
| `GET /api/sync/pull?since=REV&device=ID` | Records changed since `REV` |
| `POST /api/sync/push` | Send a device's changes; get back accepted / conflicts / rejected |
| `POST /api/sync/sweep` | Drop tombstones past their retention window |
| `POST /api/sync/reset` | Wipe the sync store. Needs `{"confirm":"DELETE-ALL-SYNC-DATA"}` |

All `/api/*` endpoints need the token in an `X-Bridge-Token` header.

---

## Syncing offline devices

The ERP app is **offline-first**: it writes everything to local storage and works
with no network at all. That is the right behaviour for a shop floor — no
downtime, no dead spots in the warehouse. The cost is that two devices which
both work offline have silently drifted apart, and there is no record of who
changed what. These endpoints are the reconciliation point.

### How it works

Every record the server holds carries a **revision**: a single counter that goes
up by one on each accepted write, shared across all collections. A device
remembers the highest revision it has seen and asks for everything above it.

```
device                         server
  |                              |
  |-- GET /api/sync/pull?since=4 ->  cursor=7, 2 changes
  |<-- rev 5, rev 6               |
  |   (applies them locally)      |
  |                              |
  |-- POST /api/sync/push  ------>  baseRev matches -> accepted
  |    { baseRev: 6, ... }        |  baseRev stale   -> conflict
  |<-- { accepted:[...],           |
  |      conflicts:[...] }         |
```

Because the counter is global, one number per device covers every collection.
A device that was offline for a week catches up in a single request.

### Deletions

A record removed on the phone has to disappear on the server *and* on every
other device, so the deletion itself has to travel. A delete is stored as a
**tombstone**: the record is kept with `_deleted: true` and a fresh revision, and
carries no payload. Tombstones expire after `tombstoneDays` (default 180), which
also covers a device that is simply never coming back.

### Conflicts

Every pushed change states the `baseRev` the device believes the server holds.

- **It matches** — nobody else wrote in between, so the change is accepted.
- **It does not match** — someone else got there first, so the server refuses
  and returns **its own copy**. The device merges and retries against the real
  revision. The server never silently discards a client's work.

Pass `{"strategy":"lww"}` to resolve on the server instead, by `updatedAt`.
The default is `conflict`, because the device is the only side that knows which
field the user actually meant to change.

### What is not synced

`audit` and `attendance` are excluded and rejected with a reason. Both are
high-volume append-only logs, and attendance is already served live from the
terminals by `/api/attendance`, so syncing it would be a second, slower copy of
data you already have.

Records over 256 KB are also rejected — that is almost always a base64 photo that
bypassed the attachment rules, and one would bloat the store for every device.

### Standing up

Nothing to configure. The store is created at `data/sync.json` on first use and
loaded at startup; if that file is ever unreadable it is moved aside rather than
silently replaced, so you can recover it.

```powershell
# What has synced so far
curl -H "X-Bridge-Token: $token" http://localhost:8787/api/sync/status
```

The current revision number is what you would put in a device's `since`. Note
that this trust boundary is the same one `/api/links` already has: **anyone
holding the API token can write to the store.** The bridge does not authenticate
users or check roles — the app enforces permissions locally, on the device.

---

## Trying it without hardware

`simulator.js` fakes a terminal — same `/iclock` interface, invented punches — and can
impersonate either firmware dialect. Useful for checking the setup before pointing at the
real devices.

```powershell
# two fake terminals, one per firmware dialect
node simulator.js --port 8801 --id K40  --format=tab --sn K40AAA111
node simulator.js --port 8802 --id K50i --format=xml --sn K50IBBB222
```

Then copy `devices.example.json` to `devices.test.json`, point both devices at
`127.0.0.1` with ports `8801` / `8802`, and run `node bridge.js --config devices.test.json`.

To test the push path instead, give the simulator a server address:

```powershell
node simulator.js --port 8801 --id K40 --push http://localhost:8787
```

---

## Running in the background

Double-clicking `start-server.bat` stops the moment that window closes. To keep it running
across reboots, install it as a Windows service:

```powershell
npm install -g node-windows-service
nss install stockflow "C:\path\to\node.exe" "C:\path\to\bridge.js"
nss start stockflow
```

---

## Data

Punches and watermarks are written to `bridge/data/`. Back that folder up if the history
matters — the terminals keep their own buffer too, but it is finite.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Cannot reach the page at all | Is the window still open? Check `http://localhost:8787/status` on the machine itself. |
| Page loads on the machine but not your phone | The phone is probably not on the same network, or the Wi-Fi blocks client-to-client traffic ("AP isolation"). Try a phone hotspot or Ethernet. |
| `Bridge unreachable` in the app | Wrong URL in Settings, or the server stopped. The URL must be reachable **from the browser**, not just from the server machine. |
| Terminals show `Offline` | Check the address and that the terminal is powered on. `node bridge.js --diagnose` shows the raw error. |
| `ECONNREFUSED` | Nothing is listening on that IP. Verify the address, and that the terminal's web server is enabled (Menu → Comm → Ethernet → Web Server). |
| `0 record(s) parsed` in `--diagnose` | The parser does not understand this firmware. Send the raw output. |
| `parser: two-column layout` | The terminal sends fewer columns than expected. Confirm the PIN and verify columns are in the expected order. |
| Punches under the wrong day | The terminal's clock is wrong. Fix the date and time on the terminal itself. |
| People appear twice | Same person has a different PIN on each terminal. Assign each PIN in the app. |
| Nothing reaches payroll | *Unmapped* punches are stored but not attributed. Assign them under **Settings → Biometric terminals**. |

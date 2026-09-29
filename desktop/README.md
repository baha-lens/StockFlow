# AMAYA ERP for Windows

The full ERP app as a native Windows program, with a setup window for the
machine settings and a shareable live attendance link.

One process does everything:

- Runs AMAYA ERP in a native window
- Serves it on your local network, so a phone or another PC can open it
- Reads your ZKTeco K40 / K50i terminals
- Hosts a read-only live attendance page

## Install

Run **`AMAYA-ERP-Setup-1.0.0.exe`** and follow the prompts. It installs per-user
(no Administrator needed), adds a Start menu entry and a desktop shortcut, and can
put an icon in the notification area.

The first launch opens the setup window. After that, use the tray icon.

## Using it

| | |
| --- | --- |
| **Open the app** | Double-click the shortcut, or click the tray icon |
| **Setup and settings** | Tray icon → *Setup and settings…* |
| **Share the live view** | Setup → *Remote* → *Copy the live link* |
| **Check the terminals** | Setup → *Terminals* → *Test terminals* |
| **Quit** | Tray icon → *Quit AMAYA ERP* |

Closing the window does **not** quit — attendance keeps syncing and the icon stays in
the notification area. That is deliberate; turn it off in Setup → Machine.

## The setup window

Three steps, and it doubles as Settings later.

### 1 · Machine

- **Reachable on this network** — on means a phone on the same Wi-Fi can open the
  app. Off keeps it on this computer only.
- **Port** — 8787 by default. Change it only if something else already has that port.
- **This machine's address** — the address other devices should use, detected for you.
- **Start with Windows** — recommended, so attendance is collected from the moment the
  machine is on. With *Start hidden* it stays in the tray.
- **Close to the notification area** — closing the window keeps the server running.

A status strip shows whether the server is running, how many terminals answer, how
many punches are held, and uptime. If the server will not start, the reason is spelled
out — most often *port already in use*, which usually means a leftover
`node bridge.js` from the standalone version.

### 2 · Terminals

- **Scan now** searches your network for ZKTeco devices. Takes about a minute.
- Add them by hand if the scan misses them, or if they are on another subnet.
- **Test terminals** prints the raw replies and how many records were parsed. Run this
  before trusting any numbers — see below.

Working hours are set here too. A punch after the start time plus the grace period
counts as late; a span shorter than the half-day figure counts as a half day.

### 3 · Remote

The addresses to share: the app, the live attendance board, and the status page. The
live board needs no sign-in — anyone with the link sees today's attendance only.

**From outside the office:** these addresses only work on your local network. Use the
tunnel buttons rather than opening a port on your router. *Start a quick tunnel* runs
`cloudflared` and hands you a temporary `https://` address — install it from
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
first. *Start ngrok* works if you already have ngrok configured.

## How terminals are matched to people

A terminal only stores a number — the PIN. AMAYA ERP resolves it in this order:

1. **An explicit assignment** you make in the app (always wins)
2. **The employee code equals the PIN** — someone coded `E-101` who is badged in as
   `101` matches automatically
3. **The name on the terminal** matches an employee name

Anything unresolved is listed in *Settings → Biometric terminals → Unmatched terminal
PINs*, and on the Live Attendance page under *Unmapped*. Those punches are **stored
but not attributed**, so they do not reach payroll until assigned. Assigning a PIN
re-attributes every past punch for that terminal.

Because two terminals often enrol the same person under different numbers, they are
not merged until you link them. That is on purpose — guessing would corrupt payroll.

## Before you trust the numbers

Run **Test terminals**. It prints, per device, the serial, how many records parsed, and
a raw sample line:

```
  K40  (ZK K40)  http://192.168.31.201
    serial: 8BGDD18507000028
    HTTP 200  17 record(s) parsed
    raw: 1	201	15	2026-09-27 08:35:00	0	...
      · {"pin":"201","verify":15,"verifyName":"Face"}
```

If it says `0 record(s) parsed` while the raw line clearly contains data, the parser
does not understand that firmware. Send that output and it can be adjusted. Both
dialects are handled:

- **Tab separated** — `index ⇥ pin ⇥ verify ⇥ date time ⇥ workcode …` (most K40 firmware)
- **XML** — `<ATTLOG><Row><Pin>…</Pin><DateTime>…</DateTime></Row></ATTLOG>` (newer K50i)

## Where things are kept

| | |
| --- | --- |
| Settings, terminal list, tokens | `%APPDATA%\AMAYA ERP\settings.json` |
| Punches and watermarks | next to the installed `bridge\data\` folder |

Settings live in your user profile, not the install directory, so an upgrade never
discards them. *Show the settings file* in Setup → Remote opens the location.

## Building it yourself

```powershell
cd stockflow-erp
.\build.ps1                 # rebuild the app bundle

cd desktop
npm install
npm run icon                # regenerate assets\icon.ico and tray.png
npm run check               # static guards
npm start                   # run from source
npm run dist                # build the Windows installer
```

The installer lands in `desktop\dist\`.

`stage.js` copies `../index.html` and the bridge into `desktop\` before packaging, so
the build always contains the current app. Run it after every `build.ps1`.

### Guards

`npm run check` runs three checks that catch mistakes which pass `node --check` but
break at runtime:

- `check-dom.cjs` — `$` is an id lookup, so a CSS selector passed to it returns null
  and the next `.onclick` throws
- `check-ipc.cjs` — every channel the main process handles is reachable from the setup
  window, and every method the window calls exists
- `stage.js --check` — the app bundle and bridge are present and current

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Port 8787 is already in use" | A leftover `node bridge.js` from the standalone version. Close it, or pick another port in Setup → Machine. |
| App opens on this PC but not my phone | The phone is probably on a different network, or the router blocks device-to-device traffic (AP isolation). Check you are on the same Wi-Fi. |
| "Cloudflare tunnel is not installed" | Install cloudflared, then retry. The tunnel is optional — it is only for access from outside the office. |
| Terminal shows `Offline` | Check the IP in Setup → Terminals and that the terminal is powered on. *Test terminals* shows the underlying error. |
| `connect ECONNREFUSED` | Nothing is answering on that address. Verify the IP, and that the terminal's web server is enabled: **Menu → Comm → Ethernet → Web Server**. |
| `0 record(s) parsed` | The parser does not understand that firmware. Send the raw output. |
| `parser: unrecognised response` | The terminal returned something unexpected; the sample is shown with the warning. |
| Punches under the wrong day | The terminal's clock is wrong. Fix date and time **on the terminal**. |
| People appear twice | Same person has a different PIN on each terminal. Assign each PIN in the app. |
| Nothing reaches payroll | *Unmapped* punches are stored but not attributed. Assign them in Settings → Biometric terminals. |
| Nothing syncs when the app is closed | The window is closing to the tray, which is expected. Check the tray icon, and that *Start with Windows* is on. |
| Setup window will not open | The tray icon → *Setup and settings…*. If the icon is not there, the app is not running. |
| Settings lost after reinstall | They are kept in `%APPDATA%`. Check the path in Setup → Remote. |

## Uninstalling

Windows Settings → Apps → *AMAYA ERP* → Uninstall. Your settings and punch
history are left in `%APPDATA%\AMAYA ERP\` so a reinstall picks them up; delete
that folder to remove everything.

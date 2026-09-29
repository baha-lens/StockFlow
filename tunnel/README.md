# Cloudflare Tunnel for StockFlow ERP

A permanent, named Cloudflare Tunnel that publishes the StockFlow bridge
(`http://127.0.0.1:8787`) to an `https://` hostname you own, running as a
Windows service that starts with the machine.

No router port forwarding. No public IP. Nothing to open at home.

---

## Read this first: what "free" actually means

| Thing | Cost | Reality |
| --- | --- | --- |
| Cloudflare Tunnel itself | **$0, genuinely** | Not a trial. Free on Cloudflare's free plan, unlimited tunnels, no bandwidth cap, no request cap. This part is solid. |
| SSL certificate for your hostname | **$0** | Cloudflare issues it automatically. |
| Cloudflare Access (the lock) | **$0** | Free up to 50 users. Strongly recommended — see [Part D](#part-d-lock-it-down). |
| **A domain name** | **~$10–15/year** | **This is the one real cost, and it cannot be avoided.** |

### On "free for life"

The tunnel infrastructure is free permanently as far as Cloudflare's published
pricing goes, and Cloudflare is a large, established operator. But be clear-eyed:

- **A custom domain cannot be free and reliable.** If you have never paid for a
  domain, the only "free" option is a free TLD (`.tk`, `.ml`, `.ga`, `.cf`,
  `.gq`). Those are run by a single operator, FreeNom, which has been down or
  suspended repeatedly. ICANN has been moving to retire free domains entirely.
  **Do not build a business system on one.** That is the opposite of reliable.
- **Nobody promises "lifetime".** Any free service is a dependency on someone
  else's business staying healthy and solvent.

**What to do for real durability, in priority order:**

1. Buy a domain and **register it for multiple years** so it is a
   multi-year asset, not an annual renewal risk.
2. Use a registrar you can leave. Cloudflare Registrar sells at wholesale cost
   with no markup, which is hard to beat.
3. Keep the tunnel as a *named* tunnel, not a quick tunnel. A quick tunnel
   (`*.trycloudflare.com`) has **no uptime guarantee** — Cloudflare says so in
   its own startup message, and it is printed in the log above. Named tunnels
   are the supported production path.
4. Because the tunnel is remote-managed from the dashboard, you can move the
   hostname to a new machine by installing the service elsewhere and deleting
   the old connector. You do not re-register the domain.

If you already own any domain, this whole cost section becomes $0 — just point
a subdomain at it.

---

## Already done on this machine

- `cloudflared` **2026.9.3** installed (via winget, at
  `C:\Program Files (x86)\cloudflared\cloudflared.exe`).
- Connectivity to Cloudflare verified: DNS, UDP/QUIC on 7844, TCP/HTTP2, and the
  Cloudflare API all reported **PASS**. A permanent tunnel will work on this
  network.
- End-to-end proof: a throwaway quick tunnel returned **HTTP 200 over HTTPS**
  serving the real StockFlow ERP bundle. The chain
  `internet → Cloudflare → cloudflared → StockFlow` is confirmed working, then
  the test tunnel was removed.

## Files here

| File | Use |
| --- | --- |
| `Install-StockFlowTunnel.ps1` | **Self-contained installer for any machine.** Copy this single file to a new PC. No repo needed. |
| `Install-TunnelService.ps1` | Same job, for use inside this repo. |
| `Test-Tunnel.ps1` | Health check. Tells you which link in the chain is broken. |
| `Uninstall-StockFlowTunnel.ps1` | Removes the service and (optionally) the binary. |

---

# Part A — get a domain

**If you already have a domain**, you can skip to Part B. Using it requires
changing its nameservers to Cloudflare, which Part B needs anyway.

**If you do not:**

1. Buy one. Cheapest reliable route: a `.com` or a common TLD from Cloudflare
   Registrar (at cost) or Porkbun / Namecheap. First-year promos are often
   $5–10; renewal is the number that matters, roughly $10–15/year.
2. Add it to Cloudflare: **dash.cloudflare.com → Add a site**.
3. Cloudflare scans for existing DNS records. **Import them all.** Skipping this
   breaks any existing mail or websites on the domain.
4. Cloudflare gives you two nameservers. Change them at your registrar. This is
   the step that usually needs patience — propagation can take a few hours, up
   to 24–48h. Until it completes, the domain will not work through Cloudflare.

---

# Part B — create the tunnel

1. Go to **dash.cloudflare.com → Zero Trust → Networks → Tunnels**. (If the Zero
   Trust nav is not there yet, the first visit asks you to pick a team name and
   plan — pick **Free**.)
2. **Create a tunnel** → type **Cloudflared** → name it `stockflow-erp`.
3. Choose your OS (**Windows**) and it shows an install command containing a
   long **token**. Keep it — this is the credential. The same token works on
   every machine, so this is the only thing you ever need to copy.
4. **Copy the token, but do not run the dashboard's command yet** — Part C does
   it properly, as a service.
5. With the tunnel open, go to the **Routes** tab → **Add route** →
   **Published application**:
   - **Subdomain**: `erp` (or whatever you like)
   - **Domain**: your domain
   - **Service URL**: `http://127.0.0.1:8787`
   - **Save**.

   The resulting hostname is your permanent address, e.g. `https://erp.example.com`.

> A single-level subdomain like `erp.` is fine. If you use something like
> `erp.office.example.com` you must order an Advanced Certificate first.

---

# Part C — install it as a service on this machine

Open **PowerShell as Administrator** and run:

```powershell
cd C:\Users\abthe\Downloads\StockFLow\tunnel
.\Install-TunnelService.ps1 -Token "PASTE_TOKEN_HERE"
```

Prefer not to paste the token into your shell history? Read it from a file:

```powershell
Get-Content C:\secure\stockflow.tunnel | .\Install-TunnelService.ps1 -Force
```

The script installs cloudflared if it is missing, registers the **Cloudflared**
service with start mode **Automatic**, and starts it. It never prints the token
back, and the service connects out to Cloudflare on its own — no inbound
firewall rule needed.

If PowerShell blocks the script, either run
`Set-ExecutionPolicy -Scope Process Bypass` first, or invoke it explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-TunnelService.ps1 -Token "..."
```

---

# Part D — lock it down

**Please do this part.** It is the single most important step.

StockFlow's login is enforced in JavaScript, and **every seeded account shares
the password `admin`** — `admin@stockflow.app`, `viewer@stockflow.app`, and six
others. Data lives in each browser's `localStorage`, not behind a server. A
permanent public hostname with no extra lock means anyone who finds the URL can
land on a login screen whose credentials are published in this repo's README.

Cloudflare Access fixes this at the edge, before the request ever reaches the
app. It is free up to 50 users.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**
2. **Subdomain**: `erp.example.com` (must match exactly)
3. **Domain**: `example.com`
4. **Path**: leave blank
5. **Policy**:
   - **Action**: `Allow`
   - **Include** → **Emails** → your email address (or your whole team's domain,
     but be deliberate — this is the only thing standing in front of the app)
   - Suggested name: `stockflow-admins`
6. Save.

Now anyone opening the hostname gets an email-code prompt first. Even if a
password leaks, the app is unreachable without a code in your inbox.

Optional hardening, in order of value:

- **Change the seeded passwords** in the app (Admin Control → users). The Access
  policy is the real lock; this is the second one.
- **Access → Settings → Logout every session when a user logs out**, if you want
  tighter session handling.
- Keep the bridge on `127.0.0.1` if you can. It currently binds `0.0.0.0`, which
  also exposes it to your whole office LAN — fine and useful, just be aware.

---

# Part E — verify

```powershell
.\Test-Tunnel.ps1 -Url https://erp.example.com
```

It checks each link separately — local origin, Windows service, DNS, public HTTPS
— and decodes the common failures:

| Result | Meaning | Fix |
| --- | --- | --- |
| **530** | Tunnel not connected | Service not running, or the token is wrong. Check the service, re-run Part C with `-Force`. |
| **502** | Tunnel up, origin down | StockFlow ERP is not running. Start it. |
| **1033** | No connector on that hostname | The DNS record still points at a dead tunnel. Delete it in DNS → Records; Part C recreates it. |
| **403** | Access is blocking you | Working as intended. Sign in through the browser, or send the Access service token as a header. |
| **ERR_TUNNEL / timeout** | No route to Cloudflare | Corporate firewall blocking 7844. Add a firewall rule, or force HTTP/2: `--protocol http2`. |

Also confirm in the dashboard: **Tunnels → stockflow-erp → Healthy**.

---

# New machine

Copy **`Install-StockFlowTunnel.ps1`** — that one file, nothing else — to the
new PC and run it in an elevated PowerShell:

```powershell
.\Install-StockFlowTunnel.ps1 -Token "PASTE_TOKEN_HERE" -TestUrl https://erp.example.com
```

It detects and skips its own elevation prompt, installs cloudflared, registers
the service, and tests the public URL. It will also do a winget install, or fall
back to downloading the binary from GitHub if winget is missing or fails.

Then delete the connector on the **old** machine (Tunnels → your tunnel →
Connectors) so the two do not compete for traffic. Only one connector should
serve the hostname.

**Re-printing the token later**, if you lose it:

```powershell
Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" |
  Select-Object -ExpandProperty PathName
```

It is in the service's argument list. Treat it as a secret. If it ever leaks,
rotate it in the dashboard and re-run the installer with `-Force`.

---

# Day-to-day

```powershell
Get-Service Cloudflared                                    # is it up?
Restart-Service Cloudflared                                # nudge it
Stop-Service Cloudflared                                   # pause the tunnel
Start-Service Cloudflared                                  # resume
Get-WinEvent -LogName Application -ProviderName cloudflared -MaxEvents 20   # logs
```

Two dependencies to keep in mind:

1. **StockFlow ERP must be running**, or the hostname returns 502. Turn on
   "Start with Windows" in its setup window so it comes back after a reboot
   before the tunnel can serve anything.
2. **cloudflared does not auto-update on Windows.** Check
   `cloudflared --version` every few months and update via
   `winget upgrade Cloudflare.cloudflared`. Cloudflare supports versions within
   one year of the latest.

---

# Note on which copy is being served

The StockFlow process on this machine is running from:

```
C:\Users\abthe\Documents\Default Project\stockflow-erp\desktop\dist\win-unpacked\StockFlow ERP.exe
```

That installed build is what port 8787 serves — **not** the `index.html` in
`C:\Users\abthe\Downloads\StockFLow`. Edits made in the working copy will not
show up on the tunnel until you rebuild and reinstall the desktop app. The two
bundles were already slightly different sizes (517,147 vs 517,377 bytes) at the
time of testing.

<#
.SYNOPSIS
  Checks whether the StockFlow Cloudflare tunnel is actually working, and if
  not, tells you which of the three things in the chain is broken.

.DESCRIPTION
  The chain is:  public DNS  ->  Cloudflare edge  ->  cloudflared service
  ->  StockFlow bridge. Each script below tests one link, so the first one
  that fails is the one to fix.

.PARAMETER Url
  The public hostname, e.g. https://erp.example.com. If omitted the script
  asks for it.

.EXAMPLE
  .\Test-Tunnel.ps1 -Url https://erp.example.com
#>
[CmdletBinding()]
param(
  [string]$Url,
  [int]$LocalPort = 8787
)

$ErrorActionPreference = 'Continue'
$ServiceName = 'Cloudflared'

function Head  { param($t) Write-Host "`n--- $t " -ForegroundColor Cyan; Write-Host ('-' * ($t.Length + 5)) -ForegroundColor Cyan }
function Ok    { param($m) Write-Host "  PASS  $m" -ForegroundColor Green }
function Bad   { param($m) Write-Host "  FAIL  $m" -ForegroundColor Red }
function Note  { param($m) Write-Host "  ..    $m" -ForegroundColor Gray }

if (-not $Url) {
  $Url = Read-Host 'Public URL (e.g. https://erp.example.com)'
}
$Url = $Url.Trim().TrimEnd('/')
$host_ = ([Uri]$Url).Host
$failed = 0

Write-Host ''
Write-Host "  StockFlow tunnel check -> $Url" -ForegroundColor White

# 1. origin ----------------------------------------------------------------
Head '1. Local origin'
$local = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($local) {
  $proc = (Get-Process -Id $local[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Ok "bridge is listening on 127.0.0.1:$LocalPort ($proc)"
} else {
  Bad "nothing is listening on port $LocalPort"
  Note 'start StockFlow ERP. Until it runs, the public URL returns HTTP 502.'
  $failed++
}

# 2. service ---------------------------------------------------------------
Head '2. cloudflared Windows service'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Bad "service '$ServiceName' is not installed"
  Note 'run .\Install-TunnelService.ps1 -Token <token>'
  $failed++
} else {
  if ($svc.Status -eq 'Running') { Ok 'service is Running' }
  else { Bad "service is $($svc.Status)"; $failed++ }
  $auto = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartMode
  if ($auto -eq 'Auto') { Ok 'start mode is Automatic (survives reboot)' }
  else { Bad "start mode is $auto - it will not start after a reboot"; $failed++ }
}

# 3. DNS -------------------------------------------------------------------
Head '3. DNS'
try {
  $ips = [System.Net.Dns]::GetHostAddresses($host_) | ForEach-Object { $_.IPAddressToString }
  if ($ips) { Ok "$host_ resolves to $($ips -join ', ')" }
  else { Bad "$host_ does not resolve"; $failed++ }
} catch {
  Bad "$host_ does not resolve ($($_.Exception.Message))"
  Note 'if the zone was just pointed at Cloudflare, DNS can take a few minutes.'
  $failed++
}

# 4. TLS + public app ------------------------------------------------------
Head '4. Public HTTPS endpoint'
try {
  $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 25
  if ($r.StatusCode -eq 200) { Ok "HTTP $($r.StatusCode), $($r.RawContentLength) bytes" }
  else { Note "HTTP $($r.StatusCode)" }
  if ($r.Content -match 'StockFlow') { Ok 'served page is StockFlow ERP' }
  else { Bad 'response did not look like StockFlow ERP' ; $failed++ }
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  if ($code -eq 502) {
    Bad 'HTTP 502 - Cloudflare reached the tunnel but the origin refused'
    Note 'the bridge on the local port is down or not listening. Restart StockFlow ERP.'
    $failed++
  } elseif ($code -eq 403) {
    Bad 'HTTP 403 - a Cloudflare Access policy is blocking this request'
    Note 'that is Access working. Sign in through the browser, or use an API/service token.'
  } elseif ($code -eq 530) {
    Bad 'HTTP 530 - the tunnel is not connected'
    Note 'the cloudflared service is not registered with the tunnel, or the token is wrong.'
    $failed++
  } else {
    Bad "request failed: $(if($code){$code}else{$_.Exception.Message})"
    $failed++
  }
}

# summary ------------------------------------------------------------------
Write-Host ''
if ($failed -eq 0) {
  Write-Host '  All checks passed. The tunnel is up.' -ForegroundColor Green
} else {
  Write-Host "  $failed check(s) failed - see the FAIL lines above." -ForegroundColor Red
  Write-Host '  Service logs:  Get-WinEvent -LogName Application -ProviderName cloudflared -MaxEvents 20' -ForegroundColor Gray
}
Write-Host ''
exit $(if ($failed -eq 0) { 0 } else { 1 })

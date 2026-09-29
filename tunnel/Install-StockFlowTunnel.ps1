#Requires -RunAsAdministrator
<#
  ================================================================================
   StockFlow ERP - Cloudflare Tunnel installer (single file, no dependencies)
  ================================================================================

   Copy THIS ONE FILE to the new PC and run it. Nothing else is needed - it
   installs cloudflared, registers the Windows service, and verifies the tunnel.

   You need the TUNNEL TOKEN from the Cloudflare dashboard. The same token works
   on every machine, so build it once and reuse it. To re-print it later:
     Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" |
       Select-Object -ExpandProperty PathName

   IMPORTANT - the token is a credential. Anyone holding it can serve your
   hostname. Treat it like a password: do not email it, do not commit it to
   git, do not paste it into a shared chat.

   USAGE
     Right-click this file -> "Run with PowerShell" as Administrator, or:
       .\Install-StockFlowTunnel.ps1 -Token eyJhIjoi...
       .\Install-StockFlowTunnel.ps1 -TokenFile C:\secure\stockflow.tunnel
       .\Install-StockFlowTunnel.ps1 -Token eyJh... -TestUrl https://erp.example.com

   TO UNINSTALL
       .\Uninstall-StockFlowTunnel.ps1
  ================================================================================
#>
[CmdletBinding()]
param(
  [string]$Token,
  [string]$TokenFile,
  [string]$TestUrl,
  [int]$LocalPort = 8787,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Cloudflared'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn2{ param($m) Write-Host "    $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "    $m" -ForegroundColor Red }

# --- 0. elevation --------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Err 'Must run as Administrator.'
  Write-Host '    Re-launching elevated...' -ForegroundColor Gray
  $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
  if ($Token)      { $argList += @('-Token',      $Token) }
  if ($TokenFile)  { $argList += @('-TokenFile',  $TokenFile) }
  if ($TestUrl)    { $argList += @('-TestUrl',    $TestUrl) }
  $argList += @('-LocalPort', $LocalPort)
  if ($Force)      { $argList += '-Force' }
  try {
    Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
    exit $LASTEXITCODE
  } catch {
    Write-Err 'Elevation was declined. Right-click -> Run as Administrator.'
    exit 1
  }
}

# --- 1. token -------------------------------------------------------------
Write-Step 'Tunnel token'
if (-not $Token -and $TokenFile) {
  if (Test-Path $TokenFile) { $Token = (Get-Content $TokenFile -Raw).Trim() }
  else { Write-Err "Token file not found: $TokenFile"; exit 1 }
}
if (-not $Token) {
  $Token = (Read-Host 'Paste the tunnel token from the Cloudflare dashboard').Trim()
}
# Users often paste with stray quotes or a trailing newline.
$Token = $Token.Trim().Trim('"').Trim("'").Trim()
if ([string]::IsNullOrWhiteSpace($Token)) { Write-Err 'No token supplied.'; exit 1 }
if ($Token.Length -lt 40) {
  Write-Warn2 "That token is only $($Token.Length) characters - it looks too short."
  Write-Host '    A real tunnel token is a long base64-ish string. Continue anyway? [y/N]' -ForegroundColor Gray
  if ((Read-Host).ToLower() -ne 'y') { exit 1 }
}
Write-Ok "token captured ($($Token.Length) chars, not displayed)"

# --- 2. cloudflared -------------------------------------------------------
function Find-Cloudflared {
  $c = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe",
                   "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
                   "$env:LOCALAPPDATA\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

Write-Step 'cloudflared'
$exe = Find-Cloudflared
if ($exe) {
  Write-Ok "already installed ($((& $exe --version)))"
} else {
  $ok = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Ok 'installing with winget...'
    & winget install --id Cloudflare.cloudflared --exact --silent `
        --accept-package-agreements --accept-source-agreements | Out-Null
    $exe = Find-Cloudflared; $ok = [bool]$exe
  }
  if (-not $ok) {
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
    $dir  = "$env:LOCALAPPDATA\cloudflared"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir 'cloudflared.exe'
    Write-Ok 'downloading from GitHub...'
    Invoke-WebRequest -UseBasicParsing -OutFile $exe -Uri `
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe"
  }
  if (-not $exe) { Write-Err 'cloudflared install failed.'; exit 1 }
  Write-Ok "installed: $exe"
}

# --- 3. origin ------------------------------------------------------------
Write-Step "StockFlow bridge on port $LocalPort"
$listen = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($listen) {
  Write-Ok "listening (process: $((Get-Process -Id $listen[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName))"
} else {
  Write-Warn2 'not listening - the public URL will return HTTP 502 until StockFlow ERP runs.'
  Write-Host '    Enable "Start with Windows" in the StockFlow setup window.' -ForegroundColor Gray
}

# --- 4. service -----------------------------------------------------------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if (-not $Force) {
    Write-Warn2 "'$ServiceName' already exists. Re-run with -Force to replace it."
    exit 0
  }
  Write-Step 'Replacing existing service'
  if ($svc.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force }
  & $exe service uninstall | Out-Null
  Start-Sleep -Seconds 2
}

Write-Step 'Installing the service'
& $exe service install $Token
if ($LASTEXITCODE -ne 0) {
  Write-Err "service install failed (exit $LASTEXITCODE)"
  exit 1
}
Start-Sleep -Seconds 4

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Err 'Service was not created.'; exit 1 }
$mode = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartMode
Write-Ok "service created - status: $($svc.Status), start mode: $mode"

for ($i = 0; $i -lt 12; $i++) {
  if ((Get-Service -Name $ServiceName).Status -eq 'Running') { break }
  Start-Sleep -Seconds 2
}
if ((Get-Service -Name $ServiceName).Status -eq 'Running') { Write-Ok 'service is running' }
else { Write-Warn2 'service has not reported Running yet' }

# --- 5. verify ------------------------------------------------------------
if ($TestUrl) {
  Write-Step "Verifying $TestUrl"
  try {
    $r = Invoke-WebRequest -Uri $TestUrl.TrimEnd('/') -UseBasicParsing -TimeoutSec 25
    if ($r.StatusCode -eq 200) { Write-Ok "HTTP $($r.StatusCode), $($r.RawContentLength) bytes" }
    else { Write-Warn2 "HTTP $($r.StatusCode)" }
    if ($r.Content -match 'StockFlow') { Write-Ok 'served page is StockFlow ERP' }
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    switch ($code) {
      530      { Write-Warn2 'HTTP 530 - tunnel not connected yet; give it a minute.' }
      502      { Write-Warn2 'HTTP 502 - origin down. Start StockFlow ERP.' }
      403      { Write-Warn2 'HTTP 403 - Cloudflare Access is blocking. Sign in via the browser.' }
      default  { Write-Warn2 "request failed $(if($code){$code}else{$_.Exception.Message})" }
    }
  }
}

Write-Host ''
Write-Host '  Installation complete.' -ForegroundColor Green
Write-Host '  The tunnel now starts automatically with Windows.' -ForegroundColor Gray
Write-Host '  Logs: Get-WinEvent -LogName Application -ProviderName cloudflared -MaxEvents 20' -ForegroundColor Gray
Write-Host ''

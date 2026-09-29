#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs cloudflared as a Windows service, permanently exposing the local
  StockFlow ERP bridge to a Cloudflare-managed https:// hostname.

.DESCRIPTION
  Creates a Windows service named "Cloudflared" that starts automatically at
  boot and reconnects to Cloudflare on its own. Nothing needs to be open on
  the router and no inbound port is forwarded - cloudflared dials out to
  Cloudflare over port 7844 (UDP/TCP).

  The tunnel is a REMOTE-MANAGED tunnel: the public hostname and the ingress
  rules live in the Cloudflare dashboard, not in this script. This script only
  needs the tunnel token, which the dashboard gives you when you create the
  tunnel.

.PARAMETER Token
  The tunnel token from the Cloudflare dashboard. Required.

.PARAMETER LocalPort
  Port the StockFlow bridge listens on. Default 8787.

.PARAMETER Force
  Remove and recreate the service if it already exists.

.EXAMPLE
  .\Install-TunnelService.ps1 -Token eyJhIjoiYOUR_TOKEN_HERE

.EXAMPLE
  # Read the token from a file instead of the shell history
  Get-Content C:\secure\stockflow.tunnel | .\Install-TunnelService.ps1 -Force
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Token,

  [int]$LocalPort = 8787,

  [switch]$SkipCloudflaredInstall,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Cloudflared'

function Write-Step  { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn2 { param($m) Write-Host "    $m" -ForegroundColor Yellow }
function Write-Err   { param($m) Write-Host "    $m" -ForegroundColor Red }

# --- 0. must be elevated -------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Err 'This script must be run as Administrator.'
  Write-Host '    Right-click the folder -> "Open in Terminal" as Administrator, or:' -ForegroundColor Gray
  Write-Host '    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File ""$PSCommandPath"" -Token <token>"' -ForegroundColor Gray
  exit 1
}

# --- 1. locate or install cloudflared ------------------------------------
function Find-Cloudflared {
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
  )) { if (Test-Path $p) { return $p } }
  return $null
}

$exe = Find-Cloudflared
if ($exe) {
  Write-Step 'cloudflared found'
  $ver = (& $exe --version) -replace '.*?(\d{4}\.\d+\.\d+).*','$1'
  Write-Ok "$exe (version $ver)"
} else {
  if ($SkipCloudflaredInstall) {
    Write-Err 'cloudflared is not installed and -SkipCloudflaredInstall was set.'
    exit 1
  }
  Write-Step 'Installing cloudflared'
  $installed = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Ok 'using winget'
    & winget install --id Cloudflare.cloudflared --exact --silent `
        --accept-package-agreements --accept-source-agreements | Out-Null
    $exe = Find-Cloudflared
    $installed = [bool]$exe
  }
  if (-not $installed) {
    Write-Ok 'falling back to direct download from GitHub'
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
    $dir  = "$env:LOCALAPPDATA\cloudflared"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $dest = Join-Path $dir 'cloudflared.exe'
    $url  = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    $exe = $dest
  }
  if (-not $exe) { Write-Err 'cloudflared installation failed.'; exit 1 }
  Write-Ok "installed to $exe"
}

# --- 2. check the origin is up -------------------------------------------
Write-Step "Checking the StockFlow bridge on port $LocalPort"
$listening = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $proc = (Get-Process -Id $listening[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Ok "port $LocalPort is listening (process: $proc)"
} else {
  Write-Warn2 "port $LocalPort is NOT listening."
  Write-Host '    The tunnel will answer HTTP 502 until StockFlow ERP is running.' -ForegroundColor Gray
  Write-Host '    In the StockFlow setup window, turn on "Start with Windows" so it comes' -ForegroundColor Gray
  Write-Host '    back after a reboot before the tunnel can serve traffic.' -ForegroundColor Gray
}

# --- 3. install the service ----------------------------------------------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($Force) {
    Write-Step "Service already exists - removing it (-Force)"
    if ($svc.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force }
    & $exe service uninstall | Out-Null
    Start-Sleep -Seconds 2
    Write-Ok 'old service removed'
  } else {
    Write-Warn2 "Service '$ServiceName' already exists."
    Write-Host '    Re-run with -Force to replace it (e.g. after rotating the token).' -ForegroundColor Gray
    exit 0
  }
}

Write-Step 'Installing the Cloudflared service'
Write-Ok 'the token is passed as a service argument and is stored in the service config'

# Keep the token out of the transcript. cloudflared's own logs go to the
# Windows Event Log under source "Cloudflared" - see Test-Tunnel.ps1.
& $exe service install $Token
if ($LASTEXITCODE -ne 0) {
  Write-Err "cloudflared service install failed (exit $LASTEXITCODE)."
  Write-Host '    If the token was pasted with quotes or trailing whitespace, strip them.' -ForegroundColor Gray
  exit 1
}

Start-Sleep -Seconds 3

# --- 4. verify -----------------------------------------------------------
Write-Step 'Verifying'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Err 'Service was not created.'; exit 1 }
Write-Ok "service '$ServiceName' is $($svc.Status), start type: $((Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartMode)"

$started = 0
for ($i = 0; $i -lt 12; $i++) {
  if ((Get-Service -Name $ServiceName).Status -eq 'Running') { $started = 1; break }
  Start-Sleep -Seconds 2
}
if ($started) { Write-Ok 'service is running' }
else { Write-Warn2 'service has not reported Running yet - run .\Test-Tunnel.ps1' }

Write-Host ''
Write-Host '  Done. Next:' -ForegroundColor Cyan
Write-Host '   1. Confirm the tunnel shows Healthy in the Cloudflare dashboard.' -ForegroundColor Gray
Write-Host '   2. Run .\Test-Tunnel.ps1 to confirm the public URL responds.' -ForegroundColor Gray
Write-Host '   3. Put a Cloudflare Access policy in front of it (strongly advised).' -ForegroundColor Gray
Write-Host '      See README.md - StockFlow ships with password "admin" on every account.' -ForegroundColor Yellow
Write-Host ''

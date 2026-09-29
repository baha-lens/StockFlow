#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Removes the Cloudflared Windows service and, optionally, cloudflared itself.

.PARAMETER KeepBinary
  Leave cloudflared installed (useful if something else uses it).

.EXAMPLE
  .\Uninstall-StockFlowTunnel.ps1
#>
[CmdletBinding()]
param([switch]$KeepBinary)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Cloudflared'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Must run as Administrator.' -ForegroundColor Red; exit 1 }

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

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "Removing service '$ServiceName'..."
  if ($svc.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force; Start-Sleep -Seconds 2 }
  $exe = Find-Cloudflared
  if ($exe) { & $exe service uninstall | Out-Null }
  else { sc.exe delete $ServiceName | Out-Null }
  Start-Sleep -Seconds 2
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host '  Service removal did not complete. Try: sc.exe delete Cloudflared' -ForegroundColor Red
  } else {
    Write-Host '  Service removed.' -ForegroundColor Green
  }
} else {
  Write-Host "No service named '$ServiceName' found." -ForegroundColor Yellow
}

if (-not $KeepBinary) {
  Write-Host 'Removing cloudflared...'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget uninstall --id Cloudflare.cloudflared --silent 2>&1 | Out-Null
  }
  if (Test-Path "$env:LOCALAPPDATA\cloudflared") {
    Remove-Item "$env:LOCALAPPDATA\cloudflared" -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host '  cloudflared removed (Program Files entry may remain; delete it if you want).' -ForegroundColor Green
}

Write-Host ''
Write-Host 'The DNS record for your hostname still points at the tunnel.' -ForegroundColor Yellow
Write-Host 'Delete it in the Cloudflare dashboard (DNS -> Records) or the hostname will' -ForegroundColor Yellow
Write-Host 'keep returning HTTP 1033 until you do.' -ForegroundColor Yellow
Write-Host ''

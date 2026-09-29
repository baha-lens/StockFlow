param(
  [string]$OutFile = (Join-Path $PSScriptRoot 'index.html')
)

$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'src'
$out = [System.IO.Path]::GetFullPath($OutFile)

# --- read sources -----------------------------------------------------------
$css = Get-Content (Join-Path $src 'styles.css') -Raw -Encoding UTF8
$body = Get-Content (Join-Path $src 'shell.html') -Raw -Encoding UTF8

# 09-init.js must stay last: boot() runs at the end of the bundle and needs
# every declaration above it to already exist.
#
# 00-brand.js must be first: it declares `const BRAND`, and a `const` is in its
# temporal dead zone until the line that declares it runs.
#
# 16/17/18 are the experience layer - themes and form factor, the drill
# registry, and the trade-in desk. They run before 09-init because boot()
# installs the theme, the layout mode and the drill table, but after 07-modals
# because 18-tradein attaches a method to the `Modals` object.
$jsFiles = @(
  'js\00-brand.js',
  'js\01-core.js',
  'js\02-ui.js',
  'js\14-bulk.js',
  'js\12-native.js',
  'js\13-attachments.js',
  'js\15-backnav.js',
  'js\16-experience.js',
  'js\03-pages-a.js',
  'js\04-pages-b.js',
  'js\05-pages-c.js',
  'js\06-pages-d.js',
  'js\07-modals.js',
  'js\17-drills.js',
  'js\18-tradein.js',
  'js\08-docs.js',
  'js\10-devices.js',
  'js\11-live.js',
  'js\09-init.js'
)
$js = ($jsFiles | ForEach-Object { Get-Content (Join-Path $src $_) -Raw -Encoding UTF8 }) -join "`n"

$version = (Select-String -Path (Join-Path $src 'js\01-core.js') -Pattern "version:\s*'([^']+)'").Matches[0].Groups[1].Value
$stamp   = (Get-Item (Join-Path $src 'js\01-core.js')).LastWriteTime.ToString('yyyy-MM-dd')

# --- assemble ---------------------------------------------------------------
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('<!doctype html>')
[void]$sb.AppendLine('<html lang="en" data-theme="light">')
[void]$sb.AppendLine('<head>')
[void]$sb.AppendLine('<meta charset="utf-8">')
[void]$sb.AppendLine('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
[void]$sb.AppendLine('<meta name="color-scheme" content="light dark">')
[void]$sb.AppendLine('<meta name="theme-color" content="#b6751c">')
[void]$sb.AppendLine("<meta name=`"description`" content=`"AMAYA ERP - unified warehouse, retail, after-sales and back-office management. Works fully offline.`">")
[void]$sb.AppendLine("<title>AMAYA ERP &mdash; Unified Distribution Suite</title>")
[void]$sb.AppendLine('<link rel="preconnect" href="https://fonts.googleapis.com">')
[void]$sb.AppendLine('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
[void]$sb.AppendLine('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">')
[void]$sb.AppendLine('<style>')
[void]$sb.AppendLine($css.TrimEnd())
[void]$sb.AppendLine('</style>')
[void]$sb.AppendLine('</head>')
[void]$sb.AppendLine('<body>')
[void]$sb.AppendLine($body.Trim())
[void]$sb.AppendLine('')
# Capacitor plugin bundle, when one has been built. It loads BEFORE the app
# script so window.SFPlugins is already defined when the native layer first
# looks for it. The plain web build has no such file, so this is optional.
$nativeBundle = Join-Path (Split-Path -Parent $out) '_native.js'
if (Test-Path $nativeBundle) {
  [void]$sb.AppendLine('<script>')
  [void]$sb.AppendLine((Get-Content $nativeBundle -Raw -Encoding UTF8).Trim())
  [void]$sb.AppendLine('</script>')
}

[void]$sb.AppendLine("<script>`n/* AMAYA ERP v$version - built $stamp - single-file bundle */`n(function(){'use strict';")
[void]$sb.AppendLine($js.Trim())
[void]$sb.AppendLine('})();')
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('</body>')
[void]$sb.AppendLine('</html>')

$encoding = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($out, $sb.ToString(), $encoding)

# --- guards ------------------------------------------------------------------
# `$` is an id lookup; passing it a CSS selector returns null at runtime. Catch
# that here rather than in the browser. Node is optional, so skip if absent.
if (Get-Command node -ErrorAction SilentlyContinue) {
  $guard = Join-Path $PSScriptRoot 'check-selectors.cjs'
  if (Test-Path $guard) {
    # Pass the real output path so the guard never inspects a stale index.html.
    & node $guard $out
    if ($LASTEXITCODE -ne 0) { throw 'build aborted: see the guard output above' }
  }

  $maths = Join-Path $PSScriptRoot 'tools\maths-test.js'
  if (Test-Path $maths) {
    Write-Host "Running arithmetic regression suite..."
    & node $maths
    if ($LASTEXITCODE -ne 0) { throw 'build aborted: maths regression failed' }
    Write-Host "  maths regression OK"
  }
}

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "Built $out  ($version, $size KB, $($jsFiles.Count + 2) sources)"

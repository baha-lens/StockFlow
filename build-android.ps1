<#
.SYNOPSIS
    Builds the AMAYA ERP Android app end to end.

.DESCRIPTION
    One command, in the only order that works:

      1. build.ps1 concatenates the web sources into mobile/www/index.html
         and runs the guard (parse check, duplicate top-level declarations,
         CSS selectors passed to $()).
      2. esbuild bundles the Capacitor plugins into www/_native.js. This has to
         happen from mobile/ because that is where node_modules/@capacitor
         lives, and it has to happen on every web build: a native plugin added
         or upgraded later would otherwise be missing from the bundle while the
         build reported success.
      3. `cap sync` copies www/ into the Android project. Skipping this is how
         a release APK ends up shipping a stale web bundle: gradle happily
         packages whatever is in android/app/src/main/assets/public, so a
         forgotten sync produces a signed, installable APK that silently runs
         the previous version of the app.
      4. gradlew assembles the APK.
      5. verify-release-apk.js checks the result actually contains the Capacitor
         bridge and a web bundle identical to the one just built.

    Step 5 exists because the failure it catches is invisible otherwise: R8
    can strip the plugin classes, leaving an APK that launches fine and then
    fails on every camera, file and back-button call.

.PARAMETER Variant
    debug (default) or release. Release additionally builds the .aab.

.PARAMETER SkipWeb
    Rebuild only the native side. Only for iterating on Java/Kotlin changes.

.EXAMPLE
    .\build-android.ps1
    .\build-android.ps1 -Variant release
#>
[CmdletBinding()]
param(
    [ValidateSet('debug', 'release')]
    [string]$Variant = 'debug',

    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$mobile = Join-Path $root 'mobile'
$www = Join-Path $mobile 'www'
$android = Join-Path $mobile 'android'

# Capacitor 8 refuses to compile under the JDK 17 that ships with the Android
# Studio default install on this machine, so pin the JDK the build is known to
# work with. gradle.properties pins it too; this is the belt to that braces.
$jdkCandidates = @(
    'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot',
    'C:\Program Files\Java\jdk-21',
    'C:\Program Files\Eclipse Adoptium\jdk-21*'
)
$jdk = $null
foreach ($c in $jdkCandidates) {
    $hit = Get-Item $c -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $jdk = $hit.FullName; break }
}
if ($jdk) {
    $env:JAVA_HOME = $jdk
    Write-Host "JAVA_HOME  $jdk" -ForegroundColor DarkGray
} else {
    Write-Warning "No JDK 21 found; falling back to whatever JAVA_HOME is set. Capacitor 8 needs JDK 21."
}

function Step($n, $msg) { Write-Host "`n[$n/5] $msg" -ForegroundColor Cyan }

# --- 1. web bundle -----------------------------------------------------------

if ($SkipWeb) {
    Write-Warning '-SkipWeb: using whatever is already in mobile/www.'
} else {
    Step 1 'Building the web bundle (build.ps1 + guard)'
    & (Join-Path $root 'build.ps1') -OutFile (Join-Path $www 'index.html')
    if ($LASTEXITCODE -ne 0) { throw "build.ps1 failed" }

    # The browser/Electron bundle gets the same features, so keep it in step.
    Write-Host '        also rebuilding the desktop/web bundle' -ForegroundColor DarkGray
    & (Join-Path $root 'build.ps1') | Out-Null

    Step 2 'Bundling the Capacitor plugins (esbuild -> www/_native.js)'
    Push-Location $mobile
    try {
        & npx esbuild native-entry.js --bundle --format=iife --target=es2019 --minify --outfile=www\_native.js
        if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }
    } finally { Pop-Location }
}

# --- 2. sanity before we hand it to gradle -----------------------------------

if (-not (Test-Path (Join-Path $www 'index.html'))) {
    throw "mobile/www/index.html is missing. Run without -SkipWeb."
}
if (-not (Test-Path (Join-Path $www '_native.js'))) {
    throw "mobile/www/_native.js is missing. Run without -SkipWeb - without it the app has no native bridge."
}

# --- 3. copy into the Android project ----------------------------------------

Step 3 'cap sync (copies www/ into the Android project)'
Push-Location $mobile
try {
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }
} finally { Pop-Location }

# Prove the copy happened. A stale bundle here is exactly the bug that step 3
# exists to prevent, and it is invisible in the gradle log.
$assets = Join-Path $android 'app\src\main\assets\public\index.html'
$fresh = Join-Path $www 'index.html'
$h1 = (Get-FileHash $assets -Algorithm SHA256).Hash
$h2 = (Get-FileHash $fresh  -Algorithm SHA256).Hash
if ($h1 -ne $h2) {
    throw "assets/public/index.html does not match mobile/www/index.html after sync. The APK would ship a stale web bundle."
}
Write-Host "        web bundle in sync ($($h2.Substring(0,12))...)" -ForegroundColor DarkGray

# --- 4. gradle ---------------------------------------------------------------

if ($Variant -eq 'release') {
    Step 4 'assembleRelease + bundleRelease'
    $tasks = ':app:assembleRelease', ':app:bundleRelease'
} else {
    Step 4 'assembleDebug'
    $tasks = ':app:assembleDebug'
}

Push-Location $android
try {
    # Gradle 8.14 rejects abbreviated task names like 'assembleDebug' (ambiguous).
    # Use the full path. PowerShell splatting with @tasks passes each array element
    # as its own argument, but colons in task names get mangled by the batch file.
    # Use cmd /c to run gradle directly with the full task path.
    $taskStr = $tasks -join ' '
    & cmd /c ".\gradlew.bat $taskStr --console=plain"
    if ($LASTEXITCODE -ne 0) { throw "gradle $tasks failed" }
} finally { Pop-Location }

# --- 5. verify the artefact --------------------------------------------------

Step 5 'Verifying the APK'

$outDir = Join-Path $android "app\build\outputs\apk\$Variant"
$apk = Get-ChildItem $outDir -Filter '*.apk' -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "no APK produced in $outDir" }

& node (Join-Path $root 'tools\verify-release-apk.js') $apk.FullName
if ($LASTEXITCODE -ne 0) { throw 'APK verification failed' }

# --- report ------------------------------------------------------------------

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  APK   $($apk.FullName)  ($([math]::Round($apk.Length/1MB,2)) MB)"
if ($Variant -eq 'release') {
    $aab = Get-ChildItem (Join-Path $android 'app\build\outputs\bundle\release') -Filter '*.aab' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($aab) { Write-Host "  AAB   $($aab.FullName)  ($([math]::Round($aab.Length/1MB,2)) MB)" }
}
Write-Host ''
Write-Host '  Still unverified without a physical device: the hardware back' -ForegroundColor Yellow
Write-Host '  button, camera capture, the gallery picker, file save/share, and' -ForegroundColor Yellow
Write-Host '  anything that touches the filesystem. Those are the paths this' -ForegroundColor Yellow
Write-Host '  build cannot exercise.' -ForegroundColor Yellow

# Proving the build actually finished is the harness's problem, not the
# build's, and the two are easy to confuse:
#
#   .\build-android.ps1 -Variant release | Select-Object -Last 45
#
# appears to hang forever, even after a successful build. gradlew exits but
# leaves a GradleDaemon running, and that daemon inherited this process's stdout
# handle. A pipe stays open until every write end is closed, so Select-Object
# never sees EOF and buffers nothing. Meanwhile the APK and AAB are sitting on
# disk, finished and correct.
#
# So: redirect to a file instead of piping when you need to capture the output.
#
#   .\build-android.ps1 -Variant release *> build.log
#   Get-Content build.log -Tail 45
#
# A build that really has failed exits non-zero and prints the reason, so treat
# a non-zero exit code as the failure signal, never the absence of output.

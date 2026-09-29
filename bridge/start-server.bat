@echo off
REM ===========================================================================
REM  AMAYA Local Server - Windows launcher
REM
REM  Serves the AMAYA ERP app on your local network and reads punches from
REM  the ZKTeco K40 / K50i terminals. Leave this window open while you use it.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo   AMAYA Local Server
echo   ======================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js is not installed or not on PATH.
  echo.
  echo       Install the LTS build from https://nodejs.org  then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "..\index.html" (
  echo   [!] The ERP app is missing at ..\index.html
  echo.
  echo       Build it first:
  echo           cd .. ^&^& build.ps1
  echo.
  pause
  exit /b 1
)

if not exist "devices.json" (
  echo   [i] No devices.json yet - starting with no terminals connected.
  echo       The ERP app will still run and be reachable on your network.
  echo       To add terminals later, run:  node find-devices.js
  echo.
  timeout /t 4 /nobreak >nul
)

echo   Starting. Leave this window open - press Ctrl+C to stop.
echo   ---------------------------------------------------------------
echo.

node bridge.js %*

echo.
echo   The server has stopped.
pause

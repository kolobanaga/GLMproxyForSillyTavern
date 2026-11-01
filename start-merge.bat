@echo off
rem ---------------------------------------------------------------------------
rem  GLM Proxy for AutoClaw - banner MERGED into the first system message
rem  Double-click this file for upstream's folded-banner behaviour.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title GLM Proxy - banner merged (upstream behaviour)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js was not found in PATH.
  echo.
  echo   Install Node.js 18 or newer, then run this file again:
  echo       https://nodejs.org/
  echo.
  pause
  exit /b 1
)

set "GLMP_BANNER_MODE=merge"

echo.
echo   GLM Proxy - banner MERGED
echo   ----------------------------------------------
echo   The vendor banner is folded into the first system
echo   message (upstream's behaviour) instead of riding as a
echo   system message of its own.
echo.
echo   Use this if your client needs the banner inside its
echo   own system text rather than beside it.
echo   Close this window to stop the proxy.
echo.

node openai.js

echo.
echo   Proxy stopped.
pause

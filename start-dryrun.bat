@echo off
rem ---------------------------------------------------------------------------
rem  GLM Proxy for AutoClaw - DRY RUN
rem  Double-click this file to capture requests without sending them.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title GLM Proxy - DRY RUN (nothing is sent upstream)

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

set "GLMP_DRY_RUN=1"

rem The request log (proxy_requests.json) keeps the shape of every request
rem (model, status, timing) but NOT the text of your last message. Set
rem GLMP_LOG_MESSAGES=1 to write last_message back into the log.
rem The dry-run dump (proxy_dryrun.json) is a different thing: it is the
rem whole captured request, text included - that is the point of the mode.
set "GLMP_LOG_MESSAGES=0"

echo.
echo   GLM Proxy - DRY RUN
echo   ----------------------------------------------
echo   Every request is captured to proxy_dryrun.json and
echo   answered locally. Nothing reaches the cloud, no credit
echo   is spent, no budget slot is used.
echo.
echo   Stop the proxy, then open proxy_dryrun.json - it is a
echo   JSON array, so the editor expands it as a tree.
echo   Close this window to stop the proxy.
echo.

node openai.js

echo.
echo   Proxy stopped.
pause

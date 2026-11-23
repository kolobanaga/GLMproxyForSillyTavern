@echo off
rem ---------------------------------------------------------------------------
rem  GLM Proxy for AutoClaw - SillyTavern profile
rem  Double-click this file to start the proxy. Close the window to stop it.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title GLM Proxy - AutoClaw (SillyTavern profile)

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

if defined PROXY_KEY (set "PROXY_KEY_SHOWN=%PROXY_KEY%") else (set "PROXY_KEY_SHOWN=mewmew")

rem The request log (proxy_requests.json) keeps the shape of every request
rem (model, status, timing) but NOT the text of your last message. Set
rem GLMP_LOG_MESSAGES=1 to write last_message back into the log.
set "GLMP_LOG_MESSAGES=0"

echo.
echo   GLM Proxy for AutoClaw - SillyTavern profile
echo   ----------------------------------------------
echo   Base URL : http://127.0.0.1:18791/v1
echo   API key  : %PROXY_KEY_SHOWN%
echo.
echo   SillyTavern: API type "Chat Completion", paste the URL above.
echo   Close this window to stop the proxy.
echo.

node openai.js

echo.
echo   Proxy stopped.
pause

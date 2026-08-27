@echo off
REM Local launcher. ASCII only on purpose: cmd.exe garbles Cyrillic in .bat files.
cd /d "%~dp0"

set PORT=8777

REM The browser is opened by serve.py itself, once the port actually answers.
REM Opening it from here started the browser before Python had finished booting,
REM and the first thing the user saw was a connection error.
python serve.py %PORT%

REM If python is missing, the window closes instantly. Keep it open to show why.
if errorlevel 1 (
  echo.
  echo   Could not start. Is Python installed and on PATH?
  echo.
  pause
)

@echo off
REM Local launcher. ASCII only on purpose: cmd.exe garbles Cyrillic in .bat files.
cd /d "%~dp0"

set PORT=8777

echo.
echo   Products-on-a-budget is starting...
echo.
echo   On this PC:      http://localhost:%PORT%/
echo   On your phone (same Wi-Fi), use one of these addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo       http://%%a:%PORT%/
echo.
echo   Keep this window open while you use the app. Press Ctrl+C to stop.
echo.

start "" http://localhost:%PORT%/
python -m http.server %PORT%

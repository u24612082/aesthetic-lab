@echo off
rem Windows launcher: installs on first run, then starts the app and opens your browser.
cd /d "%~dp0"
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 scripts\run.py %*
  goto :finish
)
where python >nul 2>nul
if %errorlevel%==0 (
  python scripts\run.py %*
  goto :finish
)
echo Python 3.11 or newer was not found.
echo Install it with:  winget install Python.Python.3.12
echo or from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then double-click this file again.
pause
exit /b 1
:finish
if errorlevel 1 pause

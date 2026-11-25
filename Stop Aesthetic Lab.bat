@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 scripts\run.py --stop) || (python scripts\run.py --stop)
pause

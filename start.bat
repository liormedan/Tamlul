@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo The program is not installed yet. Double-click install.bat first.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" app\desktop.py

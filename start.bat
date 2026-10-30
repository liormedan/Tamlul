@echo off
cd /d "%~dp0"
title Tamlul - keep this window open while working
if not exist ".venv\Scripts\python.exe" (
  echo The program is not installed yet. Double-click install.bat first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" app\server.py
if errorlevel 1 pause

@echo off
setlocal
cd /d "%~dp0"
title Tamlul - developer setup
echo ==========================================================
echo   Tamlul - developer setup (.venv and models in the repo)
echo   Users install Tamlul_x.y.z_x64-setup.exe instead.
echo   This downloads about 5 GB. It can take 15-40 minutes.
echo ==========================================================
echo.

set "PY="
py -3.11 -c "import sys" >nul 2>&1 && set "PY=py -3.11"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY (
  echo Python 3.11 was not found. Installing it now...
  winget install -e --id Python.Python.3.11 --scope user --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)
if not defined PY (
  echo.
  echo Could not install Python automatically.
  echo Please install Python 3.11 from https://www.python.org/downloads/release/python-3119/
  echo then run install.bat again.
  pause
  exit /b 1
)

echo.
echo [1/4] Creating a private Python environment...
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv || goto fail
set "VPY=.venv\Scripts\python.exe"
"%VPY%" -m pip install --upgrade pip >nul

echo.
echo [2/4] Installing PyTorch for the NVIDIA card (big download)...
"%VPY%" -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124 || goto fail

echo.
echo [3/4] Installing the transcription libraries...
"%VPY%" -m pip install -r requirements.txt || goto fail

echo.
echo [4/4] Downloading the models and testing the graphics card...
"%VPY%" app\setup_models.py || goto fail

echo.
echo ==========================================================
echo   Setup finished. Build and run the app:
echo     npm install
echo     cd src-tauri ^&^& cargo build
echo     src-tauri\target\debug\tamlul.exe
echo ==========================================================
pause
exit /b 0

:fail
echo.
echo **********************************************************
echo   Something went wrong (see the messages above).
echo   Take a screenshot of this window and send it to Claude.
echo **********************************************************
pause
exit /b 1

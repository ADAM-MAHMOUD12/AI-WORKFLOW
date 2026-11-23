@echo off
cd /d "%~dp0"

if not exist "apps\web\dist\index.html" (
  echo OpenCalque dependencies are missing. Reinstall AI TaskFlow to restore them.
  exit /b 1
)
if not defined TASKFLOW_PYTHON set "TASKFLOW_PYTHON=python.exe"
if not defined TASKFLOW_HOST set "TASKFLOW_HOST=127.0.0.1"
if not defined TASKFLOW_2D_PORT set "TASKFLOW_2D_PORT=5174"
"%TASKFLOW_PYTHON%" "%~dp0..\..\scripts\serve-spa.py" "%~dp0apps\web\dist" %TASKFLOW_HOST% %TASKFLOW_2D_PORT%

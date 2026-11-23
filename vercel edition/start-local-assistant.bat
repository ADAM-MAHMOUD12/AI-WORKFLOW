@echo off
setlocal
set "EDITION_ROOT=%~dp0"
set "APP_ROOT=%~dp0app"
cd /d "%APP_ROOT%"

if not exist "%APP_ROOT%\backend\.venv\Scripts\python.exe" (
  echo Run vercel edition\app\start-all.bat once to install the local TaskFlow backend first.
  pause
  exit /b 1
)

"%APP_ROOT%\backend\.venv\Scripts\python.exe" "%APP_ROOT%\scripts\initialize-backend.py"
if errorlevel 1 (
  echo Could not initialize the local TaskFlow assistant secret.
  pause
  exit /b 1
)

"%APP_ROOT%\backend\.venv\Scripts\python.exe" "%EDITION_ROOT%local_assistant.py"
if errorlevel 1 (
  echo The local assistant stopped with an error.
  pause
  exit /b 1
)

endlocal

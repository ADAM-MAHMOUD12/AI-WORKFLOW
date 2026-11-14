@echo off
setlocal EnableExtensions EnableDelayedExpansion
title OPENFILM-AI TASKFLOW EDITION - Launcher
cd /d "%~dp0"

set "TASKFLOW_PYTHON=%~dp0runtime\python\python.exe"
set "TASKFLOW_NODE=%~dp0runtime\node\node.exe"
set "TASKFLOW_BUN=%~dp0runtime\bun.exe"
if not exist "%TASKFLOW_PYTHON%" set "TASKFLOW_PYTHON="
if not exist "%TASKFLOW_NODE%" set "TASKFLOW_NODE=node.exe"
if not exist "%TASKFLOW_BUN%" set "TASKFLOW_BUN="
if defined TASKFLOW_NODE set "PATH=%~dp0runtime\node;%PATH%"

if not defined TASKFLOW_PYTHON if exist "backend\.venv\Scripts\python.exe" set "TASKFLOW_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
if not defined TASKFLOW_PYTHON if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python virtual environment...
  where py.exe >nul 2>nul
  if errorlevel 1 goto :python_missing
  py -3 -m venv "backend\.venv"
  if errorlevel 1 goto :python_error
)
if not defined TASKFLOW_PYTHON set "TASKFLOW_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
"%TASKFLOW_PYTHON%" -c "import cryptography, dotenv, fastapi, uvicorn, piper, faster_whisper" >nul 2>nul
if errorlevel 1 (
  set "INSTALL_DEPS="
  set /p "INSTALL_DEPS=Required Python libraries are missing. Download and install them now? [Y/N]: "
  if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
  echo Installing backend and speech libraries through CMD...
  "%TASKFLOW_PYTHON%" -m pip install -r "backend\requirements.txt"
  if errorlevel 1 goto :python_error
  "%TASKFLOW_PYTHON%" -c "import cryptography, dotenv, fastapi, uvicorn, piper, faster_whisper" >nul 2>nul
  if errorlevel 1 goto :python_error
)
"%TASKFLOW_PYTHON%" "scripts\initialize-backend.py"
if errorlevel 1 goto :python_error

set "LOCAL_ONLY=1"
set "ENGINE_2D=1"
set "ENGINE_3D=1"
set "ENGINE_OPENFILM=1"
set "TASKFLOW_API_PORT=8000"
set "TASKFLOW_FRONTEND_PORT=5173"
set "TASKFLOW_3D_PORT=3002"
set "TASKFLOW_2D_PORT=5174"
set "TASKFLOW_CONFIG=%TEMP%\AI-TaskFlow-%RANDOM%-%RANDOM%.txt"
"%TASKFLOW_PYTHON%" "scripts\launcher-config.py" > "%TASKFLOW_CONFIG%"
if errorlevel 1 goto :python_error
for /f "usebackq tokens=1-4 delims=|" %%A in ("%TASKFLOW_CONFIG%") do (
  set "LOCAL_ONLY=%%A"
  set "ENGINE_2D=%%B"
  set "ENGINE_3D=%%C"
  set "ENGINE_OPENFILM=%%D"
)
del /q "%TASKFLOW_CONFIG%" >nul 2>nul
if not defined LOCAL_ONLY goto :python_error
if not defined ENGINE_2D goto :python_error
if not defined ENGINE_3D goto :python_error
if not defined ENGINE_OPENFILM goto :python_error

"%TASKFLOW_NODE%" -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=2)?0:1)" >nul 2>nul
if errorlevel 1 goto :node_error

if not exist "node_modules\vite\bin\vite.js" (
  if exist "runtime\node\node.exe" goto :node_error
  set "INSTALL_DEPS="
  set /p "INSTALL_DEPS=Frontend dependencies are missing. Download and install them now? [Y/N]: "
  if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
  echo Installing AI TaskFlow JavaScript dependencies...
  call npm.cmd ci
  if errorlevel 1 goto :node_error
)
if not exist "dist\index.html" (
  echo Building AI TaskFlow for production...
  call npm.cmd run build
  if errorlevel 1 goto :node_error
)
call "%TASKFLOW_NODE%" scripts\patch-openfilm.mjs
if errorlevel 1 goto :node_error
if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\node_modules" (
  if exist "vendor\aedifex\bun.lock" (
    set "INSTALL_DEPS="
    set /p "INSTALL_DEPS=AI TaskFlow 3D dependencies are missing. Download and install them now? [Y/N]: "
    if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
    echo Installing AI TaskFlow 3D engine dependencies...
    pushd "vendor\aedifex"
    if exist "%TASKFLOW_BUN%" (
      "%TASKFLOW_BUN%" install --frozen-lockfile
    ) else (
      call bun.cmd install --frozen-lockfile
    )
    if errorlevel 1 (
      popd
      goto :bun_error
    )
    popd
  )
)
if "%ENGINE_2D%"=="1" if not exist "vendor\opencalque\apps\web\dist\index.html" (
  set "INSTALL_DEPS="
  set /p "INSTALL_DEPS=OpenCalque 2D build/dependencies are missing. Download dependencies and build the editor now? [Y/N]: "
  if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
  pushd "vendor\opencalque"
  call npm.cmd exec --yes --package=pnpm@9.14.2 -- pnpm install --frozen-lockfile
  if errorlevel 1 (
    popd
    goto :opencalque_error
  )
  call npm.cmd exec --yes --package=pnpm@9.14.2 -- pnpm --filter @opencalque/web build
  if errorlevel 1 (
    popd
    goto :opencalque_error
  )
  popd
  if not exist "vendor\opencalque\apps\web\dist\index.html" goto :opencalque_error
)

if /I "%~1"=="--install-only" (
  echo AI TaskFlow and enabled engine dependencies are ready.
  exit /b 0
)

set "TASKFLOW_RUNTIME_CONFIG=%TEMP%\AI-TaskFlow-ports-%RANDOM%-%RANDOM%.txt"
"%TASKFLOW_PYTHON%" "scripts\runtime-config.py" discover > "%TASKFLOW_RUNTIME_CONFIG%"
if errorlevel 1 goto :port_error
for /f "usebackq tokens=1-5 delims=|" %%A in ("%TASKFLOW_RUNTIME_CONFIG%") do (
  set "TASKFLOW_API_PORT=%%A"
  set "TASKFLOW_FRONTEND_PORT=%%B"
  set "TASKFLOW_3D_PORT=%%C"
  set "TASKFLOW_2D_PORT=%%D"
  set "TASKFLOW_LAN_IP=%%E"
)
del /q "%TASKFLOW_RUNTIME_CONFIG%" >nul 2>nul
if not defined TASKFLOW_API_PORT goto :port_error
"%TASKFLOW_PYTHON%" "scripts\runtime-config.py" write %TASKFLOW_API_PORT% %TASKFLOW_FRONTEND_PORT% %TASKFLOW_3D_PORT% %TASKFLOW_2D_PORT%
if errorlevel 1 goto :port_error

set "TASKFLOW_HOST=127.0.0.1"
set "TASKFLOW_URL=http://127.0.0.1:%TASKFLOW_FRONTEND_PORT%"
if "%LOCAL_ONLY%"=="0" (
  set "TASKFLOW_HOST=0.0.0.0"
  if defined TASKFLOW_LAN_IP set "TASKFLOW_URL=http://%TASKFLOW_LAN_IP%:%TASKFLOW_FRONTEND_PORT%"
)
if "%LOCAL_ONLY%"=="1" set "TASKFLOW_LAN_IP=127.0.0.1"
if not defined TASKFLOW_LAN_IP set "TASKFLOW_LAN_IP=127.0.0.1"
set "OPENFILM_ADVERTISED_HOST=%TASKFLOW_LAN_IP%"

echo ========================================================
echo     OPENFILM-AI TASKFLOW EDITION - Local Services
echo ========================================================
echo Access URL: %TASKFLOW_URL%
if "%LOCAL_ONLY%"=="1" echo Network access is disabled. Change the host setting in the administrator settings to share this service.
echo Host binding: %TASKFLOW_HOST%
echo Ports: API=%TASKFLOW_API_PORT% Web=%TASKFLOW_FRONTEND_PORT% 3D=%TASKFLOW_3D_PORT% 2D=%TASKFLOW_2D_PORT%
echo.

start "AI TaskFlow - Backend" /D "%~dp0backend" cmd /k "set OPENFILM_HOST=%TASKFLOW_HOST% && set OPENFILM_ADVERTISED_HOST=%OPENFILM_ADVERTISED_HOST% && set OPENFILM_NO_UPDATE_CHECK=1 && set TASKFLOW_API_PORT=%TASKFLOW_API_PORT% && set AEDIFEX_URL=http://127.0.0.1:%TASKFLOW_3D_PORT%/api/scenes && ""%TASKFLOW_PYTHON%"" -m uvicorn main:app --host %TASKFLOW_HOST% --port %TASKFLOW_API_PORT%"

echo Waiting for the backend to become ready...
set "BACKEND_READY="
for /L %%I in (1,1,30) do (
  "%TASKFLOW_PYTHON%" -c "import json,urllib.request; status=json.load(urllib.request.urlopen('http://127.0.0.1:%TASKFLOW_API_PORT%/api/auth/status',timeout=2)); assert 'account_count' in status" >nul 2>nul
  if not errorlevel 1 set "BACKEND_READY=1"
  if defined BACKEND_READY goto :backend_ready
  timeout /t 1 /nobreak >nul
)
:backend_ready
if not defined BACKEND_READY goto :backend_start_error
echo Backend is ready.

if "%ENGINE_3D%"=="1" (
  if exist "vendor\aedifex\apps\editor\package.json" (
    if exist "%TASKFLOW_BUN%" (
      start "AI TaskFlow - 3D Engine" /D "%~dp0vendor\aedifex\apps\editor" cmd /k "set AEDIFEX_SCENE_API_ALLOW_LOOPBACK_WITHOUT_TOKEN=1 && ""%TASKFLOW_BUN%"" run start -- --hostname %TASKFLOW_HOST% --port %TASKFLOW_3D_PORT%"
    ) else (
      start "AI TaskFlow - 3D Engine" /D "%~dp0vendor\aedifex\apps\editor" cmd /k "set AEDIFEX_SCENE_API_ALLOW_LOOPBACK_WITHOUT_TOKEN=1 && bun.cmd run start -- --hostname %TASKFLOW_HOST% --port %TASKFLOW_3D_PORT%"
    )
  )
) else echo AI TaskFlow 3D engine is disabled in settings.

if "%ENGINE_2D%"=="1" (
  if exist "vendor\opencalque\start-editor.bat" start "AI TaskFlow - 2D Editor" /D "%~dp0vendor\opencalque" cmd /k "set TASKFLOW_2D_PORT=%TASKFLOW_2D_PORT% && call start-editor.bat"
) else echo OpenCalque 2D engine is disabled in settings.

start "AI TaskFlow - Frontend" /D "%~dp0" cmd /k "call ""%TASKFLOW_NODE%"" node_modules\vite\bin\vite.js preview --host %TASKFLOW_HOST% --port %TASKFLOW_FRONTEND_PORT%"

echo.
echo Services launched. Enabled engines: 2D=%ENGINE_2D% 3D=%ENGINE_3D% OpenFilm=%ENGINE_OPENFILM%
echo Open %TASKFLOW_URL% after the service windows finish starting.
echo Restart this launcher after changing network or engine settings.
echo.
pause
exit /b 0

:python_error
if defined TASKFLOW_CONFIG if exist "%TASKFLOW_CONFIG%" del /q "%TASKFLOW_CONFIG%" >nul 2>nul
echo Bundled Python is missing or its backend libraries are incomplete.
echo Reinstall AI TaskFlow or run scripts\install-prerequisites.bat.
pause
exit /b 1

:python_missing
echo Python 3.12 or later is required to prepare a source checkout.
set "OPEN_PYTHON_DOWNLOAD="
set /p "OPEN_PYTHON_DOWNLOAD=Open the official Python downloads page? [Y/N]: "
if /I "%OPEN_PYTHON_DOWNLOAD%"=="Y" start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:backend_start_error
echo The backend did not become ready within 30 seconds.
echo Check the "AI TaskFlow - Backend" window for the startup error.
echo Confirm that port 8000 is not already in use, then run start-all.bat again.
pause
exit /b 1

:node_error
echo Node.js 22.2 or later with npm is required.
set "OPEN_NODE_DOWNLOAD="
set /p "OPEN_NODE_DOWNLOAD=Open the official Node.js downloads page? [Y/N]: "
if /I "%OPEN_NODE_DOWNLOAD%"=="Y" start "" "https://nodejs.org/en/download"
pause
exit /b 1

:bun_error
echo Bun is required to install or run the 3D engine.
pause
exit /b 1

:opencalque_error
echo OpenCalque 2D dependencies or build are unavailable or incomplete.
echo Check the network and Node.js/npm, then run start-all.bat again.
pause
exit /b 1

:port_error
if defined TASKFLOW_RUNTIME_CONFIG if exist "%TASKFLOW_RUNTIME_CONFIG%" del /q "%TASKFLOW_RUNTIME_CONFIG%" >nul 2>nul
echo Could not find available service ports or write the runtime configuration.
echo Close unused local services and run start-all.bat again.
pause
exit /b 1

:install_declined
echo Dependency installation was cancelled. No application files were changed.
pause
exit /b 1

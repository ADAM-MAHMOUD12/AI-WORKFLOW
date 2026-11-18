@echo off
setlocal EnableExtensions EnableDelayedExpansion
title OPENFILM-AI TASKFLOW EDITION - Launcher
set "TASKFLOW_BATCH_PATH=%~f0"
set "TASKFLOW_WORKING_DIR=%~dp0"
set "TASKFLOW_LAUNCH_ARGUMENTS=%*"
powershell.exe -NoProfile -Command "if ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :admin_ready
echo Requesting Administrator permission through Windows UAC...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:TASKFLOW_BATCH_PATH -ArgumentList $env:TASKFLOW_LAUNCH_ARGUMENTS -Verb RunAs -WorkingDirectory $env:TASKFLOW_WORKING_DIR"
if errorlevel 1 (
  echo Administrator permission was not granted. AI TaskFlow startup was cancelled.
  pause
  exit /b 1
)
exit /b 0

:admin_ready
cd /d "%~dp0"

set "TASKFLOW_PYTHON=%~dp0runtime\python\python.exe"
set "TASKFLOW_NODE=%~dp0runtime\node\node.exe"
set "TASKFLOW_BUN=%~dp0runtime\bun.exe"
if not exist "%TASKFLOW_PYTHON%" set "TASKFLOW_PYTHON="
if not exist "%TASKFLOW_NODE%" set "TASKFLOW_NODE=node.exe"
if not exist "%TASKFLOW_BUN%" set "TASKFLOW_BUN="
if defined TASKFLOW_NODE set "PATH=%~dp0runtime\node;%PATH%"
if not defined TASKFLOW_BUN (
  for %%B in (bun.cmd) do if not defined TASKFLOW_BUN_SHIM set "TASKFLOW_BUN_SHIM=%%~$PATH:B"
  if defined TASKFLOW_BUN_SHIM (
    for %%B in ("!TASKFLOW_BUN_SHIM!") do set "TASKFLOW_BUN_NPM_DIR=%%~dpB"
    if exist "!TASKFLOW_BUN_NPM_DIR!node_modules\bun\bin\bun.exe" set "TASKFLOW_BUN=!TASKFLOW_BUN_NPM_DIR!node_modules\bun\bin\bun.exe"
  )
)

if not defined TASKFLOW_PYTHON if exist "backend\.venv\Scripts\python.exe" set "TASKFLOW_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
if not defined TASKFLOW_PYTHON if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python virtual environment...
  where py.exe >nul 2>nul
  if errorlevel 1 goto :python_missing
  py -3 -m venv "backend\.venv"
  if errorlevel 1 goto :python_error
)
if not defined TASKFLOW_PYTHON set "TASKFLOW_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
if not exist "%TASKFLOW_PYTHON%" goto :python_missing
"%TASKFLOW_PYTHON%" -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 goto :python_missing
"%TASKFLOW_PYTHON%" -c "import cryptography, dotenv, fastapi, uvicorn, piper, faster_whisper, huggingface_hub, numpy, onnxruntime, PIL, transformers, tqdm" >nul 2>nul
if errorlevel 1 (
  set "INSTALL_DEPS="
  set /p "INSTALL_DEPS=Required Python libraries are missing. Download and install them now? [Y/N]: "
  if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
  echo Installing backend and speech libraries through CMD...
  "%TASKFLOW_PYTHON%" -m pip install -r "backend\requirements.txt"
  if errorlevel 1 goto :python_error
  "%TASKFLOW_PYTHON%" -c "import cryptography, dotenv, fastapi, uvicorn, piper, faster_whisper, huggingface_hub, numpy, onnxruntime, PIL, transformers, tqdm" >nul 2>nul
  if errorlevel 1 goto :python_error
)
"%TASKFLOW_PYTHON%" -X utf8 "scripts\initialize-backend.py"
if errorlevel 1 goto :python_error

set "LOCAL_ONLY=1"
set "ENGINE_2D=1"
set "ENGINE_3D=1"
set "ENGINE_OPENFILM=1"
set "TASKFLOW_API_PORT=8000"
set "TASKFLOW_FRONTEND_PORT=5173"
set "TASKFLOW_3D_PORT=3002"
set "TASKFLOW_2D_PORT=5174"
set "TASKFLOW_IDE_PORT=3102"
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

"%TASKFLOW_NODE%" -e "const [major]=process.versions.node.split('.').map(Number);process.exit(major>=24?0:1)" >nul 2>nul
if errorlevel 1 goto :node_error
where npm.cmd >nul 2>nul
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
echo Building AI TaskFlow from the current source...
call npm.cmd run build
if errorlevel 1 goto :node_error
call "%TASKFLOW_NODE%" scripts\patch-openfilm.mjs
if errorlevel 1 goto :node_error

if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\apps\editor\package.json" (
  set "INSTALL_ENGINE="
  set /p "INSTALL_ENGINE=AI TaskFlow 3D engine source is missing. Download and initialize it now? [Y/N]: "
  if /I not "!INSTALL_ENGINE!"=="Y" goto :install_declined
  where git.exe >nul 2>nul
  if errorlevel 1 (
    set "INSTALL_GIT="
    set /p "INSTALL_GIT=Git is missing. Install Git with winget to download the 3D engine? [Y/N]: "
    if /I not "!INSTALL_GIT!"=="Y" goto :install_declined
    where winget.exe >nul 2>nul
    if errorlevel 1 (
      echo winget is unavailable. Opening the official Git download page.
      start "" "https://git-scm.com/download/win"
      goto :install_declined
    )
    call winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :git_error
    echo Git was installed. Restarting start-all.bat to refresh PATH.
    start "" "%ComSpec%" /c call "%~f0" %*
    exit /b 0
  )
  echo Downloading the configured 3D engine source...
  git submodule update --init --recursive vendor\aedifex
  if errorlevel 1 goto :git_error
)
if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\apps\editor\package.json" (
  echo 3D engine source is still missing after setup.
  goto :engine3d_error
)
if "%ENGINE_3D%"=="1" (
  where bun.cmd >nul 2>nul
  if errorlevel 1 if not exist "%TASKFLOW_BUN%" (
    set "INSTALL_BUN="
    set /p "INSTALL_BUN=Bun is missing. Install it globally with npm to run the 3D engine? [Y/N]: "
    if /I not "!INSTALL_BUN!"=="Y" goto :install_declined
    call npm.cmd install --global bun
    if errorlevel 1 goto :bun_error
    echo Bun was installed. Restarting start-all.bat to refresh PATH.
    start "" "%ComSpec%" /c call "%~f0" %*
    exit /b 0
  )
)
if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\node_modules" (
  set "INSTALL_DEPS="
  set /p "INSTALL_DEPS=AI TaskFlow 3D dependencies are missing. Download and install them now? [Y/N]: "
  if /I not "!INSTALL_DEPS!"=="Y" goto :install_declined
  echo Installing AI TaskFlow 3D engine dependencies...
  pushd "vendor\aedifex"
  if exist "bun.lock" (
    if exist "%TASKFLOW_BUN%" (
      "%TASKFLOW_BUN%" install --frozen-lockfile
    ) else (
      call bun.cmd install --frozen-lockfile
    )
  ) else if exist "bun.lockb" (
    if exist "%TASKFLOW_BUN%" (
      "%TASKFLOW_BUN%" install --frozen-lockfile
    ) else (
      call bun.cmd install --frozen-lockfile
    )
  ) else (
    if exist "%TASKFLOW_BUN%" (
      "%TASKFLOW_BUN%" install
    ) else (
      call bun.cmd install
    )
  )
  if errorlevel 1 (
    popd
    goto :bun_error
  )
  popd
  if not exist "vendor\aedifex\node_modules" goto :bun_error
)
if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\apps\editor\.next\BUILD_ID" (
  echo Building AI TaskFlow 3D and its workspace packages...
  pushd "vendor\aedifex"
  call bun.cmd run turbo run build --filter=./apps/editor... --concurrency=1
  if errorlevel 1 (
    popd
    goto :engine3d_error
  )
  popd
)
if "%ENGINE_3D%"=="1" if not exist "vendor\aedifex\apps\editor\.next\BUILD_ID" goto :engine3d_error
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

if not exist "theia-app\node_modules\@theia\cli\package.json" (
  set "INSTALL_THEIA="
  set /p "INSTALL_THEIA=Eclipse Theia IDE dependencies are missing. Download and install them now? [Y/N]: "
  if /I not "!INSTALL_THEIA!"=="Y" goto :install_declined
  echo Installing Eclipse Theia IDE dependencies...
  call npm.cmd --prefix "theia-app" ci --ignore-scripts
  if errorlevel 1 goto :theia_error
)
if not exist "theia-app\node_modules\@vscode\windows-ca-certs\build\Release\crypt32.node" goto :theia_native_setup
if not exist "theia-app\node_modules\drivelist\build\Release\drivelist.node" if not exist "theia-app\node_modules\@theia\core\node_modules\drivelist\build\Release\drivelist.node" goto :theia_native_setup
:theia_build
if not exist "theia-app\src-gen\backend\main.js" (
  echo Building the AI TaskFlow Eclipse Theia IDE...
  call npm.cmd --prefix "theia-app" run build
  if errorlevel 1 goto :theia_error
)
if not exist "theia-app\src-gen\backend\main.js" goto :theia_error
goto :theia_ready

:theia_native_setup
set "TASKFLOW_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "TASKFLOW_VS_INSTALL="
if exist "%TASKFLOW_VSWHERE%" (
  for /f "usebackq delims=" %%V in (`"%TASKFLOW_VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "TASKFLOW_VS_INSTALL=%%V"
)
if not defined TASKFLOW_VS_INSTALL if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "TASKFLOW_VS_INSTALL=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
if defined TASKFLOW_VS_INSTALL (
  set "TASKFLOW_VS_SPECTRE="
  for /d %%V in ("!TASKFLOW_VS_INSTALL!\VC\Tools\MSVC\*") do if exist "%%V\lib\spectre\x64" set "TASKFLOW_VS_SPECTRE=1"
  if not defined TASKFLOW_VS_SPECTRE (
    set "INSTALL_THEIA_SPECTRE="
    set /p "INSTALL_THEIA_SPECTRE=Theia's Windows compiler needs the MSVC Spectre libraries. Install this Visual Studio component now? [Y/N]: "
    if /I not "!INSTALL_THEIA_SPECTRE!"=="Y" goto :install_declined
    call "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\setup.exe" modify --installPath "%TASKFLOW_VS_INSTALL%" --add Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre --quiet --norestart
    if errorlevel 1 goto :theia_native_error
    echo MSVC Spectre libraries were installed. Restarting start-all.bat.
    start "" "%ComSpec%" /c call "%~f0" %*
    exit /b 0
  )
  echo Building required native modules for Eclipse Theia...
  set "TrackFileAccess=false"
  set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
  call npm.cmd --prefix "theia-app" rebuild
  if errorlevel 1 goto :theia_native_error
  if not exist "theia-app\node_modules\@vscode\windows-ca-certs\build\Release\crypt32.node" goto :theia_native_error
  if not exist "theia-app\node_modules\drivelist\build\Release\drivelist.node" if not exist "theia-app\node_modules\@theia\core\node_modules\drivelist\build\Release\drivelist.node" goto :theia_native_error
  goto :theia_build
)
set "INSTALL_THEIA_BUILD_TOOLS="
set /p "INSTALL_THEIA_BUILD_TOOLS=Eclipse Theia needs the Visual C++ build tools to compile Windows components. Install them now with WinGet? (several GB) [Y/N]: "
if /I not "!INSTALL_THEIA_BUILD_TOOLS!"=="Y" goto :install_declined
where winget.exe >nul 2>nul
if errorlevel 1 (
  echo WinGet is unavailable. Opening the official Visual C++ Build Tools download page.
  start "" "https://visualstudio.microsoft.com/visual-cpp-build-tools/"
  goto :install_declined
)
call winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-package-agreements --accept-source-agreements --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre --includeRecommended"
if errorlevel 1 goto :theia_native_error
echo Visual C++ Build Tools were installed. Restarting start-all.bat to compile Theia's native modules.
start "" "%ComSpec%" /c call "%~f0" %*
exit /b 0

:theia_ready

if /I "%~1"=="--install-only" (
  echo AI TaskFlow and enabled engine dependencies are ready.
  exit /b 0
)

:runtime_services
set "TASKFLOW_RUNTIME_CONFIG=%TEMP%\AI-TaskFlow-ports-%RANDOM%-%RANDOM%.txt"
"%TASKFLOW_PYTHON%" "scripts\runtime-config.py" discover > "%TASKFLOW_RUNTIME_CONFIG%"
if errorlevel 1 goto :port_error
for /f "usebackq tokens=1-6 delims=|" %%A in ("%TASKFLOW_RUNTIME_CONFIG%") do (
  set "TASKFLOW_API_PORT=%%A"
  set "TASKFLOW_FRONTEND_PORT=%%B"
  set "TASKFLOW_3D_PORT=%%C"
  set "TASKFLOW_2D_PORT=%%D"
  set "TASKFLOW_IDE_PORT=%%E"
  set "TASKFLOW_LAN_IP=%%F"
)
del /q "%TASKFLOW_RUNTIME_CONFIG%" >nul 2>nul
if not defined TASKFLOW_API_PORT goto :port_error
"%TASKFLOW_PYTHON%" "scripts\runtime-config.py" write %TASKFLOW_API_PORT% %TASKFLOW_FRONTEND_PORT% %TASKFLOW_3D_PORT% %TASKFLOW_2D_PORT% %TASKFLOW_IDE_PORT%
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
echo Ports: API=%TASKFLOW_API_PORT% Web=%TASKFLOW_FRONTEND_PORT% 3D=%TASKFLOW_3D_PORT% 2D=%TASKFLOW_2D_PORT% IDE=%TASKFLOW_IDE_PORT%
echo Warning: programming terminal commands run with Administrator privileges and still require confirmation.
echo.

set "OPENFILM_HOST=%TASKFLOW_HOST%"
set "OPENFILM_ADVERTISED_HOST=%TASKFLOW_LAN_IP%"
set "OPENFILM_NO_UPDATE_CHECK=1"
start "AI TaskFlow - Backend" /B /D "%~dp0backend" "%TASKFLOW_PYTHON%" -X utf8 -m uvicorn main:app --host %TASKFLOW_HOST% --port %TASKFLOW_API_PORT%

echo Waiting for the backend to become ready...
set "BACKEND_READY="
for /L %%I in (1,1,30) do (
  "%TASKFLOW_PYTHON%" -c "import json,urllib.request; base='http://127.0.0.1:%TASKFLOW_API_PORT%'; status=json.load(urllib.request.urlopen(base+'/api/auth/status',timeout=2)); spec=json.load(urllib.request.urlopen(base+'/openapi.json',timeout=2)); assert 'account_count' in status and '/api/skills/library/search' in spec.get('paths',{})" >nul 2>nul
  if not errorlevel 1 set "BACKEND_READY=1"
  if defined BACKEND_READY goto :backend_ready
  timeout /t 1 /nobreak >nul
)
:backend_ready
if not defined BACKEND_READY goto :backend_start_error
echo Backend is ready.

if "%ENGINE_3D%"=="1" (
  if exist "vendor\aedifex\apps\editor\package.json" (
    set "AEDIFEX_SCENE_API_ALLOW_LOOPBACK_WITHOUT_TOKEN=1"
    start "AI TaskFlow - 3D Engine" /B /D "%~dp0vendor\aedifex\apps\editor" "%TASKFLOW_BUN%" run start -- --hostname %TASKFLOW_HOST% --port %TASKFLOW_3D_PORT%
  )
) else echo AI TaskFlow 3D engine is disabled in settings.
if "%ENGINE_3D%"=="1" (
  echo Waiting for AI TaskFlow 3D...
  "%TASKFLOW_PYTHON%" "scripts\wait-for-http.py" "http://127.0.0.1:%TASKFLOW_3D_PORT%/api/health" --timeout 60
  if errorlevel 1 goto :engine3d_start_error
  echo AI TaskFlow 3D is ready.
)

if "%ENGINE_2D%"=="1" (
  if exist "vendor\opencalque\start-editor.bat" (
    start "AI TaskFlow - 2D Editor" /B /D "%~dp0vendor\opencalque" "%TASKFLOW_PYTHON%" -X utf8 "%~dp0scripts\serve-spa.py" "%~dp0vendor\opencalque\apps\web\dist" %TASKFLOW_HOST% %TASKFLOW_2D_PORT%
    echo Waiting for OpenCalque 2D...
    "%TASKFLOW_PYTHON%" "scripts\wait-for-http.py" "http://127.0.0.1:%TASKFLOW_2D_PORT%/index.html" --timeout 45
    if errorlevel 1 goto :opencalque_start_error
    echo OpenCalque 2D is ready.
  ) else goto :opencalque_error
) else echo OpenCalque 2D engine is disabled in settings.

echo Starting the local Eclipse Theia IDE on 127.0.0.1:%TASKFLOW_IDE_PORT%...
start "AI TaskFlow - Eclipse Theia IDE" /B /D "%~dp0theia-app" "%ComSpec%" /d /s /c "call npm.cmd run start -- --hostname=127.0.0.1 --port=%TASKFLOW_IDE_PORT%"
echo Waiting for Eclipse Theia...
"%TASKFLOW_PYTHON%" "scripts\wait-for-http.py" "http://127.0.0.1:%TASKFLOW_IDE_PORT%/" --timeout 120
if errorlevel 1 goto :theia_start_error
echo Eclipse Theia IDE is ready.

start "AI TaskFlow - Frontend" /B /D "%~dp0" "%ComSpec%" /d /s /c ""%TASKFLOW_NODE%" "%~dp0node_modules\vite\bin\vite.js" preview --host %TASKFLOW_HOST% --port %TASKFLOW_FRONTEND_PORT%"
echo Waiting for the AI TaskFlow page...
"%TASKFLOW_PYTHON%" "scripts\wait-for-http.py" "http://127.0.0.1:%TASKFLOW_FRONTEND_PORT%/" --timeout 45
if errorlevel 1 goto :frontend_start_error

echo.
echo Services launched. Enabled engines: 2D=%ENGINE_2D% 3D=%ENGINE_3D% OpenFilm=%ENGINE_OPENFILM%
echo Opening the ready application at %TASKFLOW_URL%
echo Restart this launcher after changing network or engine settings.
echo.
start "" "%TASKFLOW_URL%"
pause
exit /b 0

:python_error
if defined TASKFLOW_CONFIG if exist "%TASKFLOW_CONFIG%" del /q "%TASKFLOW_CONFIG%" >nul 2>nul
echo Bundled Python is missing or its backend libraries are incomplete.
echo Reinstall AI TaskFlow or run scripts\install-prerequisites.bat.
pause
exit /b 1

:theia_error
echo Eclipse Theia dependencies or build are unavailable or incomplete.
echo Check the npm output and Node.js version, then run start-all.bat again.
pause
exit /b 1

:theia_native_error
echo Eclipse Theia's Windows native modules could not be built.
echo Install or repair Visual Studio Build Tools with the Desktop development with C++ workload, then retry.
pause
exit /b 1

:theia_start_error
echo Eclipse Theia did not become ready. Check the "AI TaskFlow - Eclipse Theia IDE" window.
echo Confirm that port %TASKFLOW_IDE_PORT% is available, then run start-all.bat again.
pause
exit /b 1

:node_install_error
echo Node.js installation failed. Check WinGet output and try again.
pause
exit /b 1

:python_missing
echo Python 3.10 or later is required to prepare a source checkout.
set "INSTALL_PYTHON="
set /p "INSTALL_PYTHON=Install Python 3.12 with winget now? [Y/N]: "
if /I "!INSTALL_PYTHON!"=="Y" (
  where winget.exe >nul 2>nul
  if errorlevel 1 (
    echo winget is unavailable. Opening the official Python download page.
    start "" "https://www.python.org/downloads/windows/"
  ) else (
    call winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :python_error
    echo Python was installed. Restarting start-all.bat to refresh PATH.
    start "" "%ComSpec%" /c call "%~f0" %*
    exit /b 0
  )
)
pause
exit /b 1

:backend_start_error
echo The backend did not become ready within 30 seconds.
echo Check the "AI TaskFlow - Backend" window for the startup error.
echo Confirm that API port %TASKFLOW_API_PORT% is available, then run start-all.bat again.
pause
exit /b 1

:node_error
echo Node.js 24 or later with npm is required by Eclipse Theia.
set "INSTALL_NODE="
set /p "INSTALL_NODE=Install Node.js LTS with winget now? [Y/N]: "
if /I "!INSTALL_NODE!"=="Y" (
  where winget.exe >nul 2>nul
  if errorlevel 1 (
    echo winget is unavailable. Opening the official Node.js download page.
    start "" "https://nodejs.org/en/download"
  ) else (
    call winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :node_install_error
    echo Node.js was installed. Restarting start-all.bat to refresh PATH.
    start "" "%ComSpec%" /c call "%~f0" %*
    exit /b 0
  )
)
pause
exit /b 1

:bun_error
echo Bun could not install the 3D engine dependencies.
echo Check the network and Bun output, then run start-all.bat again.
pause
exit /b 1

:engine3d_error
echo The enabled 3D engine is incomplete and cannot be started.
echo Check the Git and Bun output, then run start-all.bat again.
pause
exit /b 1

:opencalque_error
echo OpenCalque 2D dependencies or build are unavailable or incomplete.
echo Check the network and Node.js/npm, then run start-all.bat again.
pause
exit /b 1

:engine3d_start_error
echo AI TaskFlow 3D did not become ready. Check its service window.
echo The application will not be opened with a broken engine connection.
pause
exit /b 1

:opencalque_start_error
echo OpenCalque did not become ready. Check the "AI TaskFlow - 2D Editor" window.
echo The application will not be opened with a broken editor connection.
pause
exit /b 1

:frontend_start_error
echo The AI TaskFlow page did not become ready. Check the frontend service window.
pause
exit /b 1

:git_error
echo Git installation or 3D engine download failed. Startup was cancelled.
pause
exit /b 1


:port_error
if defined TASKFLOW_RUNTIME_CONFIG if exist "%TASKFLOW_RUNTIME_CONFIG%" del /q "%TASKFLOW_RUNTIME_CONFIG%" >nul 2>nul
echo Could not find available service ports or write the runtime configuration.
echo Close unused local services and run start-all.bat again.
pause
exit /b 1

:install_declined
echo Startup was cancelled because a required runtime or enabled engine was declined.
pause
exit /b 1

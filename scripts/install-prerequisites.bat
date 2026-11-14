@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
echo AI TaskFlow checks required runtimes and asks before downloading missing dependencies.
echo This setup uses Command Prompt and does not require PowerShell execution permissions.
call "%~dp0..\start-all.bat" --install-only
exit /b %errorlevel%

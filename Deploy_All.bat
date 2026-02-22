@echo off
setlocal enabledelayedexpansion
REM Push to GitHub, pull on VPS, build web app, deploy to live site.
REM You will be prompted for: commit message (or skip), GitHub credentials if needed, SSH passphrase if needed.
cd /d "%~dp0"
echo.
echo === Deploy_All: Push to Git, pull on VPS, deploy web app ===
echo.

set KEY=%USERPROFILE%\.ssh\contabo_nikola
set HOST=nikola@207.180.222.248
set BRANCH=master

REM No ControlMaster - Windows OpenSSH often fails with "getsockname failed: Not a socket".
REM You may be prompted for SSH passphrase for pull, scp, and deploy (or once if using ssh-agent).

REM --- Check SSH key exists ---
if not exist "%KEY%" (
    echo SSH key not found: %KEY%
    echo Put your key there or edit KEY in this script. The same key must be in VPS ~/.ssh/authorized_keys.
    pause
    exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
    echo Git not found.
    pause
    exit /b 1
)

REM Optional: try to load SSH key from Credential Manager (no passphrase prompt later)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Load-VpsSshKey.ps1" 2>nul

REM Commit message: first argument, or prompt, or default
set MSG=%~1
if "%MSG%"=="" (
    echo.
    set /p MSG="Commit message (or press Enter for default): "
    if "!MSG!"=="" set "MSG=Deploy %date% %time%"
)
if "%MSG%"=="" set "MSG=Deploy %date% %time%"

echo.
echo [1/5] Push to GitHub
echo You may be prompted for GitHub username/password or token if needed.
echo.
git add -A
git status -sb
git commit -m "%MSG%" 2>nul
if errorlevel 1 (
    echo Nothing to commit or commit skipped. Continuing with push...
) else (
    echo Committed.
)
git push
if errorlevel 1 (
    echo Git push failed. Fix credentials or branch and run again.
    pause
    exit /b 1
)
echo Git push done.

echo.
echo [2/5] Pull on VPS - you may be prompted for SSH passphrase
ssh -i "%KEY%" -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 %HOST% "cd ~/RouteCopilot2 && git pull origin %BRANCH%"
if errorlevel 1 (
    echo Pull on VPS failed. Check key, passphrase, host: %HOST%
    pause
    exit /b 1
)

echo.
echo [3/5] Build web app - local
call npm run prepare:vps
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo.
echo [4/5] Upload and update live site on VPS - you may be prompted for SSH passphrase
scp -i "%KEY%" -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -r vps-landing\app\* %HOST%:~/app-deploy/
if errorlevel 1 (
    echo SCP upload failed.
    pause
    exit /b 1
)
ssh -i "%KEY%" -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 %HOST% "sudo /usr/local/bin/wiseplan-deploy-app"
if errorlevel 1 (
    echo VPS deploy step failed.
    echo One-time setup on VPS: see docs\WORKING_CONFIG.md "Deploy script on VPS"
    echo Or on VPS run: sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/ ^&^& rm -r ~/app-deploy
    pause
    exit /b 1
)

echo.
echo === Done. Live site updated. ===
echo.
pause

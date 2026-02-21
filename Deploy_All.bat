@echo off
REM One-click: push to Git, pull on VPS, build web, deploy to live site.
REM Optional: store SSH key passphrase in Windows Credential Manager (see scripts\Load-VpsSshKey.ps1).
cd /d "%~dp0"

set KEY=%USERPROFILE%\.ssh\contabo_nikola
set HOST=nikola@207.180.222.248

REM Commit message: first argument or default
set MSG=%~1
if "%MSG%"=="" set MSG=Deploy %date% %time%

REM --- Optional: load SSH key from Windows Credential Manager (no passphrase prompt) ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Load-VpsSshKey.ps1" 2>nul

REM --- 1. Git: add, commit, push ---
where git >nul 2>nul
if errorlevel 1 (
    echo Git not found.
    pause
    exit /b 1
)
echo.
echo [1/4] Pushing to Git...
git add -A
git commit -m "%MSG%" 2>nul
if errorlevel 1 (
    echo Nothing to commit or commit failed. Continuing with push...
) else (
    echo Committed.
)
git push
if errorlevel 1 (
    echo Git push failed.
    pause
    exit /b 1
)
echo Git push done.

REM --- 2. Pull on VPS ---
echo.
echo [2/4] Pulling on VPS...
ssh -i "%KEY%" -o BatchMode=yes -o ConnectTimeout=10 %HOST% "cd ~/RouteCopilot2 && git pull origin master"
if errorlevel 1 (
    echo SSH pull failed. Check key / network.
    pause
    exit /b 1
)

REM --- 3. Build web app ---
echo.
echo [3/4] Building web app...
call npm run prepare:vps
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

REM --- 4. Upload and update live site on VPS ---
echo.
echo [4/4] Uploading and updating live site...
scp -i "%KEY%" -r -o BatchMode=yes vps-landing\app\* %HOST%:~/app-deploy/
if errorlevel 1 (
    echo SCP failed.
    pause
    exit /b 1
)
ssh -i "%KEY%" -o BatchMode=yes %HOST% "sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/ && rm -rf ~/app-deploy"
if errorlevel 1 (
    echo VPS copy failed. You may need to run on VPS: sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/ ^&^& rm -r ~/app-deploy
    pause
    exit /b 1
)

echo.
echo === Done. Live site updated. ===
echo.
pause

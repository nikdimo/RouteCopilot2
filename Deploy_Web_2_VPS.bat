@echo off
REM Build the web app and upload to VPS. Live site updates only after you run the VPS copy step.
set KEY=%USERPROFILE%\.ssh\contabo_nikola
set HOST=nikola@207.180.222.248

echo Building web app...
call npm run prepare:vps
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo Uploading to VPS...
scp -r -i "%KEY%" vps-landing\app\* %HOST%:~/app-deploy/
if errorlevel 1 (
  echo SCP failed.
  pause
  exit /b 1
)

echo Updating live site on VPS...
ssh -i "%KEY%" %HOST% "sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/ && rm -rf ~/app-deploy"
if errorlevel 1 (
  echo VPS copy failed. Run on VPS: sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/ ^&^& rm -r ~/app-deploy
  pause
  exit /b 1
)

echo.
echo === Done. Live site updated. ===
echo.
pause

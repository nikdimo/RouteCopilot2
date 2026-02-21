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

echo.
echo === On the VPS run these commands to update the live site ===
echo   sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/
echo   rm -r ~/app-deploy
echo.
echo Or SSH in and run them:  ssh -i "%KEY%" %HOST%
echo.
pause

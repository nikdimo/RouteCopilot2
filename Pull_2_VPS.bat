@echo off
REM Pull latest RouteCopilot2 on the VPS (git pull only; build/deploy run on VPS).
set KEY=%USERPROFILE%\.ssh\contabo_nikola
set HOST=nikola@207.180.222.248
echo Pulling on VPS...
ssh -i "%KEY%" %HOST% "cd ~/RouteCopilot2 && git pull origin master"
echo.
pause

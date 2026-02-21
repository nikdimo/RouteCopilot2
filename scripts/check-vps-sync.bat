@echo off
REM Quick check: compare local + origin with VPS repo (run from project root).
cd /d "%~dp0.."
set KEY=%USERPROFILE%\.ssh\contabo_nikola
set HOST=nikola@207.180.222.248

echo Local latest commit:
git log -1 --oneline
echo.
echo Origin (GitHub) latest commit:
git fetch origin 2>nul
git log origin/master -1 --oneline
echo.
echo VPS repo latest commit:
ssh -i "%KEY%" -o ConnectTimeout=10 %HOST% "cd ~/RouteCopilot2 2>/dev/null && git log -1 --oneline || echo (could not read VPS repo)"
echo.
echo If all three show the same commit hash, Git and VPS are in sync.
pause

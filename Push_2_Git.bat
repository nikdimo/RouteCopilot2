@echo off
REM Push RouteCopilot2 from this PC to GitHub (then pull on VPS or ask the bot).
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo Git not found.
    pause
    exit /b 1
)

echo.
echo Git status:
git status -sb
echo.
set /p MSG="Commit message: "
if "%MSG%"=="" (
    echo No message. Exiting.
    pause
    exit /b 0
)

echo.
echo Adding, committing, pushing...
git add -A
git commit -m "%MSG%"
git push
echo.
echo Done. On the VPS run Pull_2_VPS or ask the bot: Pull latest from git
echo.
pause

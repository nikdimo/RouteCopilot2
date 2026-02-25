@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Safer push helper: stage tracked changes first, optionally include untracked files, then confirm.
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
echo Staging tracked changes (modified/deleted) only...
git add -u
if errorlevel 1 (
    echo Failed to stage tracked changes.
    pause
    exit /b 1
)

set "HAS_UNTRACKED=0"
for /f "delims=" %%F in ('git ls-files --others --exclude-standard') do (
    if "!HAS_UNTRACKED!"=="0" (
        echo.
        echo Untracked files found:
        set "HAS_UNTRACKED=1"
    )
    echo   %%F
)

if "!HAS_UNTRACKED!"=="1" (
    echo.
    set /p INCLUDE_NEW="Include ALL untracked files too? (y/N): "
    if /I "!INCLUDE_NEW!"=="y" (
        git add -A
        if errorlevel 1 (
            echo Failed to stage untracked files.
            pause
            exit /b 1
        )
    ) else (
        echo Skipping untracked files.
    )
) else (
    echo No untracked files to include.
)

git diff --cached --quiet
if errorlevel 2 (
    echo Failed to inspect staged changes.
    pause
    exit /b 1
)
if not errorlevel 1 (
    echo No staged changes. Nothing to commit.
    pause
    exit /b 0
)

echo.
echo Staged changes:
git diff --cached --name-status
echo.
set /p CONFIRM="Commit and push the staged changes above? (Y/n): "
if /I "%CONFIRM%"=="n" (
    echo Cancelled. Staged changes were left as-is.
    pause
    exit /b 0
)

echo.
echo Committing and pushing...
git commit -m "%MSG%"
if errorlevel 1 (
    echo Commit failed.
    pause
    exit /b 1
)
git push
if errorlevel 1 (
    echo Push failed.
    pause
    exit /b 1
)
echo.
echo Done. On the VPS run Pull_2_VPS or ask the bot: Pull latest from git
echo.
pause

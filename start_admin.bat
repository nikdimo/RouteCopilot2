@echo off
setlocal

cd /d "%~dp0"

set "RUN_MIGRATION=1"
if /i "%~1"=="--skip-migrate" set "RUN_MIGRATION=0"

echo [WisePlan] Starting admin stack from:
echo %cd%
echo.

if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy /y "backend\.env.example" "backend\.env" >nul
    echo [WisePlan] Created backend\.env from backend\.env.example
  ) else (
    echo [WisePlan] ERROR: backend\.env and backend\.env.example are missing.
    pause
    exit /b 1
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo [WisePlan] ERROR: Node.js is not available in PATH.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [WisePlan] ERROR: Python is not available in PATH.
  pause
  exit /b 1
)

if "%RUN_MIGRATION%"=="1" (
  echo [WisePlan] Running backend migrations...
  call npm.cmd run backend:migrate:build
  if errorlevel 1 (
    echo [WisePlan] ERROR: Migration failed.
    echo [WisePlan] Check PostgreSQL service and backend\.env DATABASE_URL.
    pause
    exit /b 1
  )
) else (
  echo [WisePlan] Skipping migrations: --skip-migrate
)

echo [WisePlan] Starting backend window...
start "WisePlan Backend" cmd /k "cd /d ""%~dp0"" && npm.cmd run backend:start:build"

echo [WisePlan] Starting admin panel window...
start "WisePlan Admin Panel" cmd /k "cd /d ""%~dp0"" && npm.cmd run admin:serve"

timeout /t 4 /nobreak >nul
start "" "http://localhost:5175"

echo.
echo [WisePlan] Admin panel opened at http://localhost:5175
echo [WisePlan] Use start_admin.bat --skip-migrate for faster restart.
exit /b 0

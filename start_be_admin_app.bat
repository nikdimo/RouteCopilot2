@echo off
setlocal

cd /d "%~dp0"

set "RUN_MIGRATION=1"
set "APP_MODE=web"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--skip-migrate" (
  set "RUN_MIGRATION=0"
  shift
  goto parse_args
)
if /i "%~1"=="--android" (
  set "APP_MODE=android"
  shift
  goto parse_args
)
if /i "%~1"=="--web" (
  set "APP_MODE=web"
  shift
  goto parse_args
)
shift
goto parse_args

:args_done
echo [WisePlan] Starting full local stack from:
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

echo [WisePlan] Starting app window: %APP_MODE%
if /i "%APP_MODE%"=="android" (
  start "WisePlan App (Android)" cmd /k "cd /d ""%~dp0"" && npm.cmd run android:backend"
) else (
  start "WisePlan App (Web)" cmd /k "cd /d ""%~dp0"" && npm.cmd run web:backend"
)

timeout /t 6 /nobreak >nul
start "" "http://localhost:5175"
if /i "%APP_MODE%"=="web" start "" "http://localhost:8081"

echo.
echo [WisePlan] Started:
echo - Backend
echo - Admin panel: http://localhost:5175
if /i "%APP_MODE%"=="web" (
  echo - App requested in web mode. If 8081 is busy, Expo may pick another port.
) else (
  echo - App requested in Android mode.
)
echo [WisePlan] Use --skip-migrate for faster restart.
exit /b 0

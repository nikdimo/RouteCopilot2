@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

set "RUN_MIGRATION=1"
set "APP_MODE=web"
set "BILLING_PORT=8090"

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
if /i "%~1"=="--billing-port" (
  if not "%~2"=="" (
    set "BILLING_PORT=%~2"
    shift
  )
  shift
  goto parse_args
)
shift
goto parse_args

:args_done
echo [WisePlan] Starting local app + admin + billing stack from:
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

if not exist "vps-landing\index.html" (
  echo [WisePlan] ERROR: vps-landing\index.html not found.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [WisePlan] ERROR: Node.js is not available in PATH.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo [WisePlan] ERROR: Python is not available in PATH.
    pause
    exit /b 1
  ) else (
    set "PY_CMD=py"
  )
) else (
  set "PY_CMD=python"
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
start "WisePlan Backend" cmd /k "cd /d ""%ROOT%"" && npm.cmd run backend:start:build"

echo [WisePlan] Starting admin panel window...
start "WisePlan Admin Panel" cmd /k "cd /d ""%ROOT%"" && npm.cmd run admin:serve"

echo [WisePlan] Starting homepage/billing static server on port %BILLING_PORT%...
start "WisePlan Billing Site" cmd /k "cd /d ""%ROOT%\vps-landing"" && %PY_CMD% -m http.server %BILLING_PORT%"

if /i "%APP_MODE%"=="android" (
  set "BILLING_UPGRADE_URL=http://10.0.2.2:%BILLING_PORT%/billing"
  echo [WisePlan] Starting app window: android
  echo [WisePlan] Billing upgrade URL for app: %BILLING_UPGRADE_URL%
  start "WisePlan App (Android)" cmd /k "cd /d ""%ROOT%"" && set ""EXPO_PUBLIC_BILLING_UPGRADE_URL=%BILLING_UPGRADE_URL%"" && npm.cmd run android:backend"
) else (
  set "BILLING_UPGRADE_URL=http://localhost:%BILLING_PORT%/billing"
  echo [WisePlan] Starting app window: web
  echo [WisePlan] Billing upgrade URL for app: %BILLING_UPGRADE_URL%
  start "WisePlan App (Web)" cmd /k "cd /d ""%ROOT%"" && set ""EXPO_PUBLIC_BILLING_UPGRADE_URL=%BILLING_UPGRADE_URL%"" && npm.cmd run web:backend"
)

timeout /t 7 /nobreak >nul

start "" "http://localhost:5175"
start "" "http://localhost:%BILLING_PORT%/"
start "" "http://localhost:%BILLING_PORT%/billing/"
start "" "http://localhost:%BILLING_PORT%/account/billing/"
if /i "%APP_MODE%"=="web" start "" "http://localhost:8081"

echo.
echo [WisePlan] Started:
echo - Backend: http://localhost:4000
echo - Admin panel: http://localhost:5175
echo - Billing site: http://localhost:%BILLING_PORT%/billing/
echo - Account billing: http://localhost:%BILLING_PORT%/account/billing/
if /i "%APP_MODE%"=="web" (
  echo - App requested in web mode. If 8081 is busy, Expo may pick another port.
) else (
  echo - App requested in Android mode.
)
echo.
echo [WisePlan] Options:
echo   --skip-migrate
echo   --web
echo   --android
echo   --billing-port PORT
exit /b 0

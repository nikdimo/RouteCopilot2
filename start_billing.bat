@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

set "RUN_MIGRATION=1"
set "BILLING_PORT=8090"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--skip-migrate" (
  set "RUN_MIGRATION=0"
  shift
  goto parse_args
)
if /i "%~1"=="--port" (
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
echo [WisePlan] Starting billing-only stack from:
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

if not exist "scripts\serve_vps_landing_nocache.py" (
  echo [WisePlan] ERROR: scripts\serve_vps_landing_nocache.py not found.
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

echo [WisePlan] Releasing billing server port %BILLING_PORT% if occupied...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%BILLING_PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [WisePlan] Stopping process %%P on port %BILLING_PORT%...
    taskkill /PID %%P /F >nul 2>&1
  )
)

if not "%BILLING_PORT%"=="4004" (
  echo [WisePlan] Releasing legacy test port 4004 if occupied...
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":4004 .*LISTENING"') do (
    if not "%%P"=="0" (
      echo [WisePlan] Stopping process %%P on port 4004...
      taskkill /PID %%P /F >nul 2>&1
    )
  )
)

if "%RUN_MIGRATION%"=="1" (
  echo [WisePlan] Running backend migrations...
  call npm.cmd run backend:migrate:build
  if errorlevel 1 (
    echo.
    echo [WisePlan] WARNING: Migration failed.
    echo [WisePlan] Billing pages will still start, but billing API data may not load.
    echo.
  )
) else (
  echo [WisePlan] Skipping migrations: --skip-migrate
)

echo [WisePlan] Starting backend window...
start "WisePlan Backend" cmd /k "cd /d ""%ROOT%"" && npm.cmd run backend:start:build"

echo [WisePlan] Starting billing static server on port %BILLING_PORT% (no-cache)...
start "WisePlan Billing Site" cmd /k "cd /d ""%ROOT%\vps-landing"" && %PY_CMD% ..\scripts\serve_vps_landing_nocache.py --port %BILLING_PORT%"

timeout /t 5 /nobreak >nul

set "CACHE_BUST=%RANDOM%%RANDOM%"
start "" "http://localhost:%BILLING_PORT%/billing/?_cb=%CACHE_BUST%"
start "" "http://localhost:%BILLING_PORT%/account/billing/?_cb=%CACHE_BUST%"

echo.
echo [WisePlan] Started:
echo - Backend: http://localhost:4000
echo - Billing: http://localhost:%BILLING_PORT%/billing/
echo - Account billing: http://localhost:%BILLING_PORT%/account/billing/
echo - Billing server root: %ROOT%\vps-landing
echo.
echo [WisePlan] Options:
echo   --skip-migrate
echo   --port PORT
exit /b 0

@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo [WisePlan] Starting local homepage + billing preview from:
echo %ROOT%
echo.

cd /d "%ROOT%"

echo [WisePlan] Running backend migrations...
call npm run backend:migrate:build
if errorlevel 1 (
  echo.
  echo [WisePlan] WARNING: Migration failed.
  echo [WisePlan] Homepage will still run, but billing API data may not load.
  echo.
)

echo [WisePlan] Starting backend server in new window...
start "WisePlan Backend localhost 4000" cmd /k "cd /d \"%ROOT%\" && npm run backend:start:build"

echo [WisePlan] Starting static landing server in new window...
where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo [WisePlan] ERROR: Python was not found. Tried python and py.
    echo Install Python and run again.
    pause
    exit /b 1
  )
  set "PY_CMD=py"
) else (
  set "PY_CMD=python"
)
start "WisePlan Landing localhost 8088" cmd /k "cd /d \"%ROOT%\" && %PY_CMD% -m http.server 8088 --directory \"%ROOT%\vps-landing\""

echo [WisePlan] Waiting for servers to boot...
timeout /t 4 /nobreak >nul

echo [WisePlan] Opening pages...
start "" "http://localhost:8088/"
start "" "http://localhost:8088/billing/"
start "" "http://localhost:8088/account/billing/"

echo.
echo [WisePlan] Done.
echo - Homepage: http://localhost:8088/
echo - Billing:  http://localhost:8088/billing/
echo - Account:  http://localhost:8088/account/billing/
echo.
echo Close the two opened terminal windows when finished.
pause

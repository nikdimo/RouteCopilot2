@echo off
echo ========================================
echo WisePlan - Backend Test Script
echo ========================================
echo.

cd /d "%~dp0backend"

echo Checking if PostgreSQL is accessible...
echo.
psql -U postgres -d wiseplan -c "SELECT 'PostgreSQL is running!' as status;" 2>nul
if errorlevel 1 (
    echo [ERROR] Cannot connect to PostgreSQL database!
    echo.
    echo Possible solutions:
    echo 1. Make sure PostgreSQL service is running:
    echo    net start postgresql*
    echo.
    echo 2. Create the 'wiseplan' database:
    echo    psql -U postgres -c "CREATE DATABASE wiseplan;"
    echo.
    echo 3. Check the DATABASE_URL in backend\.env
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] PostgreSQL is accessible!
echo.
echo Running migrations...
cd /d "%~dp0"
call npm.cmd run backend:migrate:build
if errorlevel 1 (
    echo [ERROR] Migration failed!
    pause
    exit /b 1
)

echo.
echo [OK] Migrations complete!
echo.
echo Starting backend server...
echo Backend will be available at: http://localhost:4000
echo.
echo Press Ctrl+C to stop the server.
echo.
call npm.cmd run backend:start:build

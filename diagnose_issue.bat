@echo off
setlocal enabledelayedexpansion
echo ========================================
echo WisePlan - Diagnostic Tool
echo ========================================
echo.

cd /d "%~dp0"

echo [1/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js not found in PATH
    set "ISSUES=!ISSUES! Node.js"
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo [OK] Node.js !NODE_VERSION!
)

echo.
echo [2/6] Checking npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo [X] npm not found in PATH
    set "ISSUES=!ISSUES! npm"
) else (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo [OK] npm !NPM_VERSION!
)

echo.
echo [3/6] Checking PostgreSQL...
where psql >nul 2>&1
if errorlevel 1 (
    echo [!] PostgreSQL tools (psql) not found in PATH
    echo     Backend features will not work without PostgreSQL
    set "WARNINGS=!WARNINGS! PostgreSQL"
) else (
    psql -U postgres -d wiseplan -c "SELECT version();" >nul 2>&1
    if errorlevel 1 (
        echo [!] PostgreSQL is installed but cannot connect to 'wiseplan' database
        echo     Run: psql -U postgres -c "CREATE DATABASE wiseplan;"
        set "WARNINGS=!WARNINGS! PostgreSQL-DB"
    ) else (
        echo [OK] PostgreSQL connected to 'wiseplan' database
    )
)

echo.
echo [4/6] Checking node_modules...
if exist "node_modules\" (
    echo [OK] Frontend node_modules exists
) else (
    echo [X] Frontend node_modules missing - run: npm install
    set "ISSUES=!ISSUES! Frontend-Deps"
)

if exist "backend\node_modules\" (
    echo [OK] Backend node_modules exists
) else (
    echo [!] Backend node_modules missing - run: cd backend ^&^& npm install
    set "WARNINGS=!WARNINGS! Backend-Deps"
)

echo.
echo [5/6] Checking backend build...
if exist "backend\dist\server.js" (
    echo [OK] Backend is built
) else (
    echo [!] Backend not built - run: npm run backend:build
    set "WARNINGS=!WARNINGS! Backend-Build"
)

echo.
echo [6/6] Checking configuration files...
if exist "backend\.env" (
    echo [OK] backend\.env exists
) else (
    echo [!] backend\.env missing - will be created from .env.example
    set "WARNINGS=!WARNINGS! Backend-Config"
)

echo.
echo ========================================
echo DIAGNOSTIC SUMMARY
echo ========================================

if defined ISSUES (
    echo.
    echo [ERROR] Critical issues found:
    echo !ISSUES!
    echo.
    echo Please fix these issues before continuing.
) else (
    echo.
    echo [OK] No critical issues found!
)

if defined WARNINGS (
    echo.
    echo [WARNING] Non-critical warnings:
    echo !WARNINGS!
    echo.
    echo You can still run the frontend-only version.
)

if not defined ISSUES if not defined WARNINGS (
    echo.
    echo Everything looks good! You can run:
    echo   - start_web_only.bat        ^(Frontend only, no backend^)
    echo   - test_backend_only.bat     ^(Backend only^)
    echo   - start_be_admin_app.bat    ^(Full stack^)
)

echo.
echo Press any key to exit...
pause >nul

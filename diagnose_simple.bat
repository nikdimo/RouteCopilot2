@echo off
echo ========================================
echo WisePlan - Simple Diagnostic
echo ========================================
echo.

cd /d "%~dp0"

echo Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js NOT found
) else (
    node --version
    echo [OK] Node.js found
)

echo.
echo Checking npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo [X] npm NOT found
) else (
    npm --version
    echo [OK] npm found
)

echo.
echo Checking frontend dependencies...
if exist "node_modules\" (
    echo [OK] node_modules exists
) else (
    echo [X] node_modules missing - run: npm install
)

echo.
echo Checking backend...
if exist "backend\" (
    echo [OK] backend folder exists
    if exist "backend\node_modules\" (
        echo [OK] backend\node_modules exists
    ) else (
        echo [!] backend\node_modules missing
    )
    if exist "backend\dist\" (
        echo [OK] backend is built
    ) else (
        echo [!] backend not built
    )
) else (
    echo [X] backend folder missing
)

echo.
echo Checking PostgreSQL...
psql --version >nul 2>&1
if errorlevel 1 (
    echo [!] PostgreSQL not found in PATH
    echo     Backend will not work without PostgreSQL
) else (
    psql --version
    echo [OK] PostgreSQL installed
)

echo.
echo ========================================
echo.
echo Next steps:
echo 1. If node_modules missing: npm install
echo 2. Test frontend only: start_web_only.bat
echo 3. Check browser console (F12) for errors
echo.
pause

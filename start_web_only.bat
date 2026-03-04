@echo off
echo ========================================
echo WisePlan - Web App Only (No Backend)
echo ========================================
echo.
echo This will start ONLY the web frontend
echo without backend dependencies.
echo.
echo App will be available at:
echo http://localhost:8081
echo.
echo Press any key to continue...
pause >nul

cd /d "%~dp0"
echo Starting Expo web server...
echo.
npm run web

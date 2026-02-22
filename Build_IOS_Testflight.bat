@echo off
REM ============================================================
REM WisePlan - iOS Build & TestFlight Submit
REM ============================================================
REM
REM IMPORTANT: Always use this script (do not run "eas build" alone).
REM Step 0 bumps app.json build number; eas.json uses appVersionSource: local,
REM so each run produces a new build number and TestFlight submit will succeed.
REM Skipping the bump or running eas build without it can waste EAS builds.
REM
REM Prerequisites (one-time):
REM   - Node.js, npm installed
REM   - EAS CLI: npm install -g eas-cli
REM   - Logged in: eas login
REM   - eas.json: Add to submit.production.ios:
REM       "appleId": "your@apple-id.email"
REM       "ascAppId": "1234567890" (from App Store Connect)
REM
REM Optional - for submit without prompts (uncomment and set below):
REM   set EXPO_APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
REM   Create at: appleid.apple.com -> Sign-In and Security -> App-Specific Passwords
REM ============================================================

cd /d "%~dp0"

where eas >nul 2>nul
if errorlevel 1 (
    echo EAS CLI not found. Run: npm install -g eas-cli
    pause
    exit /b 1
)

echo.
echo [0/2] Bumping iOS build number...
node scripts\bump-ios-build.js
if errorlevel 1 (
    echo Bump failed. Check app.json and scripts\bump-ios-build.js
    pause
    exit /b 1
)

echo.
echo [1/2] Building iOS (production)...
echo.
call eas build --platform ios --profile production
if errorlevel 1 (
    echo.
    echo Build failed. Check errors above.
    pause
    exit /b 1
)

echo.
echo Build completed successfully.
echo.
set /p SUBMIT="Submit to TestFlight now? (Y/N): "
if /i "%SUBMIT%"=="Y" (
    echo.
    echo [2/2] Submitting to TestFlight...
    echo.
    call eas submit --platform ios --profile production --latest
    if errorlevel 1 (
        echo.
        echo Submit failed. You can submit later with:
        echo   eas submit --platform ios --profile production --latest
        pause
        exit /b 1
    )
    echo.
    echo Done. Build is processing for TestFlight.
) else (
    echo.
    echo Skipped submit. To submit later, run:
    echo   eas submit --platform ios --profile production --latest
)

echo.
pause

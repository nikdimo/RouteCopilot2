@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: If not running as Administrator, relaunch in elevated PowerShell
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator elevation in PowerShell...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-Command','& \"%~f0\" %*'"
  exit /b 0
)

if /I "%~1"=="/?" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"
set "ANDROID_DIR=%REPO_DIR%\android"
set "APP_ID=com.wiseplan.app"
set "DEV_PORT=8082"
set "AVD_NAME=Medium_Phone_API_36.1"
set "FIRST_FAIL_RC=1"

if not "%~1"=="" set "AVD_NAME=%~1"
if not "%~2"=="" set "DEV_PORT=%~2"

call :setup_env
if errorlevel 1 exit /b 1

echo.
echo ============================================================
echo [TRY] Normal flow
echo ============================================================
call :run_flow NICE
if not errorlevel 1 goto :success

set "FIRST_FAIL_RC=%errorlevel%"
echo.
echo [FAIL] Normal flow failed with code %FIRST_FAIL_RC%.
echo [INFO] Next step can force-close IDEs/processes, hard-delete build folders,
echo        run "expo prebuild --clean", then retry automatically.
choice /C YN /N /M "Go nuclear and retry now? [Y/N]: "
if errorlevel 2 (
  echo [STOP] Nuclear cleanup skipped.
  exit /b %FIRST_FAIL_RC%
)

echo.
echo ============================================================
echo [NUCLEAR] Aggressive cleanup
echo ============================================================
call :nuclear_cleanup

echo.
echo ============================================================
echo [RETRY] Flow after nuclear cleanup
echo ============================================================
call :run_flow NUCLEAR
if errorlevel 1 (
  echo [ERROR] Failed even after nuclear cleanup.
  exit /b 2
)

:success
echo.
echo ============================================================
echo [SUCCESS] Build + install + launch complete.
echo ============================================================
echo Emulator: %AVD_NAME%
echo Port: %DEV_PORT%
echo APK: %ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk
exit /b 0

:setup_env
if not exist "%ANDROID_DIR%\gradlew.bat" (
  echo [ERROR] gradlew not found at "%ANDROID_DIR%\gradlew.bat"
  exit /b 1
)

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo [ERROR] JDK 17 not found at "%JAVA_HOME%"
  exit /b 1
)

set "ORG_GRADLE_JAVA_HOME=%JAVA_HOME%"
set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
set "ANDROID_USER_HOME=C:\AndroidPrefs\RouteCopilot2"
set "ANDROID_PREFS_ROOT="
set "ANDROID_SDK_HOME="
set "GRADLE_USER_HOME=%REPO_DIR%\.gradle"
set "NODE_ENV=development"
set "KOTLIN_COMPILER_EXECUTION_STRATEGY=in-process"
set "PATH=%JAVA_HOME%\bin;%ANDROID_SDK_ROOT%\platform-tools;%ANDROID_SDK_ROOT%\emulator;%PATH%"
set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
set "EMULATOR=%ANDROID_SDK_ROOT%\emulator\emulator.exe"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk"

if not exist "%ADB%" (
  echo [ERROR] adb not found. Expected "%ADB%"
  exit /b 1
)
if not exist "%EMULATOR%" (
  echo [ERROR] emulator not found. Expected "%EMULATOR%"
  exit /b 1
)
if not exist "%ANDROID_USER_HOME%" mkdir "%ANDROID_USER_HOME%" >nul 2>&1
exit /b 0

:run_flow
set "MODE=%~1"
echo [1/6] Cleaning stale module build dirs (%MODE%)...
call :delete_if_exists "%REPO_DIR%\node_modules\react-native-reanimated\android\build"
call :delete_if_exists "%REPO_DIR%\node_modules\react-native-svg\android\build"
call :delete_if_exists "%REPO_DIR%\node_modules\react-native-screens\android\build"

echo [2/6] Building debug APK...
pushd "%ANDROID_DIR%"
call gradlew.bat --stop >nul 2>&1
call gradlew.bat :app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=%DEV_PORT% "-PreactNativeArchitectures=x86_64,arm64-v8a"
if errorlevel 1 (
  popd
  echo [ERROR] Gradle build failed.
  exit /b 11
)
popd
if not exist "%APK_PATH%" (
  echo [ERROR] APK not found at "%APK_PATH%"
  exit /b 12
)

echo [3/6] Opening Android Studio...
call :open_studio

echo [4/6] Ensuring emulator is running...
call :ensure_emulator
if errorlevel 1 exit /b 13

echo [5/6] Installing APK...
"%ADB%" install -r "%APK_PATH%"
if errorlevel 1 (
  echo [ERROR] APK install failed.
  exit /b 14
)

echo [6/6] Starting Metro + launching dev client...
call :ensure_metro
"%ADB%" reverse --remove-all >nul 2>&1
"%ADB%" reverse tcp:%DEV_PORT% tcp:%DEV_PORT% >nul 2>&1
"%ADB%" shell am force-stop %APP_ID% >nul 2>&1
"%ADB%" shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%%3A%%2F%%2F10.0.2.2%%3A%DEV_PORT%" %APP_ID%
if errorlevel 1 (
  echo [WARN] Deep link failed. Trying launcher fallback...
  "%ADB%" shell monkey -p %APP_ID% -c android.intent.category.LAUNCHER 1 >nul 2>&1
)
exit /b 0

:open_studio
set "STUDIO_EXE=%ProgramFiles%\Android\Android Studio\bin\studio64.exe"
if not exist "%STUDIO_EXE%" set "STUDIO_EXE=%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe"
if exist "%STUDIO_EXE%" (
  start "Android Studio" "%STUDIO_EXE%" "%REPO_DIR%"
) else (
  echo [WARN] Android Studio executable not found. Continuing.
)
exit /b 0

:ensure_emulator
set "EMU_DEVICE="
for /f "tokens=1,2" %%A in ('"%ADB%" devices ^| findstr /R "^emulator-[0-9][0-9]*[ ]*device$"') do (
  set "EMU_DEVICE=%%A"
)
if defined EMU_DEVICE exit /b 0

start "Android Emulator" "%EMULATOR%" -avd "%AVD_NAME%" -netdelay none -netspeed full
call :wait_for_emulator
if errorlevel 1 (
  echo [ERROR] Emulator failed to boot in time.
  exit /b 1
)
exit /b 0

:ensure_metro
call :is_port_listening %DEV_PORT%
if errorlevel 1 (
  start "Expo Metro :%DEV_PORT%" cmd /k "cd /d ""%REPO_DIR%"" && npx.cmd expo start --port %DEV_PORT%"
  timeout /t 6 /nobreak >nul
) else (
  echo [OK] Metro already listening on port %DEV_PORT%.
)
exit /b 0

:nuclear_cleanup
echo [N1] Closing IDEs...
taskkill /F /IM studio64.exe >nul 2>&1
taskkill /F /IM studio.exe >nul 2>&1
taskkill /F /IM code.exe >nul 2>&1
taskkill /F /IM devenv.exe >nul 2>&1

echo [N2] Stopping Gradle...
if exist "%ANDROID_DIR%\gradlew.bat" (
  pushd "%ANDROID_DIR%"
  call gradlew.bat --stop >nul 2>&1
  popd
)

echo [N3] Killing locking processes...
for %%P in (java.exe javaw.exe kotlin-daemon.exe node.exe adb.exe qemu-system-x86_64.exe emulator.exe) do (
  taskkill /F /IM %%P >nul 2>&1
)

echo [N4] Trying to close emulator via adb...
"%ADB%" devices >nul 2>&1
"%ADB%" emu kill >nul 2>&1

echo [N5] Hard-deleting build folders...
call :nuke "%REPO_DIR%\android\.gradle"
call :nuke "%REPO_DIR%\android\build"
call :nuke "%REPO_DIR%\android\app\build"
call :nuke "%REPO_DIR%\node_modules\expo-dev-launcher\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-dev-menu\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-dev-menu-interface\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-dev-client\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-modules-core\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-updates-interface\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-manifests\android\build"
call :nuke "%REPO_DIR%\node_modules\expo-json-utils\android\build"
call :nuke "%REPO_DIR%\node_modules\expo\android\build"
call :nuke "%REPO_DIR%\node_modules\expo\node_modules\expo-constants\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-screens\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-gesture-handler\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-safe-area-context\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-webview\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-svg\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-maps\android\build"
call :nuke "%REPO_DIR%\node_modules\react-native-reanimated\android\build"
call :nuke "%REPO_DIR%\node_modules\@react-native-async-storage\async-storage\android\build"

echo [N6] Running expo prebuild --clean...
pushd "%REPO_DIR%"
call npx.cmd expo prebuild --clean
if errorlevel 1 (
  popd
  echo [WARN] expo prebuild --clean failed. Retry may still fail.
  exit /b 1
)
popd
exit /b 0

:delete_if_exists
set "TARGET=%~1"
if exist "%TARGET%" (
  rd /s /q "%TARGET%" >nul 2>&1
  if exist "%TARGET%" (
    echo [WARN] Could not delete "%TARGET%". Continuing.
  ) else (
    echo [OK] Deleted "%TARGET%"
  )
)
exit /b 0

:nuke
set "TARGET=%~1"
if exist "%TARGET%" (
  echo   - Removing: "%TARGET%"
  takeown /f "%TARGET%" /r /d y >nul 2>&1
  icacls "%TARGET%" /grant "%USERDOMAIN%\%USERNAME%:(OI)(CI)F" /T >nul 2>&1
  icacls "%TARGET%" /grant "*S-1-5-32-545:(OI)(CI)M" /T >nul 2>&1
  cmd /c rmdir /s /q "%TARGET%" >nul 2>&1
)
exit /b 0

:is_port_listening
set "CHECK_PORT=%~1"
netstat -ano -p tcp | findstr /R /C:":%CHECK_PORT% .*LISTENING" >nul
if errorlevel 1 exit /b 1
exit /b 0

:wait_for_emulator
set /a ELAPSED=0
:wait_loop
"%ADB%" wait-for-device >nul 2>&1
set "BOOT_DONE="
for /f "delims=" %%G in ('"%ADB%" shell getprop sys.boot_completed 2^>nul') do set "BOOT_DONE=%%G"
if "!BOOT_DONE!"=="1" exit /b 0
if !ELAPSED! GEQ 300 exit /b 1
timeout /t 5 /nobreak >nul
set /a ELAPSED+=5
goto :wait_loop

:usage
echo Usage:
echo   %~nx0 [AVD_NAME] [DEV_PORT]
echo.
echo Behavior:
echo   1) Try normal build/start flow.
echo   2) On failure, prompt for nuclear cleanup + auto-retry.
echo.
echo Examples:
echo   %~nx0
echo   %~nx0 Medium_Phone_API_36.1 8082
exit /b 0

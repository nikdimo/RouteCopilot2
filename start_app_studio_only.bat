@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /I "%~1"=="/?" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"
set "DEV_PORT=8082"
set "APP_ID=com.wiseplan.app"

if not "%~1"=="" set "DEV_PORT=%~1"

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"
set "ORG_GRADLE_JAVA_HOME=%JAVA_HOME%"
set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
set "ANDROID_USER_HOME=C:\AndroidPrefs\RouteCopilot2"
set "ANDROID_PREFS_ROOT="
set "ANDROID_SDK_HOME="
set "PATH=%JAVA_HOME%\bin;%ANDROID_SDK_ROOT%\platform-tools;%PATH%"

set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
if not exist "%ADB%" (
  echo [ERROR] adb not found at "%ADB%"
  exit /b 1
)

echo.
echo [1/4] Opening Android Studio...
set "STUDIO_EXE=%ProgramFiles%\Android\Android Studio\bin\studio64.exe"
if not exist "%STUDIO_EXE%" set "STUDIO_EXE=%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe"
if exist "%STUDIO_EXE%" (
  start "Android Studio" "%STUDIO_EXE%" "%REPO_DIR%"
) else (
  echo [WARN] Android Studio executable not found. Continuing without launching it.
)

echo.
echo [2/4] Waiting for emulator from Android Studio Device Manager...
echo        Start emulator in Android Studio (set "Launch in a tool window" if desired).
call :wait_for_emulator "%ADB%"
if errorlevel 1 (
  echo [ERROR] No emulator detected.
  exit /b 1
)

echo.
echo [3/4] Starting Metro on port %DEV_PORT%...
call :is_port_listening %DEV_PORT%
if errorlevel 1 (
  start "Expo Metro :%DEV_PORT%" cmd /k "cd /d ""%REPO_DIR%"" && npx.cmd expo start --port %DEV_PORT%"
  timeout /t 6 /nobreak >nul
) else (
  echo [OK] Port %DEV_PORT% already listening. Reusing existing Metro.
)

echo.
echo [4/4] Launching app in emulator...
"%ADB%" reverse --remove-all
"%ADB%" reverse tcp:%DEV_PORT% tcp:%DEV_PORT%
"%ADB%" shell am force-stop %APP_ID%
"%ADB%" shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%%3A%%2F%%2F10.0.2.2%%3A%DEV_PORT%" %APP_ID%
if errorlevel 1 (
  echo [WARN] Deep-link launch failed. Trying launcher fallback...
  "%ADB%" shell monkey -p %APP_ID% -c android.intent.category.LAUNCHER 1 >nul 2>&1
)

echo.
echo Done.
echo If emulator opens in separate window, enable Android Studio setting:
echo Device Manager ^> Settings ^> Launch in a tool window.
exit /b 0

:wait_for_emulator
set "ADB_BIN=%~1"
set /a ELAPSED=0
set /a TIMEOUT=300
:emu_loop
set "EMU_FOUND="
for /f "tokens=1,2" %%A in ('"%ADB_BIN%" devices ^| findstr /R "^emulator-[0-9][0-9]*[ ]*device$"') do (
  set "EMU_FOUND=1"
)
if defined EMU_FOUND exit /b 0
if %ELAPSED% GEQ %TIMEOUT% exit /b 1
timeout /t 5 /nobreak >nul
set /a ELAPSED+=5
goto :emu_loop

:is_port_listening
set "CHECK_PORT=%~1"
netstat -ano -p tcp | findstr /R /C:":%CHECK_PORT% .*LISTENING" >nul
if errorlevel 1 exit /b 1
exit /b 0

:usage
echo Usage:
echo   %~nx0 [DEV_PORT]
echo.
echo Example:
echo   %~nx0 8082
exit /b 0

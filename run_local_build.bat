@echo off
cd /d "C:\Users\Nikola Dimovski\RouteCopilot2"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
set "GRADLE_USER_HOME=C:\Users\Nikola Dimovski\RouteCopilot2\.gradle"
set "ADB_BINARY=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if "%ANDROID_GOOGLE_MAPS_API_KEY%"=="" set "ANDROID_GOOGLE_MAPS_API_KEY=DUMMY_KEY_FOR_DEV"
"C:\Program Files\nodejs\npx.cmd" expo run:android --port 8082

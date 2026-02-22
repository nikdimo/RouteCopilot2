# Set Java and Android SDK for this session, then run the app.
# Run from project root: .\run-android.ps1

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\Nikola Dimovski\AppData\Local\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:ANDROID_HOME\tools;$env:Path"

Set-Location $PSScriptRoot
npx expo run:android --device emulator-5554 --port 8083

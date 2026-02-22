# Full flow: set env, cold-boot emulator, wait for device, run app.
# Run from project root: .\run-android-with-emulator.ps1

$ErrorActionPreference = "Stop"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\Nikola Dimovski\AppData\Local\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:ANDROID_HOME\tools;$env:Path"
# Use port 8083 to avoid prompt when 8081 is in use
$env:REACT_NATIVE_PACKAGER_PORT = "8083"

Set-Location $PSScriptRoot

# Stop adb if it was running (ignore error when no daemon exists, e.g. after reboot)
Write-Host "Preparing adb..." -ForegroundColor Cyan
$errPrev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
& adb kill-server 2>&1 | Out-Null
& adb start-server 2>&1 | Out-Null
$ErrorActionPreference = $errPrev

Write-Host "Starting emulator with cold boot (no snapshot)..." -ForegroundColor Cyan
$emu = Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd","Medium_Phone_API_36.1","-no-snapshot" -PassThru -WindowStyle Normal

Start-Sleep -Seconds 3
& adb start-server | Out-Null

Write-Host "Waiting for emulator to become ready (up to 3 minutes)..." -ForegroundColor Cyan
$timeout = 180
$elapsed = 0
$step = 10
while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds $step
    $elapsed += $step
    $out = & adb devices 2>$null
    if ($out -match "emulator-5554\s+device") {
        Write-Host "Emulator is ready." -ForegroundColor Green
        break
    }
    Write-Host "  ... still booting ($elapsed s)" -ForegroundColor Gray
}
if ($elapsed -ge $timeout) {
    Write-Host "Timeout. Emulator may still be booting. Try running .\run-android.ps1 in a new window." -ForegroundColor Yellow
    exit 1
}

Start-Sleep -Seconds 5

Write-Host "Building and launching app..." -ForegroundColor Cyan
& npx expo run:android --device emulator-5554 --port 8083

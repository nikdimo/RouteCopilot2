# Run before "npx expo run:android" when you get "Unable to delete directory" on Windows.
$ErrorActionPreference = "SilentlyContinue"
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Write-Host "Stopping Gradle daemons..." -ForegroundColor Cyan
& "$root\android\gradlew.bat" -p "$root\android" --stop 2>&1 | Out-Null
Write-Host "Removing Android build dirs..." -ForegroundColor Cyan
$buildDirs = @(
    "$root\node_modules\expo\node_modules\expo-constants\android\build",
    "$root\node_modules\expo-modules-core\android\build",
    "$root\node_modules\react-native-reanimated\android\build",
    "$root\node_modules\expo\android\build",
    "$root\android\app\build"
)
foreach ($d in $buildDirs) {
    if (Test-Path $d) {
        cmd /c "rd /s /q `"$d`"" 2>$null
        if (Test-Path $d) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $d }
        Write-Host "  Cleaned $d" -ForegroundColor Gray
    }
}
Write-Host "Done. Run: npx expo run:android --port 8083" -ForegroundColor Green

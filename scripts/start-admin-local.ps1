param(
  [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "WisePlan admin local startup"
Write-Host "Repo: $root"

if (-not $SkipMigrate) {
  Write-Host "Running backend migrations..."
  npm.cmd run backend:migrate:build
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Migration failed. Ensure PostgreSQL is running and DATABASE_URL in backend/.env is valid."
    exit 1
  }
}

Write-Host "Starting backend server (new window)..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$root'; npm.cmd run backend:start:build"
)

Write-Host "Starting admin panel static server (new window)..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$root'; npm.cmd run admin:serve"
)

Start-Sleep -Seconds 4

$backendOk = $false
$adminOk = $false

try {
  $resp = Invoke-WebRequest -Uri "http://localhost:4000/healthz" -UseBasicParsing -TimeoutSec 5
  $backendOk = ($resp.StatusCode -eq 200)
} catch {
  $backendOk = $false
}

try {
  $resp = Invoke-WebRequest -Uri "http://localhost:5175" -UseBasicParsing -TimeoutSec 5
  $adminOk = ($resp.StatusCode -eq 200)
} catch {
  $adminOk = $false
}

if ($backendOk -and $adminOk) {
  Write-Host "Ready:"
  Write-Host "- Backend: http://localhost:4000/healthz"
  Write-Host "- Admin panel: http://localhost:5175"
  exit 0
}

Write-Warning "Started processes, but health checks were not both OK yet."
Write-Host "Check opened terminal windows for details."
exit 0

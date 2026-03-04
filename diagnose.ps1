# WisePlan Diagnostic Tool
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "WisePlan - Diagnostic Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$issues = @()
$warnings = @()

# Check 1: Node.js
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "[X] Node.js not found" -ForegroundColor Red
        $issues += "Node.js"
    }
} catch {
    Write-Host "[X] Node.js not found" -ForegroundColor Red
    $issues += "Node.js"
}

# Check 2: npm
Write-Host ""
Write-Host "[2/6] Checking npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] npm $npmVersion" -ForegroundColor Green
    } else {
        Write-Host "[X] npm not found" -ForegroundColor Red
        $issues += "npm"
    }
} catch {
    Write-Host "[X] npm not found" -ForegroundColor Red
    $issues += "npm"
}

# Check 3: PostgreSQL
Write-Host ""
Write-Host "[3/6] Checking PostgreSQL..." -ForegroundColor Yellow
try {
    $psqlCheck = Get-Command psql -ErrorAction SilentlyContinue
    if ($psqlCheck) {
        $env:PGPASSWORD = "m745qBHhM8c8"
        $pgTest = psql -U postgres -d wiseplan -c "SELECT 1;" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] PostgreSQL connected to 'wiseplan' database" -ForegroundColor Green
        } else {
            Write-Host "[!] PostgreSQL installed but cannot connect to 'wiseplan' database" -ForegroundColor Yellow
            Write-Host "    Try: psql -U postgres -c `"CREATE DATABASE wiseplan;`"" -ForegroundColor Gray
            $warnings += "PostgreSQL-DB"
        }
    } else {
        Write-Host "[!] PostgreSQL (psql) not found in PATH" -ForegroundColor Yellow
        Write-Host "    Backend features require PostgreSQL" -ForegroundColor Gray
        $warnings += "PostgreSQL"
    }
} catch {
    Write-Host "[!] PostgreSQL check failed" -ForegroundColor Yellow
    $warnings += "PostgreSQL"
}

# Check 4: node_modules
Write-Host ""
Write-Host "[4/6] Checking node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "[OK] Frontend node_modules exists" -ForegroundColor Green
} else {
    Write-Host "[X] Frontend node_modules missing" -ForegroundColor Red
    Write-Host "    Run: npm install" -ForegroundColor Gray
    $issues += "Frontend-Deps"
}

if (Test-Path "backend\node_modules") {
    Write-Host "[OK] Backend node_modules exists" -ForegroundColor Green
} else {
    Write-Host "[!] Backend node_modules missing" -ForegroundColor Yellow
    Write-Host "    Run: cd backend && npm install" -ForegroundColor Gray
    $warnings += "Backend-Deps"
}

# Check 5: Backend build
Write-Host ""
Write-Host "[5/6] Checking backend build..." -ForegroundColor Yellow
if (Test-Path "backend\dist\server.js") {
    Write-Host "[OK] Backend is built" -ForegroundColor Green
} else {
    Write-Host "[!] Backend not built" -ForegroundColor Yellow
    Write-Host "    Run: npm run backend:build" -ForegroundColor Gray
    $warnings += "Backend-Build"
}

# Check 6: Config files
Write-Host ""
Write-Host "[6/6] Checking configuration files..." -ForegroundColor Yellow
if (Test-Path "backend\.env") {
    Write-Host "[OK] backend\.env exists" -ForegroundColor Green
} else {
    Write-Host "[!] backend\.env missing" -ForegroundColor Yellow
    Write-Host "    Will be created from .env.example on first run" -ForegroundColor Gray
    $warnings += "Backend-Config"
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DIAGNOSTIC SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($issues.Count -gt 0) {
    Write-Host "[ERROR] Critical issues found:" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Please fix these issues before continuing." -ForegroundColor Red
} else {
    Write-Host "[OK] No critical issues found!" -ForegroundColor Green
}

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "[WARNING] Non-critical warnings:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "You can still run the frontend-only version." -ForegroundColor Yellow
}

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host ""
    Write-Host "Everything looks good! You can run:" -ForegroundColor Green
    Write-Host "  - .\start_web_only.bat        (Frontend only, no backend)" -ForegroundColor Cyan
    Write-Host "  - .\test_backend_only.bat     (Backend only)" -ForegroundColor Cyan
    Write-Host "  - .\start_be_admin_app.bat    (Full stack)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

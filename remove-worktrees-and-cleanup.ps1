$ErrorActionPreference = "Stop"
$mainRepo = "C:\Users\Nikola Dimovski\RouteCopilot2"
$cursorWorktreesRoot = "C:\Users\Nikola Dimovski\.cursor\worktrees\RouteCopilot2"
if (-not (Test-Path "$mainRepo\.git")) { Write-Host "ERROR: Main repo not found." -ForegroundColor Red; exit 1 }
Write-Host "Cleaning worktree metadata and Cursor worktree copies..." -ForegroundColor Cyan
if (Test-Path "$mainRepo\.git\worktrees") {
    Get-ChildItem "$mainRepo\.git\worktrees" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Removed .git\worktrees\*" -ForegroundColor Green
}
if (Test-Path $cursorWorktreesRoot) {
    Get-ChildItem $cursorWorktreesRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Removed $($_.Name)" -ForegroundColor Gray
    }
}
Write-Host "Done. Reopen Cursor and open: $mainRepo" -ForegroundColor Green

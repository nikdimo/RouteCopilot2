# Optional: Load SSH key passphrase from Windows Credential Manager and add key to ssh-agent.
# Run once: Install-Module CredentialManager -Scope CurrentUser
# Then in Windows: Control Panel -> Credential Manager -> Windows Credentials -> Add a generic credential
#   Address: RouteCopilot2_VPS_SSH
#   User: (any, e.g. "key")
#   Password: (your SSH key passphrase)
# If you use a key WITHOUT passphrase, you can skip this; the deploy bat will still work.

$ErrorActionPreference = 'SilentlyContinue'
if (-not (Get-Module -ListAvailable CredentialManager)) { exit 0 }

$target = 'RouteCopilot2_VPS_SSH'
$keyFile = Join-Path $env:USERPROFILE '.ssh\contabo_nikola'

if (-not (Test-Path $keyFile)) { exit 0 }

try {
    $cred = Get-StoredCredential -Target $target
    if (-not $cred) { exit 0 }
    $pass = $cred.GetNetworkCredential().Password
    if (-not $pass) { exit 0 }

    # Ensure ssh-agent is running (Windows OpenSSH)
    Get-Service ssh-agent -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Running' } | Start-Service -ErrorAction SilentlyContinue

    $pass | & ssh-add $keyFile 2>$null
} catch {
    # Module not installed or credential not found - continue without loading key
}

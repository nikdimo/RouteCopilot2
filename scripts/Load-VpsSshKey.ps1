# Optional: Load SSH key passphrase from Windows Credential Manager and add key to ssh-agent.
# When set up, Deploy_All.bat will not ask for your passphrase.
#
# ONE-TIME SETUP:
# 1. Enable OpenSSH Authentication Agent: Win+R -> services.msc -> find "OpenSSH Authentication Agent"
#    -> Startup type: Manual or Automatic -> Start. (Required so ssh-add can run.)
# 2. In PowerShell (Run as current user): Install-Module CredentialManager -Scope CurrentUser
# 3. In Windows: Control Panel -> Credential Manager -> Windows Credentials -> Add a generic credential
#    Internet or network address: RouteCopilot2_VPS_SSH
#    User name: (any, e.g. "key")
#    Password: (your SSH key passphrase for contabo_nikola)
#
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

# EAS Submit – Credentials Setup

EAS submit needs your Apple ID and App Store Connect App ID. The `@EXPO_*` secret syntax does **not** work for local `eas submit` — it only resolves in EAS cloud builds.

---

## Option 1: Environment variables (recommended, no commit)

**PowerShell:**

```powershell
$env:EXPO_APPLE_ID = "your@apple-id.email"
$env:EXPO_ASC_APP_ID = "1234567890"
$env:EXPO_APPLE_APP_SPECIFIC_PASSWORD = "xxxx-xxxx-xxxx-xxxx"
eas submit --platform ios --profile production --latest
```

- `EXPO_APPLE_ID` – Your Apple ID email  
- `EXPO_ASC_APP_ID` – Numeric App ID from App Store Connect (WisePlan → App Information → Apple ID)  
- `EXPO_APPLE_APP_SPECIFIC_PASSWORD` – [App-specific password](https://appleid.apple.com) (if you use 2FA)

**Note:** You may need to update `eas.json` so it does not override these. If submit still uses values from `eas.json`, use Option 2.

---

## Option 2: Put values in eas.json (simple, but in git)

Edit `eas.json` and replace:

- `YOUR_APPLE_ID_EMAIL` → your Apple ID email  
- `YOUR_ASC_APP_ID` → your numeric App ID (e.g. `1234567890`)

Then run:

```powershell
eas submit --platform ios --profile production --latest
```

To avoid committing secrets, after editing run:

```powershell
git update-index --skip-worktree eas.json
```

Future changes to `eas.json` will not be committed. To undo: `git update-index --no-skip-worktree eas.json`.

---

## App-specific password

If Apple prompts for a password and you have 2FA enabled:

1. Go to https://appleid.apple.com  
2. Sign in → Security → App-Specific Passwords  
3. Generate a new password  
4. Use it as `EXPO_APPLE_APP_SPECIFIC_PASSWORD` or paste when prompted  

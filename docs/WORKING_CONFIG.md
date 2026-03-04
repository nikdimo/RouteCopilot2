# WisePlan – Working Configuration (Protected Snapshot)

**Last verified:** 2026-02-16  
**Status:** ✅ Landing, web app, and Microsoft sign-in work on PC and mobile

**Git tag:** `v1-working-2026-02-16` (restore with `git checkout v1-working-2026-02-16`)

> **Architecture:** See [ARCHITECTURE.md](./ARCHITECTURE.md) for shared map/route logic, `useRouteData`, and platform responsibilities.

---

## How We Got Here (2026-02-16)

- **TestFlight:** Fixed white screen (splash + newArchEnabled: false); EAS build submitted; auth works on device
- **Web auth:** OAuth fixed with localStorage for code_verifier, redirect flow for mobile web, redirect URI https://wiseplan.dk/app/
- **Redirect loop:** Cloudflare SSL = Full; nginx `location = /` block
- **Protection:** This doc, Cursor rule, Git tag created

---

## Features That Work

| Feature | Platform | Status |
|---------|----------|--------|
| **Landing page** | Web (wiseplan.dk) | ✅ Dark theme, hero, App Store / Google Play links, "Open WisePlan in browser" |
| **Sign in with Microsoft** | Web (wiseplan.dk/app/) | ✅ PC Chrome, mobile Chrome/Safari (redirect flow on mobile) |
| **Outlook Calendar** | Web, iOS, Android | ✅ View and sync events |
| **Map view** | Web, iOS, Android | ✅ OSRM routing, pins, polyline, segment bubbles (duration/distance), ETAs |
| **Schedule** | Web, iOS, Android | ✅ Meeting list, tap for details |
| **Mark as done** | Web, iOS, Android | ✅ Persists locally |
| **Plan Visit** | Web, iOS, Android | ✅ Best time suggestions |
| **Profile** | Web, iOS, Android | ✅ Work hours, buffer, lunch |
| **Meeting details** | Web, iOS, Android | ✅ Edit title, time, location, notes; sync to Outlook |
| **TestFlight / Play** | iOS, Android | ✅ Native app builds |

---

## Configuration That Must Stay As-Is

### 1. Nginx (VPS)

**Path:** `/etc/nginx/sites-available/wiseplan`

**Critical:** The `location = /` block prevents redirect loops. Do not remove it.

```nginx
    location = / {
        try_files /index.html =404;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
```

**Restore if broken:**
```bash
# On VPS
sudo cat /etc/nginx/sites-available/wiseplan  # verify config
sudo nginx -t
sudo systemctl reload nginx
```

Full reference config: use `vps-landing/nginx-multi-project.conf` when hosting both WisePlan and eurbanizam on the VPS. For WisePlan-only, use `vps-landing/nginx-wiseplan-domain.conf`. Certbot adds SSL blocks when you run it.

---

### 2. Cloudflare

| Setting | Value | Notes |
|---------|-------|-------|
| **Proxy status** | ON (orange cloud) | Proxied through Cloudflare |
| **SSL/TLS mode** | **Full** or **Full (strict)** | Do NOT use Flexible (causes redirect loop) |
| **DNS** | A @ → 207.180.222.248, A www → 207.180.222.248 | TTL: Auto |

**If redirect loop returns:** Set SSL mode to Full (strict), purge cache (Caching → Purge Everything).

---

### 3. Azure AD – Redirect URIs

**App registration:** Route Copilot (Client ID: b0ca13d2-db5d-4fb6-b1e8-5e89bc631c86)

**Web (Single-page application):**
- `https://wiseplan.dk`
- `https://wiseplan.dk/`
- `https://wiseplan.dk/app`
- `https://wiseplan.dk/app/`
- `http://localhost:8081`
- `http://localhost:8081/`
- `http://localhost:8081/app`
- `http://localhost:8081/app/`

**Native (Mobile and desktop applications):**
- `wiseplan://auth`

---

### 4. VPS – File Locations

| Path | Purpose |
|------|---------|
| `/var/www/wiseplan-test/` | Web root |
| `/var/www/wiseplan-test/index.html` | Landing page |
| `/var/www/wiseplan-test/app/` | Web app (React export) |
| `~/RouteCopilot2` | Git repo (source) |

---

### 5. EAS iOS build (Prebuild)

If **Build_IOS_Testflight.bat** fails with "Unknown error" in the **Prebuild** phase:

1. **Check the real error:** Open the build URL (e.g. `https://expo.dev/accounts/nikdim/projects/wiseplan/builds/...`), open the failed build, expand the **Prebuild** phase and read the log. The CLI only shows "Unknown error"; the web log has the actual message.
2. **react-native-maps + Expo 54:** This project uses `react-native-maps` with the Expo config plugin and version 1.26.6 for compatibility with Expo 54 prebuild (Swift AppDelegate). Do not downgrade to 1.20.1 for iOS EAS builds.
3. **Version source:** `eas.json` sets `cli.appVersionSource: "remote"` so EAS can manage build/version; required in future EAS versions.

**EACCES: permission denied, mkdir '.expo/web':** This is a known EAS Build infrastructure issue ([expo/expo#37550](https://github.com/expo/expo/issues/37550)). The prebuild step (iOS icon generation) uses `@expo/image-utils`, which tries to create `.expo/web/cache/...` in the project directory. On some EAS workers the build user cannot create `.expo` there. Nothing in this repo “broke” it—the same permission denial would occur without any of our hooks. Workarounds: (1) Retry the build later; (2) Upgrade to the latest `expo` and `eas-cli` in case it’s fixed upstream; (3) Report the build URL and log to Expo so they can fix the worker permissions.

---

### 6. Android – rotation / landscape map crash

**Symptom:** App crashes when rotating the phone to landscape on "Today's Route" (expected: schedule on left, map on right).

**Cause:** By default Android recreates the Activity on orientation change; `react-native-maps` can crash when the Activity is destroyed/recreated or when the map is resized during rotation.

**Fix in this repo:**

1. **Config plugin** `plugins/withAndroidConfigChanges.js` sets `android:configChanges` on the main Activity so the Activity is **not** recreated on rotation. This only takes effect after a **new** Android build (prebuild regenerates the manifest).
2. **ScheduleScreen** remounts the embedded map when window dimensions change (`key=embed-${width}-${height}`) so the native MapView is created with the correct size instead of being resized.

**You must run a new prebuild and build** (e.g. `npx expo prebuild --platform android` then build, or a new EAS Android build) for the config plugin to apply. Old APKs built before the plugin was added will still crash on rotate.

---

### 7. Expo Go and react-native-maps

**Expo Go does not include the native module for react-native-maps** (`RNMapsAirModule`). If we load it there, the app crashes with:

`TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found`

So we **never load react-native-maps when `Constants.appOwnership === 'expo'`**: the Map tab shows a placeholder, the Schedule embedded map pane shows a placeholder, and Add Meeting’s map preview/modal show placeholders in Expo Go. Full maps work in **development builds** (EAS Build / TestFlight) and on **web** (Leaflet). Do not remove these Expo Go checks in `AppNavigator`, `ScheduleScreen`, and `AddMeetingScreen`.

---

## Deploy Workflow (Do Not Deviate)

### Push to GitHub
```powershell
# On PC
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
git add .
git commit -m "Your message"
git push origin master
```

### Deploy to VPS

**1. On PC – Build and upload**

Build writes to **`wiseplan-release/`** (sibling of repo), then upload:
```powershell
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
npm run prepare:vps
scp -r ..\wiseplan-release\app\* nikola@207.180.222.248:~/app-deploy/
```

**2. On VPS – Copy to web root**
```bash
sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/
rm -r ~/app-deploy
```

**Landing page + legal docs (index.html, privacy.html, terms.html):** Deploy separately if changed:
```powershell
scp ..\wiseplan-release\index.html ..\wiseplan-release\privacy.html ..\wiseplan-release\terms.html nikola@207.180.222.248:~/
```
```bash
# On VPS
sudo cp ~/index.html ~/privacy.html ~/terms.html /var/www/wiseplan-test/
```

### Pull source on VPS (updates repo only, not deployed files)
```bash
cd ~/RouteCopilot2
git pull origin master
```
**Note:** Pulling only updates the source. The live site is served from `/var/www/wiseplan-test/app/`. To update the live web app you must **build on PC** (output goes to `wiseplan-release/`), then **deploy** (steps 1–2 above), or use `VPS_Deploy_Web.bat` (see below).

### One-click deploy: `Deploy_All.bat`

Runs in order: push to Git (with default or custom commit message) → pull on VPS → build web app → upload to VPS → copy to live site. No manual steps if set up once:

1. **SSH key** – Use a key without passphrase, or store the passphrase in Windows Credential Manager so the script can load it:
   - PowerShell once: `Install-Module CredentialManager -Scope CurrentUser`
   - Control Panel → Credential Manager → Windows Credentials → Add generic credential: address **RouteCopilot2_VPS_SSH**, user (any), password = your SSH key passphrase.
2. **VPS deploy script (one-time)** – `Deploy_All.bat` runs `sudo /usr/local/bin/wiseplan-release-app` on the VPS. Without this, sudo will ask for a password and fail (no TTY). Do this once on the VPS:

   ```bash
   # On the VPS, as root or with sudo:
   sudo tee /usr/local/bin/wiseplan-release-app << 'EOF'
   #!/bin/bash
   set -e
   if [ -d /home/nikola/app-deploy ]; then
     rm -rf /var/www/wiseplan-test/app/*
     cp -r /home/nikola/app-deploy/* /var/www/wiseplan-test/app/
     chown -R www-data:www-data /var/www/wiseplan-test/app
     rm -rf /home/nikola/app-deploy
   fi
   EOF
   sudo chmod 755 /usr/local/bin/wiseplan-release-app

   # Allow nikola to run it without password:
   echo 'nikola ALL=(ALL) NOPASSWD: /usr/local/bin/wiseplan-release-app' | sudo tee /etc/sudoers.d/wiseplan-release
   sudo chmod 440 /etc/sudoers.d/wiseplan-release
   ```

   Then `Deploy_All.bat` can update the live site with no VPS password prompt.

Usage: `Deploy_All.bat` (commit message = "Deploy date time") or `Deploy_All.bat "Your message"`.

### Deploying to a new VPS (rebuild / migrate, no repo on server)

**Principle:** Local repo is the single source of truth. Build locally, deploy only built artifacts. The new VPS never gets the full repo, `node_modules`, or `.expo`. No Telegram bot or other services—static site only.

**1. Local – validate production build**

```powershell
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
npm run prepare:vps
```

This builds the web app and writes **only** to a separate folder **outside** the repo: `c:\Users\Nikola Dimovski\wiseplan-release\` (sibling of `RouteCopilot2`). No build output is written inside the repo. That folder contains: `app/` (built JS/CSS), `index.html`, `privacy.html`, `terms.html`, `assets/`, nginx configs. Optionally serve it locally to confirm:

```powershell
npx serve ..\wiseplan-release
```

Open http://localhost:3000 and http://localhost:3000/app/ (or the port shown); check sign-in if possible. **Deploy bundle = `wiseplan-release/`** (not inside the repo).

**2. New VPS – minimal setup**

- Fresh Ubuntu/Debian; install Nginx (and Certbot if using HTTPS).
- Create web root, e.g. `sudo mkdir -p /var/www/wiseplan && sudo chown $USER:$USER /var/www/wiseplan` (or use `www-data` and deploy with sudo).
- Do **not** clone the repo or run `npm install` on the VPS for the static app.

**3. Deploy – copy only built output**

From your PC, copy **only** the contents of **`wiseplan-release/`** (sibling folder of the repo – no source or repo files inside it).

**Option A – rsync (Git Bash / WSL / Linux):**

```bash
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
npm run prepare:vps
rsync -avz --delete ../wiseplan-release/ USER@NEW_VPS_IP:/var/www/wiseplan/
```

Then on the VPS: copy nginx config and enable site:

```bash
sudo cp /var/www/wiseplan/nginx-wiseplan-domain.conf /etc/nginx/sites-available/wiseplan
# Edit if needed: change root path to /var/www/wiseplan (see below)
sudo ln -sf /etc/nginx/sites-available/wiseplan /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**Option B – SCP (PowerShell):**

```powershell
npm run prepare:vps
scp -r ..\wiseplan-release\app\* USER@NEW_VPS_IP:~/app-deploy/
scp ..\wiseplan-release\index.html ..\wiseplan-release\privacy.html ..\wiseplan-release\terms.html ..\wiseplan-release\nginx-wiseplan-domain.conf USER@NEW_VPS_IP:~/
```

On VPS: move files to `/var/www/wiseplan/`, install nginx config, reload nginx (same as above).

**4. Nginx root path**

The repo’s `vps-landing/nginx-wiseplan-domain.conf` uses `root /var/www/wiseplan-test`. For a new VPS using `/var/www/wiseplan`, either:

- After copying the config to the VPS, run: `sudo sed -i 's|/var/www/wiseplan-test|/var/www/wiseplan|g' /etc/nginx/sites-available/wiseplan`, or  
- Keep the config as-is and create `/var/www/wiseplan-test` and deploy there instead.

**5. DNS and SSL**

Point the domain A record to the new VPS IP. Reload Nginx; run Certbot if you use HTTPS. Cloudflare: set SSL to **Full** or **Full (strict)** (not Flexible).

**Repeatable:** Same flow every time: `npm run prepare:vps` → rsync or scp **`wiseplan-release/`** → reload Nginx. You can use `vps-landing/deploy-to-new-vps.sh` to automate build + rsync (it uses `wiseplan-release/`).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| ERR_TOO_MANY_REDIRECTS | Cloudflare SSL = Flexible | Set SSL to Full (strict) |
| ERR_TOO_MANY_REDIRECTS | Nginx location / redirect loop | Ensure `location = /` block exists |
| Login loops to sign-in screen | Redirect URI mismatch | Add exact URL to Azure; use https://wiseplan.dk/app/ |
| "Session expired" on mobile | HTTP vs HTTPS; localStorage lost | Ensure HTTPS; no client-side http→https redirect |
| Permission denied on scp | Cannot write to /var/www | Use ~/app-deploy then sudo cp |
| No Sign out / old version on wiseplan.dk | Opening root instead of app, or cached build | Use **https://wiseplan.dk/app/** (the app). After deploy: hard refresh (Ctrl+Shift+R) or incognito; if using Cloudflare, purge cache for wiseplan.dk |

---

## Protecting This Version (Git Tag)

To mark this working state and restore later:

```powershell
# Create a tag for this working version
git tag -a v1-working-2026-02-16 -m "Working: landing + web + mobile auth + deploy"

# Push tag to remote
git push origin v1-working-2026-02-16

# To restore to this state later:
# git checkout v1-working-2026-02-16
```

---

## Backup Commands

**Save current nginx config:**
```bash
sudo cp /etc/nginx/sites-available/wiseplan /etc/nginx/sites-available/wiseplan.$(date +%Y%m%d).bak
```

**Restore from backup:**
```bash
sudo cp /etc/nginx/sites-available/wiseplan.YYYYMMDD.bak /etc/nginx/sites-available/wiseplan
sudo nginx -t && sudo systemctl reload nginx
```

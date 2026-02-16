# WisePlan – Working Configuration (Protected Snapshot)

**Last verified:** 2026-02-16  
**Status:** ✅ Landing, web app, and Microsoft sign-in work on PC and mobile

**Git tag:** `v1-working-2026-02-16` (restore with `git checkout v1-working-2026-02-16`)

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
| **Map view** | Web, iOS, Android | ✅ Pins, polyline, directions |
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

Full reference config is in `vps-landing/nginx-wiseplan-domain.conf` (Certbot adds SSL blocks when you run it).

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
```powershell
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
npm run prepare:vps
scp -r vps-landing\app\* nikola@207.180.222.248:~/app-deploy/
```

**2. On VPS – Copy to web root**
```bash
sudo cp -r ~/app-deploy/* /var/www/wiseplan-test/app/
rm -r ~/app-deploy
```

**Landing page + legal docs (index.html, privacy.html, terms.html):** Deploy separately if changed:
```powershell
scp vps-landing\index.html vps-landing\privacy.html vps-landing\terms.html nikola@207.180.222.248:~/
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

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| ERR_TOO_MANY_REDIRECTS | Cloudflare SSL = Flexible | Set SSL to Full (strict) |
| ERR_TOO_MANY_REDIRECTS | Nginx location / redirect loop | Ensure `location = /` block exists |
| Login loops to sign-in screen | Redirect URI mismatch | Add exact URL to Azure; use https://wiseplan.dk/app/ |
| "Session expired" on mobile | HTTP vs HTTPS; localStorage lost | Ensure HTTPS; no client-side http→https redirect |
| Permission denied on scp | Cannot write to /var/www | Use ~/app-deploy then sudo cp |

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

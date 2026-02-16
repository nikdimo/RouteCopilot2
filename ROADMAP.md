# WisePlan – Deployment Roadmap

**Project:** WisePlan (formerly Route Copilot)  
**Last updated:** 2026-02-16

---

## Overview

| Phase | Goal | Status | Notes |
|-------|------|--------|-------|
| 1 | EAS setup | ✅ Done | eas.json, bundle IDs in app.json |
| 2 | TestFlight (iOS) | ✅ Done | White screen fixed; auth works; submitted via EAS |
| 3 | Google Play Internal | ⏳ Pending | After EAS build + submit |
| 4 | VPS landing + web app | ✅ Done | Nginx, landing page, web app at /app/ |
| 5 | Domain + HTTPS | ✅ Done | wiseplan.dk live; Cloudflare SSL Full |
| 6 | Production release | ⏳ Pending | App Store + Play Store |

---

## Where We Are

### Completed
- **App:** Renamed to WisePlan, bundle IDs `com.wiseplan.app`
- **VPS:** Contabo Linux at 207.180.222.248
- **Nginx:** Serving landing page (/) and web app (/app/); `location = /` block prevents redirect loop
- **Domain:** wiseplan.dk live via Cloudflare (DNS → VPS, SSL Full, not Flexible)
- **Azure:** Route Copilot app, redirect URIs for wiseplan.dk, wiseplan.dk/app/, wiseplan://auth, localhost
- **Web auth:** Microsoft sign-in works on PC and mobile (redirect flow for mobile web; localStorage for code_verifier)
- **TestFlight:** iOS build working; white screen fixed (splash + newArchEnabled: false)
- **Git:** Repo at github.com/nikdimo/RouteCopilot2, tag v1-working-2026-02-16
- **Docs:** WORKING_CONFIG.md, Cursor rule for config protection

### In Progress
- **Local login (localhost):** redirect_uri errors – Azure config; production (wiseplan.dk) works

### Not Started
- Google Play internal testing
- App Store / Play Store production

---

## Accomplishments (2026-02-16)

**TestFlight fix:** White screen resolved with `expo-splash-screen` (preventAutoHideAsync, hideAsync) and `newArchEnabled: false` in app.json. EAS build + submit; auth works on device.

**Web/mobile auth fix:** OAuth code exchange was failing (code_verifier lost on redirect). Fixed with: (1) `localStorage` for code_verifier (persists across redirect); (2) redirect flow for mobile web instead of popup; (3) production redirect URI `https://wiseplan.dk/app/`; (4) landing page script redirects `?code=` to `/app/` so exchange completes.

**ERR_TOO_MANY_REDIRECTS:** Cloudflare SSL set to Full (not Flexible). Nginx `location = / { try_files /index.html =404; }` added to prevent root redirect loop.

**Protection:** Created WORKING_CONFIG.md, .cursor/rules/wiseplan-config-protection.mdc, Git tag v1-working-2026-02-16.

---

## Problems (Reference – Some Fixed)

### 1. Local development – Microsoft login fails (still open)
**Symptom:** `invalid_request: redirect_uri is not valid` when signing in at localhost  
**Cause:** Azure rejecting the exact redirect_uri the app sends  
**Tried:** Adding localhost variants to Azure Single-page application  
**Status:** Still failing; production (wiseplan.dk/app/) works

### 2. VPS – OAuth code not exchanged (fixed)
**Was:** User returns with `?code=...` but stays on login screen  
**Fix:** localStorage for code_verifier; redirect flow for mobile; landing page redirects ?code= to /app/

### 3. Cloudflare tunnel – unstable URL (obsolete)
**Was:** Quick tunnel URL changes on reboot  
**Fix:** Use wiseplan.dk with Cloudflare DNS (not tunnel)

### 4. ERR_TOO_MANY_REDIRECTS (fixed)
**Was:** Infinite redirect loop  
**Fix:** Cloudflare SSL = Full; nginx `location = /` block

### 5. Blank /app/ page (fixed)
**Was:** App at /app/ showed blank – assets at /_expo/ returned 404  
**Fix:** Nginx alias `/_expo/` → app folder; baseUrl in app.json

---

## Next Steps (in order)

1. **Google Play Internal** – EAS build + submit for Android
2. **Landing page** – Update vps-landing/index.html with TestFlight/Play links when ready; deploy to VPS root
3. **Local login (optional)** – Fix localhost redirect_uri if needed for dev
4. **Production release** – App Store + Play Store when ready

---

## File References

| File | Purpose |
|------|---------|
| `ROADMAP.md` | This file – status, problems, next steps |
| `WORKING_CONFIG.md` | Protected config – deploy workflow, nginx, Cloudflare, Azure, revert |
| `DOMAIN_AND_AZURE_SETUP.md` | Specs: domain → VPS, SSL, Azure redirect URIs |
| `CURRENT_STATE.md` | App features, Phase 7, QA notes, recent accomplishments |
| `SPEC.md` | Phase 7 smart scheduling logic |
| `vps-landing/` | Landing page (index.html), nginx config, setup scripts |
| `eas.json` | EAS build/submit profiles |

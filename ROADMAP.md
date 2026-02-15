# WisePlan – Deployment Roadmap

**Project:** WisePlan (formerly Route Copilot)  
**Last updated:** 2026-02-13

---

## Overview

| Phase | Goal | Status | Notes |
|-------|------|--------|-------|
| 1 | EAS setup | ✅ Done | eas.json, bundle IDs in app.json |
| 2 | TestFlight (iOS) | ⏳ Pending | After EAS build + submit |
| 3 | Google Play Internal | ⏳ Pending | After EAS build + submit |
| 4 | VPS landing + web app | ✅ Done | Nginx, landing page, web app at /app/ |
| 5 | Domain + HTTPS | 🔄 In progress | wiseplan.dk purchased |
| 6 | Production release | ⏳ Pending | App Store + Play Store |

---

## Where We Are

### Completed
- **App:** Renamed to WisePlan, bundle IDs `com.wiseplan.app`
- **VPS:** Contabo Linux at 207.180.222.248
- **Nginx:** Serving landing page (/) and web app (/app/)
- **Cloudflare tunnel:** Was used for HTTPS (quick tunnel), URL changes on reboot
- **Azure:** Route Copilot app, redirect URIs for Cloudflare URLs and localhost
- **Git:** Repo at github.com/nikdimo/RouteCopilot2, vps-landing in repo

### In Progress
- **Domain:** wiseplan.dk purchased – needs DNS, SSL, nginx update
- **Local login:** redirect_uri errors with localhost – Azure config not accepting
- **VPS login:** OAuth code exchange sometimes fails (code_verifier/session lost)

### Not Started
- EAS iOS/Android builds
- TestFlight + Play internal testing
- App Store / Play Store production

---

## Problems We're Facing

### 1. Local development – Microsoft login fails
**Symptom:** `invalid_request: redirect_uri is not valid` when signing in at localhost:8086  
**Cause:** Azure rejecting the exact redirect_uri the app sends  
**Tried:** Adding `http://localhost:8086` and `http://localhost:8086/` to Azure Single-page application  
**Status:** Still failing – URI format mismatch or Azure config issue

### 2. VPS – OAuth code not exchanged
**Symptom:** User returns from Microsoft with `?code=...` in URL but stays on login screen  
**Cause:** code_verifier lost (PKCE) or redirect path mismatch; possible landing-page redirect from / to /app/ loses session  
**Tried:** Landing page redirect to /app/ when URL has ?code=; LoginScreen forces /app in redirectUri for web  
**Status:** Intermittent – fresh flow sometimes works

### 3. Cloudflare tunnel – unstable URL
**Symptom:** URL (e.g. corporate-competitors-bid-riders.trycloudflare.com) changes when tunnel restarts  
**Cause:** Quick tunnel assigns new random URL each run  
**Fix:** Use domain wiseplan.dk with Let's Encrypt – stable URLs

### 4. Blank /app/ page (fixed)
**Was:** App at /app/ showed blank – assets at /_expo/ returned 404  
**Fix:** Nginx alias `/ _expo/` → app folder; added baseUrl to app.json for future builds

---

## Next Steps (in order)

1. **Set up wiseplan.dk** – DNS → VPS, certbot SSL, nginx config (see DOMAIN_AND_AZURE_SETUP.md)
2. **Update Azure** – Add https://wiseplan.dk and https://wiseplan.dk/app (with/without trailing slash)
3. **Stop Cloudflare tunnel** – Use domain directly
4. **Retest login** – At https://wiseplan.dk/app/
5. **EAS builds** – When ready: iOS → TestFlight, Android → Play internal
6. **Update landing page** – Add TestFlight + Play links when available

---

## File References

| File | Purpose |
|------|---------|
| `ROADMAP.md` | This file – status, problems, next steps |
| `DOMAIN_AND_AZURE_SETUP.md` | Specs: domain → VPS, SSL, Azure redirect URIs |
| `CURRENT_STATE.md` | App features, Phase 7, QA notes |
| `SPEC.md` | Phase 7 smart scheduling logic |
| `vps-landing/` | Landing page, nginx config, setup scripts |
| `eas.json` | EAS build/submit profiles |

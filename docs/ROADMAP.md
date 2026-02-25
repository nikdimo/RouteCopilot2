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
| `docs/ROADMAP.md` | This file – status, problems, next steps |
| `docs/WORKING_CONFIG.md` | Protected config – deploy workflow, nginx, Cloudflare, Azure, revert |
| `docs/DOMAIN_AND_AZURE_SETUP.md` | Specs: domain → VPS, SSL, Azure redirect URIs |
| `docs/CURRENT_STATE.md` | App features, Phase 7, QA notes, recent accomplishments |
| `docs/SPEC.md` | Phase 7 smart scheduling logic |
| `vps-landing/` | Landing page (index.html), nginx config, setup scripts |
| `eas.json` | EAS build/submit profiles |

---

## Performance & UX Optimization Roadmap

Plan to improve perceived speed and performance: what to load first, what runs in background, and optional VPS-backed caches. **Scope:** Excludes Microsoft Graph calendar data on server (privacy/compliance); VPS only for geocode/OSRM cache and app state.

### Current Bottlenecks

- **Duplicate today load** — RootNavigator and SelectedDateSync both fetch today on startup (~50% redundant Graph calls).
- **Initial load** — 1–3 s spinner until first meetings appear.
- **Map first view** — 600 ms–2 s until polylines (OSRM + map ready).
- **Enrichment** — If sequential: geocode then contact lookup adds 1–5 s.
- **Day switch** — Re-fetch if not in dayCache; ±1 day can be prefetched.
- **OSRM debounce** — 350 ms + 500 ms–2 s per reorder.

---

### Phase 1: Quick Wins (No VPS) — ~1 day

**Priority order:**

1. **Remove duplicate today load** — Delete RootNavigator `useLoadAppointmentsForDate(undefined)`; let SelectedDateSync be single source. Impact: ~50% fewer Graph calls on startup.
2. **Parallelize enrichment** — `services/graph.ts`: `Promise.all([geocode, contacts])` if still sequential. Impact: 2–3 s → ~1 s enrichment.
3. **Skeleton loaders** — ScheduleScreen: 3–5 card skeletons while loading; MapScreen: home marker + loading overlay. Impact: Perceived load time cut in half.
4. **Cache tuning** — Meeting counts TTL 4 h → 8 h; OSRM debounce 350 ms → 250 ms; ensure ±1 day prefetch on idle. Impact: Day switching feels instant for adjacent days.

**Estimated effort:** 4–6 h. **Risk:** Very low (all client-side).

---

### Phase 2: Progressive Map Loading — ~0.5 day

- Show home marker immediately (already done).
- If previous session cached route in AsyncStorage → show faded polyline from last session.
- Calculate OSRM in background; replace with fresh route when resolved.
- Optional: haversine ETA estimates while OSRM loads.

**Impact:** Map interactive in ~100 ms vs 600–2000 ms. **Effort:** 2–3 h. **Risk:** Low.

---

### Phase 3: VPS Backend — Geocode + OSRM Cache — 2–3 days

**Scope (explicitly NOT including Graph data):**

- **Include:** `POST /api/geocode` (address → coordinates cache), `POST /api/route` (waypoints → OSRM polyline cache), `GET/POST /api/user/state` (completed IDs, custom order).
- **Exclude:** Microsoft Graph calendar caching; user PII/meeting content storage.

**Database tables:** `geocode_cache` (shared), `osrm_routes` (shared), `user_app_state` (user_id, completed_ids, day_order). **Auth:** Microsoft OAuth token validation (no new login).

**Estimated effort:** 2–3 days. **Risk:** Medium (new infra, isolated from user data).

---

### Phase 4: Multi-Device Sync (Optional) — 1–2 days

Once VPS exists: sync completed_ids and custom meeting order across devices; real-time via polling (e.g. 60 s) or WebSocket. **Does NOT sync Graph data** — app state only.

---

### Refinements & Boundaries

- **VPS DB scope** — Safe on VPS: geocode results, OSRM routes, user app state (completed IDs, order). Separate decision: caching Graph calendar data (PII/compliance).
- **Meeting counts** — On web already sync from localStorage; on native AsyncStorage is async. Win: use cached counts as soon as they resolve + extend TTL to 8 h.
- **OSRM debounce** — 250 ms recommended (not 200 ms) to avoid excess calls during rapid drag.

---

### Recommended Order

Start with **Phase 1** (quick wins): remove duplicate load, parallelize enrichment, skeleton loaders. Then choose: Phase 2 (progressive map), Phase 3 (VPS backend), or Phase 4 (sync) as needed.

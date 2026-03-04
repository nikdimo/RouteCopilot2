# WisePlan – Deployment Roadmap

**Project:** WisePlan (formerly Route Copilot)  
**Last updated:** 2026-02-27

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
- **VPS:** Deploy moved to new VPS; app and landing served from new server. (Previous: Contabo 207.180.222.248.)
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
5. **Backend Phase 3** – See [SaaS & Backend Development Roadmap](#saas--backend-development-roadmap): full schema, geocode/route/user-state APIs

---

## Immediate Next Steps (Billing Go-Live)

1. **Run full local billing QA**
   - Verify homepage `Subscribe` button opens `/billing/`.
   - Verify billing page loads plan catalog and feature matrix.
   - Verify account billing page loads status/invoices.
   - Verify in-app locked-feature upgrade prompts deep-link to billing.
2. **Choose billing mode for rollout**
   - `mock` for internal testing only.
   - `stripe` for real payments.
3. **Prepare VPS production environment**
   - Confirm backend env values: `DATABASE_URL`, billing provider env, Stripe keys, webhook secret, `BILLING_FRONTEND_BASE_URL`.
   - Confirm DB migrations run cleanly on VPS.
4. **Deploy and smoke test**
   - Deploy backend + landing/billing pages.
   - Test `/billing`, `/account/billing`, checkout flow, and webhook-driven status transitions.
5. **Release lock and security pass**
   - Rotate any previously exposed API keys.
   - Take DB backup snapshot before launch.
   - Update operational docs/runbook with final production values and rollback steps.
6. **Store-policy billing compliance gate (iOS/Android)**
   - Validate external billing-link policy for each storefront before production submission.
   - Decide and document platform behavior (external web billing, native IAP, or hybrid policy-based flow) prior to release candidate build.

---

## VPS Staging Rollout Plan (Backend + Billing While UI Is Still In Progress)

**Objective (March 2, 2026):** Reduce local startup delays by moving backend + billing flows to an always-on VPS staging environment now, while continuing UI work locally.

### Why this now
- Local development is slowed down by repeatedly starting backend + billing services.
- Backend/billing can be stabilized independently from UI polish.
- A staging-first rollout lowers risk versus direct production launch.

### Scope
- **In scope now:** VPS staging backend, DB migrations, billing pages, webhook flow, app->staging API wiring for local testing.
- **Not in scope now:** Final production cutover, final UI polish, app-store release gating.

### Phase Plan

1. **Phase A - Staging foundation (1-2 days)**
   - Provision staging runtime (process manager/service), Postgres, TLS, env files, backups.
   - Define staging URLs for API and billing pages.
   - Exit criteria: backend health endpoint and DB connectivity are stable after restart/reboot.

2. **Phase B - Backend + schema deploy (1 day)**
   - Deploy backend build to VPS staging.
   - Run migrations and verify billing-related tables and seed data are present.
   - Exit criteria: `/api/public/plans`, `/api/billing/me`, `/api/billing/checkout-session` respond correctly in staging.

3. **Phase C - Billing web + webhook validation (1 day)**
   - Deploy `/billing` and `/account/billing` pages to staging.
   - Configure billing provider in test mode and webhook secret.
   - Validate end-to-end: checkout -> webhook -> subscription state update -> account page reflects paid status.
   - Exit criteria: idempotent webhook handling verified with repeated event delivery.

4. **Phase D - Local UI against staging backend (0.5-1 day)**
   - Point local app to staging backend for day-to-day UI work.
   - Keep local backend startup only as fallback.
   - Exit criteria: local UI iteration works without starting full local backend stack each cycle.

5. **Phase E - Production readiness gate (after UI stabilizes)**
   - Security pass: rotate keys, verify secrets, confirm CORS/rate limits.
   - Ops pass: backup snapshot + rollback steps documented and tested.
   - Business pass: billing flows + invoices + entitlement gating signed off.
   - Exit criteria: explicit go-live approval for production cutover.

### Success Metrics
- Local iteration no longer blocked by backend startup time.
- Staging billing flow is reproducible and stable (including webhook-driven state transitions).
- Production cutover becomes a controlled final step, not a prerequisite for UI completion.

---

## File References

| File | Purpose |
|------|---------|
| `docs/ROADMAP.md` | This file – status, problems, next steps, SaaS & backend phases |
| `docs/WORKING_CONFIG.md` | Protected config – deploy workflow, nginx, Cloudflare, Azure, revert |
| `docs/DOMAIN_AND_AZURE_SETUP.md` | Specs: domain → VPS, SSL, Azure redirect URIs |
| `docs/CURRENT_STATE.md` | App features, Phase 7, QA notes, recent accomplishments |
| `docs/SPEC.md` | Phase 7 smart scheduling logic |
| `docs/DECISION_SHEET_V1.md` | SaaS contract: statuses, roles, entitlement keys, promo rules |
| `vps-landing/` | Landing page (index.html), nginx config, setup scripts |
| `eas.json` | EAS build/submit profiles |
| Dev app → Scopes tab | In-app list of OAuth/API scopes (src/screens/DevDocsScreen.tsx) |

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

### Phase 1: Quick Wins (No VPS) — ~1 day ✅ Done

- Remove duplicate today load (SelectedDateSync single source). ✅
- Parallelize enrichment (Promise.all in graph.ts). ✅
- Skeleton loaders (ScheduleScreen + MapScreen overlay). ✅
- Cache tuning (8 h counts, 250 ms OSRM, ±1 day prefetch). ✅
- DaySlider dot fix (delete decrements count; Refresh refetches; web Refresh button). ✅

---

### Phase 2: Progressive Map Loading — ~0.5 day ✅ Done

- Last-session route cache in AsyncStorage; faded polyline while OSRM loads. ✅
- OSRM in background; replace with fresh route when resolved. ✅
- Haversine ETAs used when OSRM not ready. ✅

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

Phase 1 and Phase 2 done. **Next:** Phase 3 (VPS backend + DB on new VPS). Then Phase 4 (multi-device sync) and Phase 5 (billing integration).

---

## SaaS & Backend Development Roadmap

Full schema now, staged implementation (Option B). Backend lives in `backend/`; API at **api.wiseplan.dk**; user app at **wiseplan.dk/app**; admin at **admin.wiseplan.dk**.

### Backend development phases (overview)

| Phase | Goal | Status | Est. |
|-------|------|--------|------|
| **3** | VPS backend: full schema, geocode + route + user state APIs | ⏳ Pending | 2–3 days |
| **4** | Auth + tenant + entitlements core (users, auth_identities, orgs, roles) | ⏳ Pending | 3–5 days |
| **5** | Billing (Stripe, plans, subscriptions, webhooks, idempotency) | ⏳ Pending | 5–7 days |
| **6** | Admin panel MVP (admin.wiseplan.dk: plans, subs, promos, audit) | ⏳ Pending | 4–6 days |
| **7** | Multi-device sync (optional; app state across devices) | ⏳ Pending | 1–2 days |
| **8** | Usage metering, observability, backups, restore drills | ⏳ Pending | 2–3 days |

### Locked decisions (baseline)

- **Schema:** Full SaaS schema from day one (users, auth_identities, organizations, plans, subscriptions, entitlements, caches, audit, usage, webhook log).
- **Tier source of truth:** `docs/BUSINESS_PLAN_TIERS.md` defines plan/tier content ("what"). This roadmap defines implementation sequencing ("when/how").
- **Tenants:** One org per user in v1; multi-user orgs later without schema rewrite.
- **Auth:** auth_identities from day one (Microsoft only at launch; add providers later).
- **Admin:** admin.wiseplan.dk only; RBAC + audit logs; allowlist table for admin access (Azure group optional later).
- **Privacy:** Store email in DB for support lookup; document in privacy policy; support delete/export.
- **Cache TTL:** Geocode 90 days, route cache 30 days; app state no TTL (user-owned), soft-delete support.
- **Billing:** Paid status from webhooks only; entitlements enforced in backend (frontend checks UX-only).
- **Webhooks:** Idempotency + replay protection from day one. Usage metering tables from day one (for future usage-based pricing).

### Phase 3: VPS Backend — full schema, cache APIs (2–3 days)

- **Scope:** Geocode cache, OSRM route cache, user app state (completed IDs, day order). No Graph/calendar content on server.
- **Deliverables:** `backend/` with migrations for full schema (see Phase 4 for table list); API endpoints: `POST /api/geocode`, `POST /api/route`, `GET/POST /api/user/state`. Microsoft OAuth token validation. PostgreSQL on VPS (private interface); Nginx in front (TLS, routing, rate limit).
- **DB tables (Phase 3 surface):** geocode_cache, osrm_route_cache (or route_cache), user_app_state_daily; plus schema placeholders for users, auth_identities, organizations, etc. for Phase 4.

### Phase 4: Auth + tenant + entitlements core (3–5 days)

- **Deliverables:** users, auth_identities, organizations, organization_members (roles: owner/admin/member), provider_accounts, connected_calendars, user_notification_preferences, plans, plan_entitlements, org_entitlement_overrides (optional), admin_allowlist, admin_audit_log. Token validation and role checks. One org per user on first signup.
- **Enforcement:** All entitlement checks in backend; frontend only for UX (e.g. hiding paywalled features).

### Phase 5: Billing integration (5–7 days)

- **Deliverables:** Stripe (or one provider) integration; plans, plan_prices, plan_allowances, subscriptions, subscription_events, invoices, payments, coupons, promotions, promotion_redemptions. Webhook endpoint with idempotency (webhook_event_log) and replay protection. Paid status only from webhook-derived state.
- **Scope boundary:** This phase implements billing and entitlement plumbing only (the "how/when"). Product tier definitions, feature matrix, and tier copy are owned by `docs/BUSINESS_PLAN_TIERS.md` (the "what").

### Phase 6: Admin panel MVP (4–6 days)

- **URL:** admin.wiseplan.dk (separate app shell).
- **Features:** Plans & pricing catalog; subscription/customer management; manual entitlement overrides (with reason and expiry); promotions tab (discounts, duration, max redemptions, plan scope); user/org lookup and support actions; calendar-link limits view (Basic=1 calendar), cache operations (invalidate geocode/route); consent/opt-out/message log views for Premium messaging; audit and webhook health dashboard.
- **Auth:** Allowlist table; strict RBAC; every action audited.

### Phase 7: Multi-device sync (1–2 days, optional)

- Sync completed_event_ids and day_order across devices (polling or WebSocket). App state only; no Graph data on server.

### Phase 8: Usage metering, observability, backups (2–3 days)

- **Usage:** usage_events or equivalent for future usage-based pricing; no schema change later.
- **Observability:** Structured logs, error tracking, API latency and cache hit metrics.
- **Operations:** Backup schedule, restore drills, key rotation runbook.

### Tier-driven DB requirements (from BUSINESS_PLAN_TIERS.md)

- **Calendar limits (Basic vs Pro/Premium):** `provider_accounts`, `connected_calendars` (+ per-tier entitlement checks).
- **Running-late behavior:** `user_notification_preferences` (late threshold, "notify me" toggles, default channel policy).
- **Premium consent/compliance:** `client_message_consents`, `client_message_opt_outs`, `message_audit_log` (who, what, when, channel, outcome).
- **Premium messaging pipeline:** `notification_jobs`, `notification_deliveries` (email/SMS provider IDs, delivery status, retries).
- **Recurring templates:** `recurring_meeting_templates`.
- **Export day plan:** `export_jobs`, `shared_exports` (expirable links or file references).
- **Allowances/overage economics:** `plan_allowances`, `usage_events`, `usage_counters_monthly` (SMS/email/AI units for billing guardrails).

### Reference: full table list (for schema design)

- **Identity & tenants:** users, auth_identities, organizations, organization_members, provider_accounts, connected_calendars
- **Billing:** plans, plan_prices, plan_allowances, subscriptions, subscription_events, invoices, payments, coupons, promotions, promotion_redemptions
- **Entitlements:** features, plan_entitlements, org_entitlement_overrides
- **Messaging & compliance:** user_notification_preferences, client_message_consents, client_message_opt_outs, notification_jobs, notification_deliveries, message_audit_log
- **Product artifacts:** recurring_meeting_templates, export_jobs, shared_exports
- **App & cache:** user_app_state_daily, geocode_cache, route_cache (or osrm_route_cache)
- **Operations:** webhook_event_log, admin_audit_log, usage_events, usage_counters_monthly
- **Admin:** admin_allowlist (or equivalent)

See **Decision Sheet v1** (`docs/DECISION_SHEET_V1.md`) for exact statuses, role matrix, entitlement keys, promo rules, and lifecycle states.

---

## DB build plan (Phase 3)

**Where to build the DB and backend**

- **Not in the deploy folder** (`wiseplan-release`). That folder is for **built static output** (what you rsync to the VPS). It should not contain source code, migrations, or API.
- **Recommended: in the main app repo** (`RouteCopilot2`), in a new **`backend/`** folder. That gives:
  - One repo for app + API + migrations (versioned together).
  - Same clone has everything; deploy script can build the app and deploy backend to the VPS.
- **Contents of `backend/`:** Migration files (SQL or a migration tool), Node API (Express), `package.json`, `.env.example`. Run PostgreSQL **locally** (Docker or native) for development; run migrations on the **new VPS** when deploying.

**Steps:** (1) Add `backend/` to RouteCopilot2 with schema and migrations. (2) Run Postgres locally, run migrations, develop API. (3) On new VPS: install Postgres, run same migrations, deploy API. (4) Point app to API when ready.

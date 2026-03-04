# WisePlan Backend

Backend service for WisePlan APIs on VPS (cache/state, feature access, admin, billing).

## Scope in this implementation

- `POST /api/geocode` -> geocode cache (Nominatim provider)
- `POST /api/route` -> OSRM route cache
- `GET /api/user/state?dayKey=YYYY-MM-DD`
- `POST /api/user/state`
- `GET/PATCH /api/me/features` -> backend-owned feature toggles and entitlement state
- `GET /api/public/plans`
- `POST /api/billing/webhook`
- `GET /api/billing/me`
- `POST /api/billing/checkout-session`
- `POST /api/billing/customer-portal-session`
- `POST /api/billing/promo/validate`
- `GET /api/billing/invoices`
- `POST /api/billing/mock/complete-checkout` (dev/mock)
- `GET/POST/DELETE /api/admin/*` -> admin MVP routes (allowlist, tier overrides, audit, user/org lookup)
- Microsoft JWT validation (Azure mode) or local dev auth bypass (dev mode)
- SQL migrations + migration runner

## Important privacy boundary

This backend intentionally does **not** store Microsoft Graph meeting content (title/body/attendees/notes). It stores:

- geocode cache
- route cache
- user app state (completed IDs + day order)
- identity scaffolding for auth linkage

## Quick start

1. Copy env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Run migration:

```bash
npm run migrate
```

4. Start in dev mode:

```bash
npm run dev
```

Server health:

- `GET /healthz`
- `GET /api/health`

## Auth modes

- `AUTH_MODE=dev`: bypass JWT verification and auto-provision a local dev user.
- `AUTH_MODE=azure`: verify Bearer token via Microsoft Entra JWKS (`AZURE_TENANT_ID`, `AZURE_AUDIENCE` required).

## Notes for parallel work

- This folder is intentionally self-contained (`backend/`).
- Billing webhook idempotency is enforced with `webhook_event_log` and duplicate-event handling.
- Billing routes are rate-limited and CORS can be restricted via `CORS_ALLOWED_ORIGINS`.

## Admin MVP routes

All admin routes are under `/api/admin` and require:

- authenticated user (`requireAuth`)
- admin allowlist membership (`admin_allowlist`)

`super_admin` is required for allowlist modifications.

In `AUTH_MODE=dev`, first admin request auto-bootstraps current dev user as `super_admin` (local convenience only).

## Frontend feature flag

The app uses backend APIs only when both vars are set in the frontend environment:

- `EXPO_PUBLIC_ENABLE_VPS_BACKEND=true`
- `EXPO_PUBLIC_BACKEND_API_URL=https://api.wiseplan.dk`

When disabled or unavailable, geocoding, OSRM, and day-state logic fall back to existing local behavior.

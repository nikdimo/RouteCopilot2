# WisePlan Admin Panel MVP

## Scope

Admin MVP is a separate web surface intended for `admin.wiseplan.dk` (best practice), not embedded in the user app UI.

Current implementation includes:

- Admin authentication gate via `admin_allowlist`
- Admin role model: `support_admin`, `super_admin`
- User search and view
- Temporary tier overrides (`free|basic|pro|premium`) in `user_tier_overrides`
- Admin allowlist management (super admin only)
- User app-state inspection (`user_app_state_daily`)
- Admin audit log viewing (`admin_audit_log`)

Not included yet:

- Billing catalog management (plans/prices/subscriptions/promotions)
- Stripe/webhook operations UI
- Entitlement engine UI

## Local run

1. Start backend:

```powershell
npm run backend:migrate
npm run backend:dev
```

If `backend:migrate` fails with `spawn EPERM` in your shell, run:

```powershell
npm run backend:migrate:build
```

If `backend:dev` also fails with `spawn EPERM`, run backend with compiled output:

```powershell
npm run backend:start:build
```

2. Serve admin panel:

```powershell
npm run admin:serve
```

3. Open:

- `http://localhost:5175`

4. In admin panel:

- API Base URL: `http://localhost:4000/api`
- Token: optional when backend uses `AUTH_MODE=dev`

## One-command local startup

You can also run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-admin-local.ps1
```

This will:

- run migrations
- start backend in a new terminal window
- start admin panel server in a new terminal window
- print readiness status

## Security notes

- In `AUTH_MODE=dev`, first admin request auto-bootstraps current dev user as `super_admin` to prevent local lockout.
- In production (`AUTH_MODE=azure`), user must exist in `admin_allowlist`.
- Every mutable admin action writes to `admin_audit_log`.

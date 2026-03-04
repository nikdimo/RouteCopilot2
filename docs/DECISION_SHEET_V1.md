# WisePlan - Decision Sheet v1

**Last updated:** 2026-02-27  
**Purpose:** Implementation contract for SaaS backend and billing. This document locks lifecycle states, roles, entitlement keys, promo rules, and DB coverage for BUSINESS_PLAN_TIERS.

---

## 1. Source-of-truth boundaries

- **Tier/package content ("what"):** `docs/BUSINESS_PLAN_TIERS.md`
- **Delivery sequencing ("when/how"):** `docs/ROADMAP.md` (SaaS & Backend Development Roadmap)
- **This file:** canonical technical contract for backend and admin implementation details.

---

## 2. Locked architecture decisions

- Full SaaS schema from day one (staged rollout, no major schema rewrite later).
- One organization per user in v1.
- Auth model uses `users` + `auth_identities` (Microsoft first; more providers later).
- Admin UI only at `admin.wiseplan.dk`.
- Backend RBAC is mandatory; frontend gating is UX-only.
- Paid state is webhook-derived only.
- Webhook idempotency and replay protection are mandatory from first billing release.
- VPS DB scope excludes Graph meeting content and calendar payload storage.

---

## 3. Roles and permissions

| Role | Scope | Examples |
|------|-------|----------|
| `member` | End-user app | Calendar sync, route, plan visit within entitlements |
| `org_admin` | Org-level account admin (future multi-user orgs) | Manage org settings, seats (future) |
| `support_admin` | Internal support | Read user/org, troubleshoot, limited override actions |
| `super_admin` | Internal platform admin | Plans, pricing, promotions, full override authority |

**Admin access policy (v1):**
- Backed by `admin_allowlist`.
- Every admin action is written to `admin_audit_log`.

---

## 4. Subscription lifecycle states

**Canonical `subscriptions.status`:**
- `trialing`
- `active`
- `past_due`
- `canceled`
- `unpaid`
- `incomplete`
- `incomplete_expired`

**Rule:** Entitlements are derived from normalized subscription state + overrides, not from client-side flags.

---

## 5. Entitlement keys (tier mapping baseline)

| Key | Free | Basic | Pro | Premium |
|-----|------|-------|-----|---------|
| `calendar.sync.enabled` | false | true | true | true |
| `calendar.sync.max_calendars` | 0 | 1 | -1 (unlimited) | -1 (unlimited) |
| `contacts.create.enabled` | false | true | true | true |
| `geocode.provider.premium` | false | true | true | true |
| `routing.traffic.enabled` | false | false | true | true |
| `alerts.running_late.self` | false | false | true | true |
| `routing.optimize.enabled` | false | false | true | true |
| `export.day_plan.enabled` | false | false | true | true |
| `templates.recurring.enabled` | false | false | true | true |
| `assistant.client_notify.enabled` | false | false | false | true |
| `assistant.client_notify.sms` | false | false | false | true |
| `assistant.client_notify.email` | false | false | false | true |

**Notes:**
- `-1` means unlimited.
- Premium client messaging still requires consent/opt-in checks.

---

## 6. Promotions rules (v1)

- Supported discount types: `percent_off`, `amount_off`.
- Promotion scope: by plan, billing interval, optional region/currency.
- Limits: `max_redemptions`, `max_redemptions_per_org`, `redeem_by`.
- Duration types: `once`, `repeating(months)`, `forever`.
- Stacking: disabled in v1 (one promo per subscription checkout).
- Trial compatibility: allowed unless promo explicitly marks `exclude_trial=true`.

---

## 7. DB coverage required for BUSINESS_PLAN_TIERS

### Identity and tenant

- `users`
- `auth_identities`
- `organizations`
- `organization_members`
- `provider_accounts`
- `connected_calendars`

### Billing and promotions

- `plans`
- `plan_prices`
- `plan_allowances`
- `subscriptions`
- `subscription_events`
- `invoices`
- `payments`
- `coupons`
- `promotions`
- `promotion_redemptions`

### Entitlements

- `features`
- `plan_entitlements`
- `org_entitlement_overrides`

### Messaging and compliance (Premium)

- `user_notification_preferences`
- `client_message_consents`
- `client_message_opt_outs`
- `notification_jobs`
- `notification_deliveries`
- `message_audit_log`

### Product artifacts

- `recurring_meeting_templates`
- `export_jobs`
- `shared_exports`

### App/cache and operations

- `user_app_state_daily`
- `geocode_cache`
- `route_cache`
- `webhook_event_log`
- `admin_audit_log`
- `usage_events`
- `usage_counters_monthly`
- `admin_allowlist`

---

## 8. Privacy and retention baseline

- No server-side storage of Graph meeting body/title/attendees/notes.
- Email stored for support lookup and account operations.
- Cache TTL defaults:
  - Geocode: 90 days
  - Route cache: 30 days
- App state sync retained as user-owned data; soft delete available.
- Message and consent logs retained per compliance policy; exact retention window to be finalized with legal.

---

## 9. Open decisions before implementation start

- Final legal retention windows for consent/opt-out/message logs by region.
- Late-threshold default (for example 5 vs 10 minutes) and user-level override policy.
- Included monthly allowances and overage pricing for SMS/email/AI in Premium.
- First provider choice for transactional email and SMS.

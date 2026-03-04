# WisePlan Plans, Sign-In, and Billing Spec (App Store-Safe)

Last updated: 2026-03-02
Status: Proposed for implementation
Owner: Product + Engineering

## 1. Purpose

Define a single, implementable plan for:

- free-first onboarding
- paid feature upgrade flow
- sign-in timing
- platform-safe billing behavior
- entitlement consistency
- account deletion and promo operations

This spec is written to be usable by product, design, frontend, backend, and admin tooling workstreams.

## 2. Goals and Non-Goals

### 2.1 Goals

- Let users start with free features without forced sign-in.
- Show plans before auth to maximize conversion.
- Ask for sign-in only when required for account-bound actions.
- Keep pricing public and billing account views private.
- Reduce App Store and Play Store rejection risk.
- Keep backend as single source of truth for entitlements.
- Make paid feature resume seamless after auth/payment.

### 2.2 Non-Goals

- Full legal/compliance policy interpretation for every country.
- Immediate multi-seat enterprise org model.
- Full redesign of current UI language and branding.

## 3. Product Decision Summary

### 3.1 Core upgrade flow

Primary sequence:

1. User selects plan.
2. User signs in (if not signed in).
3. User completes platform-appropriate payment flow.
4. App refreshes entitlements from backend.
5. App resumes original user intent (for example, connect calendar).

### 3.2 Information architecture split

- `Pricing`: public, no auth required.
- `Billing`: authenticated, account-specific data only.

### 3.3 Sign-in timing rule

Do not ask at startup.
Ask when user starts:

- checkout
- billing/account management
- cloud sync/account-bound setup
- any authenticated action requiring identity

## 4. Compliance Baseline (2026-03-02)

This section captures implementation-safe defaults, not legal advice.

### 4.1 iOS default-safe mode

For digital features unlocked inside the iOS app:

- use Apple in-app purchase flow for in-app upgrade purchases
- provide restore purchases path
- avoid exposing external web checkout links in iOS app UI by default

US storefront external-link changes (Apple 2025 update) are treated as an optional future mode behind explicit policy review and feature flags.

### 4.2 Android baseline

If distributed via Google Play:

- default-safe assumption is Google Play Billing for in-app digital upgrades
- do not assume external web checkout is always acceptable
- any alternative billing mode must be explicit and policy-reviewed

### 4.3 Web baseline

- web pricing pages remain public
- web billing/account pages are authenticated
- Stripe-style web billing remains primary account portal for web users

## 5. User Stories

### 5.1 Free user to paid user

As a free user, I can use WisePlan immediately.
When I tap a paid feature, I see plans first.
If I continue, I sign in only then.
After payment, I return to the exact feature I wanted and can use it right away.

### 5.2 Website visitor

As a website visitor, I can see plans without signing in.
If I open billing/account pages, I am asked to sign in and then returned to billing.

### 5.3 Admin operator

As an admin, I can:

- manage users
- deactivate/delete users with audit trail
- create/manage promo codes
- verify promo usage behavior safely

## 6. UX Flow Specification

### 6.1 In-app paid feature tap flow (canonical)

Example: user taps `Add Calendar` from Profile.

1. Trigger paywall/plans screen with feature context (`calendar.sync.enabled`).
2. User selects plan.
3. If logged out, show an **ultra-lightweight, contextual, one-tap auth gate** (e.g., Sign in with Apple / Google SSO). Avoid full forms here to preserve momentum. (Note: True "guest checkouts" without auth are deferred to a potential v2).
4. Start platform-specific checkout (passing `appAccountToken` or similar to map the subscription cleanly).
5. On success, refresh entitlements via backend.
6. Resume feature action and show immediate CTA (`Connect calendar now`).

### 6.2 Existing signed-in user

Skip auth step and go directly from plan selection to checkout.

### 6.3 Plans browsing without purchase

Allow plan comparison in app without mandatory sign-in.

### 6.4 Website flow

1. Landing page has clear `Pricing`, `Billing`, `Sign in` links.
2. `Pricing` is public.
3. `Billing` is auth-protected.
4. Sign-in resumes destination route (`/billing`, `/account/billing`, or checkout intent).

## 7. Platform Behavior Matrix

### 7.1 iOS app

- Plans visible in app: Yes
- Start checkout: Yes
- Payment path: Native iOS purchase flow (default-safe mode)
- External web checkout link in app: Off by default
- Restore purchases: Maintained strictly as a **manual backup only**.
- Automated Reconcile: On *every sign-in*, the app must verify the local receipt and automatically reconcile device entitlements to the backend. The user should not have to manually hunt for restore.
- Manage subscription CTA: platform-appropriate subscription management path

### 7.2 Android app

- Plans visible in app: Yes
- Start checkout: Yes
- Payment path: policy-reviewed provider choice for Play distribution
- External web checkout link in app: only if policy-approved for target distribution mode
- Restore/ownership sync: required for chosen billing model

### 7.3 Web

- Pricing public: Yes
- Checkout: Auth required
- Billing account pages: Auth required
- Invoices/payment methods/subscription management: In billing account area

## 8. Feature State Logic (Profile and Paywall)

Each paid feature row follows the same state model.

### 8.1 State-to-CTA mapping

- Free tier: `Choose Plan`
- Paid tier but feature not configured: `Connect` or `Set up`
- Paid tier and configured: `Manage`

### 8.2 Calendar-specific behavior

For `Add Calendar` in Profile:

- free -> paywall
- paid + not connected -> connect flow
- paid + connected -> manage calendars

## 9. Technical Architecture Plan

### 9.1 Entitlement source of truth

Backend remains canonical for:

- current tier
- active entitlements
- feature-level enablement

Client-side flags are UX hints only and must not be authoritative.

### 9.2 Multi-provider billing normalization

Backend normalizes different providers into one subscription/entitlement projection.

Minimum provider model:

- `stripe` (web and eligible app channels)
- `apple_iap` (iOS)
- optional future `google_play`

### 9.3 Intent resume system

Persist and restore post-auth/post-checkout context:

- originating feature key
- selected plan and interval
- return destination screen

### 9.4 API additions and behavior

Maintain current billing and feature APIs.
Add or formalize:

- `GET /api/me/subscription` (normalized provider + status summary)
- provider verification/event ingest endpoints as needed
- `DELETE /api/me/account` (self-service soft-delete start)
- admin user deactivate/delete endpoints
- admin promo CRUD endpoints

### 9.5 Data model extensions

Add/extend:

- provider-specific subscription metadata
- purchase event logs with idempotency
- account deletion lifecycle table
- promo metadata including channel compatibility

### 9.6 Security requirements

- Minimize bearer token in URL propagation; prefer short-lived handoff codes.
- Mask sensitive query params in logs.
- Preserve webhook idempotency and replay protection.
- Keep strict audit trail for admin actions.

## 10. Account Deletion Spec

### 10.1 User self-delete

- entry in Profile: `Delete my profile`
- double confirmation UX
- **Blocking Subscription Warning:** the UI *must* explicitly warn the user if they have an active Apple/Google subscription, stating that it will continue to bill unless manually canceled in device settings. Provide direct deep links to store subscription management.
- immediate soft-delete/deactivate by default upon confirmation.
- **Hard Purge SLA:** The backend specifies a hard purge limit (e.g., 30 days) to scrub PII unless legal/financial retention applies (e.g., keeping Stripe invoice IDs but anonymizing the user row).

### 10.2 Admin delete/deactivate

- role-protected endpoint/UI
- mandatory reason field
- complete audit logging

## 11. Promo Management Spec

Admin panel must support:

- create promo (mapped as an internal campaign)
- edit promo
- disable promo
- usage/redemption visibility
- test validation workflow
- channel compatibility tagging

**Important:** Admin operators should *not* manage provider complexity directly. The admin UI must allow creation of one top-level campaign code (e.g., "SUMMER50"), which the backend then maps to the channel-specific implementations (Stripe Coupons, Apple Offer Codes) under the hood.

## 12. Phased Implementation Plan

### Phase 1: UX and navigation unification

- plans/paywall as reusable flow
- delayed auth gate and resume intent
- pricing vs billing route separation
- paid feature CTA state consistency in Profile

### Phase 2: iOS-safe purchase path

- native iOS purchase integration
- restore purchases
- entitlement refresh pipeline
- disable external checkout CTA in iOS default mode

### Phase 3: Backend provider normalization

- unified subscription projection across providers
- normalized entitlement read API
- provider event processing hardening

### Phase 4: Billing/account management polish

- billing summary per provider
- invoices/payment methods where available
- consistent manage-subscription routing

### Phase 5: Admin operations

- promo CRUD and reporting
- user deactivate/delete flows
- operational audit/reporting checks

## 13. Acceptance Criteria (Definition of Done)

### 13.1 UX

- app is usable in free mode without startup sign-in
- paid feature tap always follows: plans -> auth (if needed) -> checkout -> entitlement refresh -> resume
- plans can be browsed without sign-in
- pricing is public; billing is authenticated

### 13.2 Compliance-safe implementation

- iOS default mode uses in-app purchase path for in-app digital upgrades
- iOS includes restore purchases behavior
- external iOS web checkout CTA is disabled in default-safe mode
- Android billing path is policy-reviewed for target distribution channel

### 13.3 Technical correctness

- entitlement unlock requires backend confirmation, not local optimistic unlock
- failed entitlement refresh has retry and clear user messaging
- resume intent returns user to initiating feature
- admin deletion and promo actions are audited

## 14. Testing and QA Matrix

Minimum E2E paths:

1. Free user taps paid feature -> paywall -> sign-in -> purchase -> unlock -> resume feature.
2. Signed-in free user -> select plan -> purchase -> unlock.
3. Purchase success but delayed backend sync -> retry + no false unlock.
4. Billing route access signed out -> sign-in -> resume billing.
5. Calendar button state transitions across free/paid/connected states.
6. Self-delete flow with confirmation and backend lifecycle state change.
7. Admin deactivate/delete action writes audit log.
8. Promo create -> validate -> apply -> redemption visibility.

## 15. Open Decisions

1. Final Android in-app billing strategy for Play distribution.
2. Timing and scope of optional US storefront external-link mode on iOS.
3. Final retention/anonymization behavior for deletion lifecycle.
4. Provider strategy for future multi-calendar and multi-seat expansion.

## 16. References

- Apple App Review Guidelines:
  - https://developer.apple.com/app-store/review/guidelines/
- Apple update (US storefront external link changes, May 1 2025):
  - https://developer.apple.com/news/?id=9txfddzf
- Expo in-app purchases guide:
  - https://docs.expo.dev/guides/in-app-purchases/
- Google Play Payments policy:
  - https://support.google.com/googleplay/android-developer/answer/9858738
- Google Play billing alternatives and user choice programs:
  - https://support.google.com/googleplay/android-developer/answer/13821247

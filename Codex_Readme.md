# Codex Session Context (Read First)

## Session Start Guardrail (Owner Directive)
- On every new Codex session, first ask only: `What are we doing today?`
- Do not run commands, open files, edit code, or execute tools until the user gives an explicit task.
- If the user message is unclear, ask a short clarification question and wait.

## Latest Session Update (2026-03-04, refresh stability + meeting flicker resolved)
- User-reported final issue set:
  1. Refresh previously signed user out (fixed earlier in session).
  2. After that fix, meetings intermittently alternated between:
     - "No meeting scheduled"
     - meetings visible
     across consecutive refreshes.
  3. Console showed web deprecation warnings (`shadow*`, `pointerEvents`) and Graph contact `429` rate-limit noise.
- Root causes addressed:
  1. Startup auth/entitlement race:
     - Signed-in session could briefly run calendar flow as non-sync (local-only) while preferences hydrated.
  2. Duplicate/competing fetch pressure:
     - Embedded map and enrichment paths contributed to unstable refresh timing in web flow.
  3. Web storage fragility:
     - token persistence needed stronger AsyncStorage/localStorage fallback handling.
  4. Contact enrichment over-querying:
     - Address-like strings were being sent to Graph contacts search, increasing 429s.
- Fixes implemented:
  1. `src/context/AuthContext.tsx`
     - Hardened web token storage fallback (AsyncStorage + localStorage).
     - Safer JWT parsing.
     - Magic token expiry handling aligned to backend truth.
  2. `src/services/graphAuth.ts`
     - Same web storage fallback hardening for Graph access/refresh tokens.
     - Safer JWT parsing.
  3. `src/components/SelectedDateSync.tsx`
     - Added `shouldSyncCalendar = canSyncCalendar || Boolean(userToken)` to avoid signed-in hydration race.
  4. `src/hooks/useLoadAppointmentsForDate.ts`
     - Same `shouldSyncCalendar` logic for consistency.
  5. `src/screens/MapScreen.web.tsx`
     - Prevented embedded-map focus auto-load from racing Schedule-owned sync.
  6. `src/services/graph.ts`
     - Added `isLikelyAddressQuery(...)` and skipped address-like contact searches.
     - Rate-limited contact-address enrichment (`limitConcurrency(..., 2)` + spacing).
     - Added explicit `429` handling for contact search paths.
  7. Web warning cleanup:
     - `src/components/DaySlider.tsx`: replaced web `shadow*` with `boxShadow`.
     - `src/components/MeetingCard.tsx`: replaced web `shadow*` with `boxShadow`.
     - `src/navigation/RootNavigator.tsx`: moved deprecated `pointerEvents` prop usage to style-based pattern.
- Deployment:
  1. Latest deployed web bundle hash:
     - `index-9c7e32634479bdebaf2a1e0ed4cb819b.js`
  2. Public verification:
     - `https://wiseplan.dk/app/` serves the hash above.
     - Cache-busted test URL used: `https://wiseplan.dk/app/?v=20260304-5`
- User confirmation:
  1. User confirmed: issue is fixed.

## Latest Session Update (2026-03-04, refresh stable but meetings flicker/no-show on reload)
- User-reported behavior after sign-out fix:
  1. Refresh no longer signs user out.
  2. Meetings list intermittently showed "No meeting scheduled" until manual refresh.
  3. In some refresh cycles, meetings toggled between empty and populated.
- Root-cause focus:
  1. Web Graph session token storage used AsyncStorage-only reads/writes and could return empty/transient values during reload timing.
  2. `MapScreen.web` still auto-triggered `load()` even when embedded inside Schedule, creating duplicate fetch/race pressure while `SelectedDateSync` was already responsible for day sync.
- Fixes implemented:
  1. `src/services/graphAuth.ts`
     - Added robust web storage behavior for Graph tokens:
       - read fallback: AsyncStorage -> localStorage
       - write/remove mirrored to both stores
     - Added explicit error when both stores fail during write.
     - Updated JWT payload decode path to UTF-8-safe base64url decode.
  2. `src/screens/MapScreen.web.tsx`
     - Changed focus-load behavior to skip `load()` when map is embedded in Schedule.
     - Keeps meeting-count refresh for non-embedded map screen only.
- Deployment:
  1. New web bundle built:
     - `index-dd13b21b3257a430197c0d9d2a8a0556.js`
  2. Origin verification (bypassing CDN cache) confirms new hash is served from origin for `/app/`.
  3. Public cache-busted URL confirmed:
     - `https://wiseplan.dk/app/?v=20260304-3` -> `index-dd13b21b3257a430197c0d9d2a8a0556.js`

## Latest Session Update (2026-03-04, refresh sign-out hardening + UI callback wiring + web deploy)
- User-reported issues:
  1. Refresh still signed user out.
  2. New schedule/empty-state UI updates needed function wiring.
- Auth + backend status:
  1. Verified VPS env is correct for magic auth:
     - `AUTH_MODE=magic`
     - `MAGIC_LINK_TOKEN_ISSUER=wiseplan-auth`
     - `MAGIC_LINK_TOKEN_AUDIENCE=wiseplan-app`
     - `MAGIC_LINK_TOKEN_TTL_MINUTES=10080`
  2. Backend deploy already includes race-condition fix:
     - `backend/src/services/userService.ts` uses `pg_advisory_xact_lock(hashtext(aad_oid))`.
     - Confirmed in VPS build artifact: `/home/nikola/RouteCopilot2/backend/dist/services/userService.js`.
  3. Log interpretation:
     - `users_aad_oid_key` duplicate error at `2026-03-04 13:37:39` occurred before later backend restart.
     - No matching duplicate-key/auth backend errors observed after restart windows in current log check.
- Frontend/UI wiring completed:
  1. `src/components/emptyState/EmptyStateScanner.tsx`
     - Added optional `onSignInAndSync` prop.
     - Wired CTA button `Sign In & Sync` to call handler (it previously had no `onPress`).
  2. `src/screens/ScheduleScreenNew.tsx`
     - Passed `handleSignInAndSync` down into `EmptySchedule` and into `EmptyStateScanner`.
     - Existing wiring retained for signed-in empty state:
       - `Create New Meeting` -> `navigation.navigate('AddMeeting')`.
- Web production deploy:
  1. Rebuilt production web bundle with:
     - `EXPO_PUBLIC_ENABLE_VPS_BACKEND=true`
     - `EXPO_PUBLIC_BACKEND_API_URL=https://api.wiseplan.dk`
  2. New bundle hash:
     - `index-e0c35e494742c416f53eeede56f340d0.js`
  3. Deployed to:
     - `/var/www/wiseplan-test/app`
  4. Verified served publicly:
     - `https://wiseplan.dk/app/` now references `index-e0c35e494742c416f53eeede56f340d0.js`
  5. Verified live bundle contains new CTA handler text:
     - `Go to Profile to sign in and connect calendar sync`

## Latest Session Update (2026-03-04, VPS backend/web production go-live + refresh sign-out hotfix)
- User goals in this run:
  1. Deploy backend and web to VPS production.
  2. Ensure app uses `https://api.wiseplan.dk`.
  3. Resolve "refresh signs me out again".
- VPS infrastructure and production rollout completed:
  1. Verified SSH + sudo automation on VPS (`nikola@207.180.222.248`).
  2. Uploaded and secured backend env at `/etc/wiseplan/backend.env`.
  3. Built backend on VPS and ran migrations (`0001`..`0005`) successfully.
  4. Installed/started persistent systemd service:
     - `wiseplan-backend.service`
     - backend listens on `127.0.0.1:4000`
  5. Added nginx site for:
     - `api.wiseplan.dk` -> reverse proxy to backend
     - `admin.wiseplan.dk` -> static `admin-panel` deployment
  6. Issued SSL certs for `api.wiseplan.dk` and `admin.wiseplan.dk` with certbot.
  7. Verified health:
     - `https://api.wiseplan.dk/api/health` -> `{"ok":true}`
     - `https://api.wiseplan.dk/healthz` -> `{"ok":true,...}`
     - `https://admin.wiseplan.dk/` returns admin app HTML
- Web app production deploy completed:
  1. Rebuilt web bundle with:
     - `EXPO_PUBLIC_ENABLE_VPS_BACKEND=true`
     - `EXPO_PUBLIC_BACKEND_API_URL=https://api.wiseplan.dk`
  2. Deployed to `/var/www/wiseplan-test/app`.
  3. Confirmed bundle contains backend constants:
     - `BACKEND_API_BASE_URL="https://api.wiseplan.dk"`
     - backend enabled flag true.
  4. Resolved Cloudflare/DNS stale-origin issue (public still serving old hash).
  5. Final public verification now shows:
     - `https://wiseplan.dk/app/` serves new hash `index-4e0cade593fa322268b2b5b2ab8d8d41.js`
     - JS served with `content-type: application/javascript`
- Refresh sign-out issue findings and fix:
  1. Production root cause found: magic-link JWT session lifetime was only 30 minutes.
  2. If token is older than TTL, refresh restores nothing and user appears signed out.
  3. Hotfix applied in production env:
     - `MAGIC_LINK_TOKEN_TTL_MINUTES=10080` (7 days)
  4. Backend schema validation updated to allow longer TTL values:
     - `backend/src/config/env.ts` max increased to 90 days.
  5. Templates updated:
     - `backend/.env.example`
     - `backend/backend.prod.env.template`
  6. Backend rebuilt and service restarted successfully after TTL change.
- Important operational note:
  1. Tokens issued before this TTL change still expire under old 30-minute rule.
  2. User must sign in again once to receive a new longer-lived token.
- Deployment/process decision captured:
  1. Preferred workflow is local fix + local test + git push + VPS deploy.
  2. VPS-direct edits only for urgent production hotfixes.

## Latest Session Update (2026-03-04, Outlook web reconnect popup fix + instant meetings refresh)
- User-reported behavior before fix:
  1. First Outlook connect worked.
  2. After delete-account and reconnect loops, Microsoft popup often showed app/login screen instead of closing.
  3. Calendar still connected in Profile, but meetings often appeared only after opening Profile and returning to Meetings.
- Root cause confirmation:
  1. OAuth callback URL reached app correctly (`/app/?code=...&state=...`) and token exchange succeeded.
  2. Remaining issue was callback popup completion/close reliability and post-connect route refresh timing.
- Changes implemented:
  1. `App.tsx`
     - Hardened web popup close behavior with repeated close attempts.
     - Added callback-only shell UI ("Completing Microsoft sign-in...") so popup does not render full app/login while completing auth.
     - Kept `maybeCompleteAuthSession({ skipRedirectCheck: true })` path plus fallback callback URL caching.
  2. `src/components/OutlookConnectModal.tsx`
     - Added cleanup of stale Expo web auth-session localStorage keys before new attempts:
       - `ExpoWebBrowserRedirectHandle`
       - `ExpoWebBrowser_OriginUrl_*`
       - `ExpoWebBrowser_RedirectUrl_*`
     - Retained PKCE/state persistence + fallback callback polling logic.
  3. `src/navigation/RootNavigator.tsx`
     - After successful Outlook connect, now triggers route refresh immediately (`triggerRefresh()`).
  4. `src/screens/ProfileScreen.tsx`
     - After successful Outlook connect, now triggers route refresh immediately (`triggerRefresh()`).
     - Enabling already-connected calendar also triggers immediate refresh.
- Outcome:
  1. User confirmed: "Great it works."
  2. Expected UX now: calendar connect success should surface synced meetings immediately without manual Profile round-trip.
- Known validation context:
  1. Targeted checks on modified flow passed through runtime verification.
  2. Full project type-check still has pre-existing unrelated TypeScript errors/OOM in this environment.
- Next work item queued:
  1. Build and execute a VPS deployment/setup plan for backend + web app + landing/billing surfaces.
  2. Do planning first; no new coding until user confirms next step.

## Latest Session Update (2026-03-03, unresolved web Outlook connect UX + high-precision fixes)
- Current unresolved issue (user-facing):
  1. After coming from magic-link sign-in, user clicks connect Outlook.
  2. On web, after entering Outlook email, user sees app content in the auth flow view/tab.
  3. Profile can still show connected afterward, so this appears as confusing OAuth web UX/redirect behavior, not a simple "not connected" state.
- What was changed this session:
  1. Outlook/session robustness:
     - `src/screens/ProfileScreen.tsx`: auth modal auto-closes when `userToken` exists.
     - `src/navigation/RootNavigator.tsx`: uses valid Graph-token check (`hasValidGraphSession`) and shows temporary "Outlook connected" banner.
     - `src/services/graphAuth.ts`: added `hasValidGraphSession(clientId)` (uses refresh-capable token validation).
     - `src/components/OutlookConnectModal.tsx`: web prompt now requests popup window features; `maybeCompleteAuthSession({ skipRedirectCheck: true })`.
  2. High-Precision behavior (user complaint: toggle off / "fisket" not finding Fisketorvet):
     - Backend:
       - `backend/src/services/featureAccessService.ts`: force advanced geocoding ON for signed-in Basic fallback source.
       - `backend/src/services/profileSettingsService.ts`: same signed-in Basic default ON when building settings response.
     - Frontend:
       - `src/screens/AddMeetingScreen.tsx`: now respects High-Precision mode, uses Google suggestions/place details when enabled + key present; otherwise token-backed suggestions with country bias.
       - `src/utils/geocoding.ts`: improved Nominatim + backend fallback for partial queries:
         - increased result limit
         - optional country code bias
         - fallback candidates (`..., Copenhagen`, `..., København`, `..., Denmark`)
       - `src/screens/ProfileScreen.tsx`: passes country bias into suggestions where applicable.
       - `src/context/UserPreferencesContext.tsx`: signed-in fallback keeps High-Precision ON.
- Validation done:
  1. Passed: `npm.cmd run backend:check`
  2. Passed: targeted TypeScript checks on changed frontend files.
  3. Known env limitation: full app `tsc` still OOMs in this shell.
- Status:
  1. High-Precision path patched; user must re-test after server/app restart.
  2. Outlook web auth UX confusion still reported as not fixed by user; needs controlled repro capture next session.

## Next Session Message Template (send after guardrail question and explicit task)
- Use this exact opener after user gives task context:
  - `We are debugging one unresolved issue: during Outlook connect on web (after magic-link), the auth flow sometimes shows app content in the same auth view/tab, even though Profile can later show connected. Before more code changes, we need one clean repro capture.`
- Ask user to run this test checklist first:
  1. Restart backend and web app dev server.
  2. Open fresh incognito window.
  3. Sign in via magic link.
  4. Click Connect Outlook and note whether auth opens popup or same tab.
  5. Capture exact URL after each step:
     - app URL before connect
     - Microsoft login URL
     - URL shown right when app content appears in auth view/tab
  6. After returning to app, check Profile calendar-connected state.
  7. Create one test meeting and confirm if it appears in Outlook Web Calendar.
  8. In Add Meeting address field, type `fisket` and report first 3 suggestions.
  9. In Profile Home Base search, type `fisket` and report first 3 suggestions.
  10. If any step fails, report exact step number and screenshot/URL.

## Latest Session Update (2026-03-03, profile unblock + account deletion implementation)
- User-reported issues:
  1. Profile got stuck on:
     - "Basic plan is loading"
     - "We are syncing your account access. Please wait a moment."
  2. Signed-in identity was unclear (initials shown instead of email).
  3. Home base address field could not be edited (stuck on existing value like "Copenhagen").
  4. Missing self-service account deletion option.
- Fixes implemented:
  1. Profile loading fallback hardening:
     - `src/screens/ProfileScreen.tsx`
     - Added robust fallback so `profileAccess` is set even when backend returns partial/legacy payloads or fetch paths fail.
     - Loading banner now appears only while sync is actually in progress; avoids permanent "loading" lock state.
  2. Signed-in identity display:
     - `src/screens/ProfileScreen.tsx`
     - Header pill now shows signed-in email (or display name fallback), instead of initials-only view.
     - `src/components/profile/ProfileStyles.ts` updated for email pill sizing/style.
  3. Home address input fix:
     - `src/components/LocationSearch.tsx`
     - Added local edit mode (`clearPending`) so typing over an existing selected location immediately switches to editable query mode.
     - Prevents repeated clear/reset loop that previously kept old selection text visible and blocked practical editing.
  4. Account deletion end-to-end:
     - Backend:
       - `backend/src/services/userService.ts`: added transactional `deleteUserAccount(userId)`.
       - `backend/src/routes/authRoute.ts`: added `DELETE /api/me/account`.
     - App:
       - `src/services/backendApi.ts`: added `backendDeleteMyAccount(...)`.
       - `src/screens/ProfileScreen.tsx`: added `Delete Account` destructive action (signed-in only), confirmation prompt, backend delete call, then local cleanup/sign-out.
       - `src/components/profile/ProfileHelpers.ts`: extended `clearLocalDataNow` options for custom success messaging/suppression.
- Deletion behavior details:
  1. Deletes authenticated user row (cascades dependent user-owned tables).
  2. Attempts orphan organization cleanup only when safe:
     - no remaining users in org
     - no remaining subscriptions for org
  3. Clears local app data and signs out on successful deletion.
- Validation completed:
  1. Passed: `npm.cmd run backend:check`
  2. Passed: `npm.cmd --prefix backend run build`
  3. Passed: targeted frontend TypeScript checks for updated files (`ProfileScreen`, `LocationSearch`, `ProfileStyles`, `ProfileHelpers`, `backendApi`).

## Latest Session Update (2026-03-03, profile flow correction: signed-in Basic + gated upgrade emails)
- User-reported issue:
  - After successful magic-link sign-in, profile still showed upgrade/lock messaging, creating a broken flow.
  - Sign-in modal email field was also not focusable earlier (tap interception bug).
- Final user flow implemented (accepted):
  1. Guest user opens Profile:
     - Banner copy prompts sign-in to activate free Basic plan.
  2. User signs in via magic link:
     - Signed-in fallback tier resolves to `basic` (not `free`) when no paid subscription/override is present.
     - Basic-plan settings are editable.
  3. User taps a higher-tier feature (Pro/Premium):
     - App shows explicit "requires X plan" message.
     - Backend endpoint is called to send plan options email to signed-in user.
  4. Profile access loading window:
     - Temporary "syncing access" state prevents false lock messaging during post-login hydration.
- Backend changes:
  1. `backend/src/services/featureAccessService.ts`
     - Added source `signed_in`.
     - Effective tier now falls back to `basic` with source `signed_in` instead of `free` when no paid/trial override applies.
     - `canEditSettings` now aligns with effective tier (`subscriptionTier !== "free"`).
  2. `backend/src/services/adminService.ts`
     - Admin effective tier resolution updated to match `signed_in -> basic` fallback.
  3. `backend/src/services/userService.ts`
     - New-user app trial seed changed to `APP_TRIAL_PLAN_CODE = "basic"`.
  4. New upgrade-interest email path:
     - Added `backend/src/services/upgradeInterestService.ts`.
     - Added `backend/src/routes/upgradeInterestRoute.ts` (`POST /api/me/upgrade-interest`).
     - Mounted route in `backend/src/routes/index.ts`.
- App/frontend changes:
  1. `src/screens/ProfileScreen.tsx`
     - Banner copy updated for Basic-first sign-in flow.
     - Added `requestPlansEmailForFeature(...)` integration with backend upgrade-interest endpoint.
     - Plan-gated actions (traffic, AI liaison, calendar, billing/profile lock path) now trigger "requires plan" + plans email request.
     - Added `profileAccessLoaded` sync guard to avoid false lock state right after login.
  2. `src/services/backendApi.ts`
     - Added `backendRequestUpgradeInterest(...)` API call.
     - Extended access source union to include `signed_in`.
  3. `src/context/UserPreferencesContext.tsx`
     - Signed-in fallback now defaults preferences tier to `basic` when backend returns no feature/profile payload.
  4. `src/components/AuthPromptModal.tsx`
     - Fixed email input usability by replacing full-screen touch interceptor with background press target (`Pressable`) so input remains focusable/typeable.
- Validation completed:
  1. Passed: `npm.cmd run backend:check`
  2. Passed: `npm.cmd --prefix backend run build`
  3. Passed: targeted frontend TypeScript checks for updated files (`ProfileScreen`, `UserPreferencesContext`, `backendApi`, `AuthPromptModal`).
- Operational note:
  - Upgrade plans email dispatch depends on SMTP config being present (same SMTP path used for magic-link sending).

## Latest Session Update (2026-03-02, manual confirmation: magic-link email works)
- User confirmation:
  - Magic-link email delivery is working.
- What this confirms:
  1. SMTP configuration in `backend/.env` is valid for current provider settings.
  2. `POST /api/auth/request-magic-link` is successfully generating and sending sign-in links.
  3. End-to-end email channel for `hello@wiseplan.dk` is operational for auth flow testing.
- Current status:
  - Web-first auth + billing test stack is functional with magic-link email sending enabled.

## Latest Session Update (2026-03-02, magic-link env activation + live local smoke test)
- User request:
  - Apply the recommended setup directly.
  - Run an actual end-to-end smoke test and report pass/fail.
- Configuration applied:
  1. `backend/.env`
     - Set `AUTH_MODE=magic`.
     - Added `MAGIC_LINK_JWT_SECRET` (generated because it was missing).
     - Set magic-link token config:
       - `MAGIC_LINK_TOKEN_ISSUER=wiseplan-auth`
       - `MAGIC_LINK_TOKEN_AUDIENCE=wiseplan-app`
       - `MAGIC_LINK_TOKEN_TTL_MINUTES=30`
     - Set magic-link redirect target:
       - `MAGIC_LINK_WEB_URL=http://localhost:8081`
     - Set sender/reply identity:
       - `MAGIC_LINK_FROM_NAME=WisePlan`
       - `MAGIC_LINK_FROM_EMAIL=hello@wiseplan.dk`
       - `MAGIC_LINK_REPLY_TO=hello@wiseplan.dk`
     - Preserved/used SMTP credentials already present in env:
       - `MAGIC_LINK_SMTP_HOST=secure56.webhostinghub.com`
       - `MAGIC_LINK_SMTP_PORT=465`
       - `MAGIC_LINK_SMTP_SECURE=true`
       - `MAGIC_LINK_SMTP_USER=hello@wiseplan.dk`
       - `MAGIC_LINK_SMTP_PASS` remained set.
- Live smoke test status (all PASS):
  1. `http://localhost:8090/` (landing)
  2. `http://localhost:8090/billing/`
  3. `http://localhost:8090/account/billing/`
  4. `http://localhost:8090/billing/app.js` (annual pricing fields present)
  5. `http://localhost:8081` (web app reachable)
  6. `http://localhost:4000/api/health`
  7. `http://localhost:4000/api/public/plans` (plans returned)
  8. `POST http://localhost:4000/api/auth/request-magic-link` returned `200` with success.
- Operational note:
  - A real magic-link request was triggered for `hello@wiseplan.dk`; inbox click-through should be used as final manual confirmation for full sign-in loop.

## Latest Session Update (2026-03-02, web-only beta distribution + SMTP magic links hardening)
- User direction:
  - Proceed with web-first launch flow (no store billing dependency yet).
  - Keep beta app access links on landing page (iOS/TestFlight + Android APK).
  - Support branded sender identity (`hello@wiseplan.dk`) for magic-link auth emails.
- Changes implemented:
  1. Backend auth mode and env hardening:
     - `backend/src/config/env.ts`
     - Added `AUTH_MODE=magic` support.
     - Added/validated `MAGIC_LINK_*` auth vars and SMTP vars.
     - Enforced `MAGIC_LINK_JWT_SECRET` when in `AUTH_MODE=magic`.
     - Added partial-SMTP validation guard (host/user/pass must be complete together).
  2. Magic-link token verification path:
     - `backend/src/middleware/auth.ts`
     - Added HS256 magic token verification.
     - `requireAuth` now supports `dev`, `magic`, and `azure` modes.
  3. Magic-link request + email delivery:
     - `backend/src/routes/authRoute.ts`
     - `POST /api/auth/request-magic-link` now signs JWT tokens and builds web magic links.
     - Added SMTP send path using Nodemailer (when configured).
     - In `dev` mode: still returns token/link payload for local no-email testing.
     - In non-dev modes: request fails if link cannot be emailed.
  4. Backend dependencies:
     - `backend/package.json` / `backend/package-lock.json`
     - Added `nodemailer`.
  5. Env template update:
     - `backend/.env.example`
     - Added full magic-link and SMTP config template (including `hello@wiseplan.dk` sender defaults).
  6. Landing beta links wording:
     - `vps-landing/index.html`
     - Changed badges from store language to beta distribution language:
       - `iOS Beta`
       - `Android APK`
  7. Web app profile exit/reset UX:
     - `src/screens/ProfileScreen.tsx`
     - Added explicit `Force Sign Out`.
     - Fixed `Clear Local Data` to actually remove local caches/session keys and reset preferences.
- Validation:
  1. Passed: `npm.cmd run backend:check`
  2. Passed: `node --check vps-landing/billing/app.js`

## Latest Session Update (2026-03-02, Antigravity QA review + magic-link/billing hotfixes applied)
- User request:
  - Review only Antigravity work related to magic links and subscription plans.
  - Then apply fixes based on findings and accepted recommendations.
- QA findings (high impact):
  1. Auth flow contract mismatch:
     - App requested `GET /api/me` and `POST /api/auth/request-magic-link`, but backend routes were missing.
  2. Annual pricing contract mismatch:
     - Billing UI used `annual.amountCents` while backend returns annual pricing as:
       - `amountCentsBilledYearly`
       - `amountCentsEffectiveMonthly`
  3. Guest save regression:
     - `AddMeeting` blocked save behind auth modal.
  4. App-store risk copy:
     - Profile premium prompt explicitly said "upgrade ... on our website."
  5. Env mismatch:
     - Auth context used `EXPO_PUBLIC_BACKEND_URL` while project scripts/config use `EXPO_PUBLIC_BACKEND_API_URL`.
- Decisions confirmed by user:
  1. Proceed with recommended fixes.
  2. Keep free/no-signin usability by allowing local save, then soft prompt for backup/sync.
- Changes implemented:
  1. `src/context/AuthContext.tsx`
     - Switched backend URL resolution to align with `EXPO_PUBLIC_BACKEND_API_URL`.
     - Added shared API URL builder and normalized `/api` handling.
     - Updated magic-link request endpoint to `/api/auth/request-magic-link`.
     - In dev auth mode, if backend returns token, app signs in immediately.
     - Hardened sign-in: non-401 `/api/me` failures no longer force logout.
  2. `backend/src/routes/authRoute.ts` (new)
     - Added `POST /api/auth/request-magic-link`.
     - Added `GET /api/me` (auth-required profile payload).
     - Dev mode: returns test token + deep-link URL to complete local flow.
  3. `backend/src/routes/index.ts`
     - Mounted new `/api/auth/*` routes pre-auth.
     - Mounted `/api/me` route behind `requireAuth`.
  4. `src/screens/AddMeetingScreen.tsx`
     - Removed blocking auth modal on confirm for guests.
     - Guests now save locally and see soft prompt: saved locally, sign in to back up/sync.
  5. `src/screens/ProfileScreen.tsx`
     - Replaced website-steering premium copy with account-sync-oriented wording.
  6. `vps-landing/billing/app.js`
     - Fixed annual pricing render to use annual backend fields.
     - Added annual billing subline ("Billed $X yearly") while keeping /mo display.
- Validation:
  1. Passed: `npm.cmd run backend:check`
  2. Passed: `node --check vps-landing/billing/app.js`
  3. Known environment limit unchanged: full app `tsc` (`npx tsc -p tsconfig.json --noEmit`) still fails in this shell with Node OOM.

## Latest Session Update (2026-03-02, payments policy alignment + web-only monetization direction)
- Core problem being solved:
  - Launch paid plans fast, safely, and globally without App Store/Google Play rejection risk.
  - Prefer website billing (WisePlan web) while mobile app acts as companion/sign-in/use experience.
  - User constraint: solo founder path, minimal legal/ops overhead at launch, Denmark-first rollout.
- What we aligned on (current best-safe baseline):
  1. Positioning:
     - WisePlan should be treated as a SaaS/web-first product with mobile companion apps.
  2. In-app monetization behavior (default-safe mode):
     - Do **not** place direct in-app purchase CTAs/links to web checkout from locked feature popups by default.
     - Locked feature UX in app should be entitlement messaging + sign-in/account-sync path, not checkout steering.
  3. Web monetization behavior:
     - Pricing, trial, checkout, billing portal, invoices, payment methods live on website (`wiseplan.dk`).
     - Backend entitlement sync unlocks paid features in app after web purchase.
  4. Platform-policy nuance:
     - iOS Denmark/EEA and Google Play EEA have specific external-payment/link programs and requirements.
     - Without enrolling in those programs/entitlements, direct in-app web-payment steering is higher risk.
  5. Compliance-critical product requirements:
     - If account creation exists in app, provide in-app account deletion flow (policy requirement).
     - Keep backend as single source of truth for subscription/entitlement state.
- Clarification captured from user Q&A:
  - Proposed popup text like "subscribe on wiseplan.dk" with clickable link is not treated as globally safe-by-default for iOS/Google in Denmark storefront context.
  - Safer launch pattern matches companion-app model used by major services (web signup + in-app sign-in/consumption), with region-specific exceptions handled later if needed.
- Billing provider discussion status:
  - LemonSqueezy considered for fast web billing as Merchant of Record.
  - Decision context: fastest to market vs app-store risk; web-only billing is operationally easiest if app avoids in-app purchase steering.
- Current direction ("where we are headed"):
  1. Finalize spec v2 in `docs/PLANS_SIGNIN_BILLING_APPSTORE_SAFE_SPEC.md` with stricter platform-specific branches:
     - Default safe branch (no in-app checkout links).
     - Optional advanced branch (Apple/Google approved external-link programs).
  2. Implement/auth hardening:
     - Passwordless/deferred sign-in can be used, but copy must stay account/data-sync oriented.
  3. UX flow target:
     - Free use first -> sign in when needed for sync/account actions -> paid unlock via web checkout -> entitlement sync back to app.
  4. Keep billing/account management centralized on web, with app profile deep-linking only where compliant per platform/storefront policy.

## Latest Session Update (2026-03-02, billing UI sync + start_billing hardening)
- User request:
  - Ensure one canonical local billing UI and remove confusion between `localhost:8090` and `localhost:4004`.
  - Verify Antigravity UI fixes and update session context.
- What was validated:
  1. Billing UI script structure and syntax:
     - `node --check vps-landing/billing/app.js` passed.
     - Prior malformed template tags (`< div >`, `< li >`, `< tr >`, `< table >`) are no longer present.
  2. Billing redirect logic:
     - Mock checkout redirect path is correct in `vps-landing/billing/app.js`:
       - `window.location.replace('/billing/success?session=...')`
  3. Sub-page style support:
     - Shared classes for account/checkout/success/cancel pages are present in `vps-landing/billing/styles.css`:
       - `.brand`, `.nav`, `.row`, `.row.spacer`, `.muted`, `.table`
- Root cause confirmed for "old vs new billing design":
  - Two different local servers were active:
    1. Python static server on `8090` (used by `start_billing.bat`)
    2. Separate Node test server on `4004`
  - Different active origins plus cache behavior created the appearance of different designs.
- Changes implemented for stable local behavior:
  1. `start_billing.bat` hardened:
     - Validates required server script exists.
     - Frees the selected billing port before launch.
     - Frees legacy test port `4004` (unless billing port is explicitly `4004`).
     - Starts billing static server from canonical root `vps-landing`.
     - Opens billing URLs with cache-bust query (`?_cb=...`).
  2. New local no-cache server script:
     - Added `scripts/serve_vps_landing_nocache.py`.
     - Sends `Cache-Control: no-store, no-cache` headers to avoid stale billing UI after edits.
- Current operational baseline:
  - Canonical local billing URL: `http://localhost:8090/billing/` (via `start_billing.bat`).
  - Canonical local account billing URL: `http://localhost:8090/account/billing/`.
  - Treat ad-hoc port `4004` server as non-canonical; keep it stopped unless intentionally used for debugging.

## Latest Session Update (2026-02-27, web loop fixed + homepage/billing local preview finalized)
- User-confirmed status:
  - Web app freeze/flicker issue is resolved ("it works fine").
  - Local homepage + billing pages are accessible and verified.
- Technical fix verified in code:
  1. `src/hooks/useEnsureMeetingCountsForDate.ts`
     - Prevents unnecessary context churn by returning previous state objects when values are unchanged:
       - `setMeetingCountByDay((prev) => changed ? merged : prev)`
       - `setLoadedRange((prev) => prev unchanged ? prev : next)`
  2. Combined with prior `SelectedDateSync`/Map focus stabilization, this removed the observed `Maximum update depth exceeded` loop path.
- Homepage/billing UX change implemented:
  1. `vps-landing/index.html`
     - Added `Subscribe` button linking to `/billing/`.
     - Added `My Billing` button linking to `/account/billing/`.
     - Added `btn-subscribe` style (red/orange gradient) for clear billing CTA.
- Local run helper:
  1. Added `homepage_local_run.bat` in repo root.
     - Runs backend migrations.
     - Starts backend server window (`localhost:4000`).
     - Starts landing static server window.
     - Opens homepage/billing/account billing URLs.
  2. Batch quoting/parser issues were fixed (Windows `\" \"`/path syntax problems).
- Known-good manual local preview commands (single-line, no line breaks):
  1. Landing page server:
     - `Set-Location -LiteralPath "C:\Users\Nikola Dimovski\RouteCopilot2\vps-landing"`
     - `py -m http.server 8090`
  2. Backend server:
     - `Set-Location -LiteralPath "C:\Users\Nikola Dimovski\RouteCopilot2"`
     - `npm run backend:start:build`
  3. Test URLs:
     - `http://localhost:8090/`
     - `http://localhost:8090/billing/`
     - `http://localhost:8090/account/billing/`
- Operational note:
  - Do not paste browser error text (e.g., "This site can't be reached") into terminal; it is interpreted as invalid CLI commands.

## Latest Session Update (2026-02-27, clean GitHub baseline compare without losing local work)
- User request:
  - Download baseline app from GitHub, compare with current app, fix/reconnect locally without pushing or losing guest/backend logic.
- What was done safely:
  1. Fetched latest remote snapshot from `origin` and created isolated compare worktree:
     - Local folder: `_compare_clone/`
     - Source commit: `origin/master @ 2dbfd1ee0850b0ff125296f9d4a8e230249d0a23`
  2. No force resets, no deletions of current code, no GitHub push operations.
- Comparison focus and outcomes:
  1. `src/navigation/RootNavigator.tsx`
     - Confirmed guest-mode change exists in current app (no forced `LoginScreen`) and was preserved intentionally.
  2. `src/navigation/AppNavigator.tsx`
     - Fixed web map visibility regression by scoping Expo Go map placeholder to native only:
       - `disableNativeMapInExpoGo = Platform.OS !== 'web' && isExpoGo`
  3. `src/screens/MapScreen.web.tsx`
     - Kept click-capture mitigation:
       - map wrapper no longer full absolute fill; uses normal relative/flex layout.
  4. `src/screens/ScheduleScreen.tsx`
     - Restored wide split layout behavior (`useSplitLayout = isWide`) while keeping current tier/feature logic.
  5. `src/navigation/AppNavigator.tsx` (Add tab)
     - Normalized to standard `tabPress` interception (removed custom button interception path) to reduce interaction risk.
- Validation from this step:
  - Backend check still passes: `npm.cmd run backend:check`.
  - Runtime web validation still constrained in this shell by Metro `spawn EPERM` limitations; manual user retest required.

## Latest Session Update (2026-02-27, web app regression triage and safeguard log)
- User-reported status:
  - Admin panel loads quickly, but user web app became slow/non-interactive and map visibility changed.
  - Risk concern: do not lose current progress while debugging.
- Safety/integrity checks completed:
  1. No git conflict markers found in source files.
  2. Backend compiles and checks pass:
     - `npm.cmd run backend:check`
     - `npm.cmd --prefix backend run build`
  3. Current workspace is heavily modified (expected), so no destructive cleanup was performed.
- Web regression findings and changes applied:
  1. Map tab visibility regression on web fixed in `src/navigation/AppNavigator.tsx`:
     - Expo Go map placeholder is now native-only (`Platform.OS !== 'web'`), so web keeps real map screen.
  2. Add tab interaction path normalized in `src/navigation/AppNavigator.tsx`:
     - Reverted to standard `tabPress` interception for `Schedule -> AddMeeting` (removed custom `tabBarButton` interception path).
  3. Web map overlay risk reduced in `src/screens/MapScreen.web.tsx`:
     - Map wrapper changed from full absolute fill to normal relative/flex container to avoid click-capture over other UI.
  4. Split layout on wide screens restored in `src/screens/ScheduleScreen.tsx` (`useSplitLayout = isWide`).
- Current unresolved state:
  - User still reports non-clickable behavior in browser; runtime validation in this shell is limited by local Metro `spawn EPERM` constraints.
- Explicit safeguards noted:
  - No deletion of current app code.
  - No github writes/pushes were performed.
  - Next planned diagnostic step (pending user approval): clone clean app copy in separate local folder, compare behavior and diff only interaction-critical files.

## Latest Session Update (2026-02-27, web tab lock/flicker mitigation)
- User-reported regression:
  - On `http://localhost:8081`, UI flickered and then tab/buttons (Profile, Add, etc.) became non-interactive.
- Root-cause hypothesis and fix:
  - Likely caused by Add-tab redirect pattern on web (redirect screen mounting/navigation re-fire risk).
  - Updated Add tab to a safer button-intercept flow in:
    - `src/navigation/AppNavigator.tsx`
  - Change details:
    1. Removed Add auto-redirect screen behavior from active route usage.
    2. Add tab now uses custom `tabBarButton` that directly calls `openAddMeeting(...)`.
    3. Prevents Add from becoming a persistent active screen route and avoids redirect-loop style behavior.
- QA status:
  - Backend typecheck still passes: `npm.cmd run backend:check`.
  - Full web runtime validation in this shell remains limited by environment `spawn EPERM` Metro worker issues.
  - User-side confirmation required after restart + hard refresh.
- Operator steps after this fix:
  1. Restart stack with `start_be_admin_app.bat`.
  2. Hard refresh browser (`Ctrl+F5`).
  3. Re-test tab interactivity (Schedule/Map/Profile/Dev and `+` Add).

## Latest Session Update (2026-02-27, billing v1 website + backend contract implementation)
- User goal:
  - Build billing v1 for website + backend using entitlement-key-driven logic and webhook-based paid state.
- Implemented backend (billing contract):
  1. New billing service:
     - `backend/src/services/billingService.ts`
     - Includes:
       - public plan catalog response from seeded `PLAN_CATALOG`
       - billing snapshot (`/api/billing/me`)
       - checkout session creation (mock + Stripe modes) with idempotency
       - promo validation with discount preview and scope checks
       - customer portal session creation
       - invoice listing
       - mock checkout completion endpoint support
       - Stripe webhook signature verification + idempotent event processing
  2. New routes:
     - `backend/src/routes/publicRoute.ts`
       - `GET /api/public/plans`
     - `backend/src/routes/billingRoute.ts`
       - `POST /api/billing/webhook` (no auth)
       - `GET /api/billing/me`
       - `POST /api/billing/checkout-session`
       - `POST /api/billing/customer-portal-session`
       - `POST /api/billing/promo/validate`
       - `GET /api/billing/invoices`
       - `POST /api/billing/mock/complete-checkout` (dev/mock)
  3. Router/auth ordering:
     - `backend/src/routes/index.ts`
     - `/api/public/*` and billing webhook are mounted before `requireAuth`.
     - Auth-required billing routes remain under `/api/billing/*`.
  4. Webhook raw body support:
     - `backend/src/app.ts` now captures `rawBody` via `express.json({ verify })` for Stripe signature checks.
  5. Feature-tier resolution improvement:
     - `backend/src/services/featureAccessService.ts`
     - Effective subscription tier now resolves from active subscription states when no admin tier override exists.
     - Upgrade URLs now include entitlement deep-link query:
       - `?source=app&feature=<entitlement_key>`
  6. Billing env defaults:
     - `backend/src/config/env.ts`
     - `backend/.env.example`
     - `BILLING_FRONTEND_BASE_URL` default set to `https://www.wiseplan.dk`.
- Implemented website billing pages:
  - `vps-landing/billing/index.html` (`/billing`)
  - `vps-landing/billing/checkout/index.html` (`/billing/checkout`)
  - `vps-landing/billing/success/index.html` (`/billing/success`)
  - `vps-landing/billing/cancel/index.html` (`/billing/cancel`)
  - `vps-landing/account/billing/index.html` (`/account/billing`)
  - Shared UI/logic:
    - `vps-landing/billing/styles.css`
    - `vps-landing/billing/app.js`
  - Includes:
    - monthly/annual toggle
    - plan cards with limits (calendar/traffic/AI/SMS/email)
    - feature matrix by entitlement keys
    - promo validate + discount preview
    - checkout redirect flow
    - success page polling for webhook-updated status
    - account billing snapshot + invoice table + manage billing action
- Implemented app deep-link upgrade behavior:
  - `src/screens/ProfileScreen.tsx`
  - Locked feature prompts now open billing with feature key:
    - `geocode.provider.premium`
    - `routing.traffic.enabled`
- Packaging/deploy update:
  - `package.json` `prepare:vps` now copies:
    - `vps-landing/billing/**`
    - `vps-landing/account/**`
    - into `..\\wiseplan-release\\billing\\` and `..\\wiseplan-release\\account\\`
- Validation run (this session):
  - Passed:
    - `npm run backend:check`
    - `npm --prefix backend run build`
    - `node --check vps-landing/billing/app.js`
  - Environment limitation still present:
    - Full frontend typecheck `npx tsc -p tsconfig.json --noEmit` fails here with Node OOM.
- Notes for next session:
  - For real Stripe mode, ensure `plan_prices.stripe_price_id` and `promotions.stripe_coupon_id` are populated in DB.
  - For local mock billing test, set:
    - `BILLING_PROVIDER=mock`
    - `BILLING_FRONTEND_BASE_URL=http://localhost:5175`
  - Serve static site locally from `vps-landing` to test `/billing` + `/account/billing`.

## Latest Session Update (2026-02-27, backend-owned feature toggles + traffic/geocode enforcement)
- User goal:
  - Keep paid API usage controlled by WisePlan backend (not user-owned keys).
  - Add profile toggles for package features (advanced geocoding, real-time traffic routing).
  - Enforce feature access by subscription entitlement + user toggle state.
- Implemented backend changes:
  1. New migration:
     - `backend/migrations/0004_feature_access_controls.sql`
     - Adds:
       - `user_feature_preferences` (`use_advanced_geocoding`, `use_traffic_routing`)
       - `route_cache.provider`
       - `route_cache.traffic_aware`
  2. New feature-access API:
     - `GET /api/me/features`
     - `PATCH /api/me/features`
     - Files:
       - `backend/src/routes/featureRoute.ts`
       - `backend/src/services/featureAccessService.ts`
       - `backend/src/services/subscriptionTierService.ts`
  3. Server-side enforcement added:
     - `POST /api/geocode` now resolves provider based on effective feature access.
     - `POST /api/route` now resolves traffic-aware mode based on effective feature access.
     - Files:
       - `backend/src/routes/geocodeRoute.ts`
       - `backend/src/routes/routeRoute.ts`
       - `backend/src/services/geocodeService.ts`
       - `backend/src/services/routeService.ts`
       - `backend/src/providers/geocodeProvider.ts`
       - `backend/src/providers/routeProvider.ts`
  4. Backend env expanded:
     - `GOOGLE_MAPS_API_KEY` (preferred)
     - `GOOGLE_GEOCODING_API_KEY` (legacy alias still supported)
     - `TRAFFIC_PROVIDER=osrm|google`
     - `BILLING_UPGRADE_URL`
     - Files:
       - `backend/src/config/env.ts`
       - `backend/.env.example`
- Implemented app changes:
  1. Profile screen toggles now backend-driven:
     - `Advanced address geocoding` (Basic+)
     - `Real-time traffic routing` (Pro+)
     - Locked state shows upgrade prompt and billing link.
     - User Google API key input removed from Profile flow.
     - File: `src/screens/ProfileScreen.tsx`
  2. Feature access sync:
     - App fetches backend feature access and syncs local preferences/tier.
     - Files:
       - `src/context/UserPreferencesContext.tsx`
       - `src/services/backendApi.ts`
       - `src/types/index.ts`
  3. Add Meeting geocoding flow:
     - Removed direct Google key geocoding path; now uses backend-enabled geocode path.
     - File: `src/screens/AddMeetingScreen.tsx`
- Implemented admin visibility changes:
  - Admin users list now includes effective tier, feature preferences, and active feature states.
  - Files:
    - `backend/src/services/adminService.ts`
    - `admin-panel/app.js`
- Validation summary:
  - `npm.cmd run backend:check` passed.
  - Backend migration/build run requires valid `DATABASE_URL` credentials in `backend/.env`.
- Important env gotcha discovered:
  - `TRAFFIC_PROVIDER` must be `osrm` or `google` only.
  - If API key is accidentally put in `TRAFFIC_PROVIDER`, backend boot fails with Zod enum error.
  - Correct placement:
    - `GOOGLE_MAPS_API_KEY=<key>`
    - `TRAFFIC_PROVIDER=google`
- Security follow-up:
  - A Google key was printed in terminal/chat during setup.
  - Rotate that key in Google Cloud and update `backend/.env`.

## Latest Session Update (2026-02-27, add-button hotfix + QA refresh)
- User-reported issue:
  - `+` Add Meeting button did not open the Add Meeting screen reliably.
- Fix implemented:
  1. `src/navigation/AppNavigator.tsx`
     - Replaced the old Add-tab placeholder flow with `AddRedirectScreen`.
     - Added `openAddMeeting(...)` helper that jumps to `Schedule` and navigates to nested `AddMeeting`.
     - Removed `tabPress + preventDefault` dependency to avoid duplicate/unstable tab event behavior.
  2. Result:
     - Add tab now acts as a reliable redirect trigger to `Schedule -> AddMeeting`.
- QA rerun (current session):
  - Passed:
    - `npm run backend:check`
    - `npm --prefix backend run build`
    - Admin API surface is present and wired (`/api/admin/*`), including allowlist, tier overrides, user state, and audit routes.
  - Verified present:
    - Admin MVP static web app files exist under `admin-panel/` (`index.html`, `app.js`, `styles.css`).
    - Free-tier multi-day Plan Visit fix is present (`getLocalMeetingsInRange` path).
    - Pro gate for re-optimize is present (`canOptimizeRoute` entitlement usage in `ScheduleScreen`).
- Known environment/tooling blockers (not confirmed product-logic regressions):
  - Full frontend typecheck still fails in this shell with TypeScript stack overflow.
  - `expo export --platform web` fails in this shell with `spawn EPERM`.
  - `npm run backend:migrate` (tsx) fails in this shell with `spawn EPERM`.
  - `npm run backend:migrate:build` requires `DATABASE_URL` to be set.

## Latest Session Update (2026-02-27, SaaS QA + gating fixes + backend dev wiring)
- User request:
  - QA business-plan implementation against backend work.
  - Wire backend env usage into local scripts.
  - Add backend-enabled indicator in Dev Docs.
  - Fix key gaps found in QA.
- Implemented changes:
  1. Added backend-enabled run scripts in root `package.json`:
     - `start:backend`
     - `web:backend`
     - `android:backend`
     - `ios:backend`
     - `backend:dev`
     - `backend:migrate`
     - `backend:check`
  2. Added visible backend integration status in Dev Docs Scopes tab:
     - `src/screens/DevDocsScreen.tsx`
     - Shows `Enabled/Disabled` and resolved backend base URL from env.
  3. Fixed Free-tier Plan Visit search scope:
     - Added `getLocalMeetingsInRange(...)` in `src/services/localMeetings.ts`.
     - `src/screens/AddMeetingScreen.tsx` now loads local meetings across the selected search window for free/no-sync users (not only currently loaded day).
  4. Added strict Pro+ gate for route re-optimization:
     - Added `canOptimizeRoute` entitlement in `src/utils/subscription.ts`.
     - `src/screens/ScheduleScreen.tsx` now blocks re-optimize for Free/Basic with an upgrade alert and button label `Upgrade to Pro`.
  5. Added explicit traffic-aware routing placeholder message:
     - `src/screens/ScheduleScreen.tsx` now shows that traffic-aware provider is planned; current optimization uses standard routing until provider integration is implemented.
- QA outcome summary:
  - Phase 3 backend pieces are functional locally (geocode/route/user-state path).
  - Full paid SaaS stack is not complete yet:
    - Billing/plan/promo/entitlement DB tables are not yet in backend migrations.
    - Full production admin web app is not implemented yet; current local admin MVP is a static tool under `admin-panel/`.
- Validation notes:
  - `npm run backend:check` passed.
  - Full-project `tsc` remains unreliable in this environment due existing OOM/tooling limits.

## Latest Session Update (2026-02-27, no sign-in + immediate Free plan)
- User requirement:
  - App must work without sign-in.
  - Free plan should apply immediately for unauthenticated users.
- Implemented changes:
  1. Removed startup login gate:
     - `src/navigation/RootNavigator.tsx`
     - App now opens directly to main navigator; no forced `LoginScreen` for logged-out users.
  2. Added effective-tier logic for logged-out users:
     - `src/utils/subscription.ts` (new)
     - `getEffectiveSubscriptionTier(...)` returns `free` when not authenticated.
  3. Set default preferences tier to Free:
     - `src/types/index.ts`
     - `DEFAULT_USER_PREFERENCES.subscriptionTier = 'free'`.
  4. Added local meetings persistence for Free mode:
     - `src/services/localMeetings.ts` (new)
     - Local create/update/delete + day/range loaders + day-count helpers.
  5. Wired Free-mode loading/counts/sync flow:
     - `src/components/SelectedDateSync.tsx`
     - `src/hooks/useEnsureMeetingCountsForDate.ts`
     - `src/hooks/useLoadAppointmentsForDate.ts`
     - `src/context/RouteContext.tsx`
     - Logged-out/free users now load and operate on local meetings instead of calendar APIs.
  6. Applied entitlement gating across screens:
     - `src/screens/AddMeetingScreen.tsx`
     - `src/screens/MeetingDetailsScreen.tsx`
     - `src/screens/ScheduleScreen.tsx`
     - `src/screens/ProfileScreen.tsx`
     - Calendar/contact/paid features now depend on effective tier (free when logged out).
  7. UX polish for no-signin mode:
     - `src/screens/ProfileScreen.tsx`
     - Sign-out card is hidden when no authenticated session exists.
- Current status:
  - No-signin Free workflow is implemented end-to-end.
  - Free users can use local meeting flow immediately on app open.
- Validation notes:
  - Targeted TS check passed for `src/hooks/useLoadAppointmentsForDate.ts`.
  - Full-project `tsc` remains unreliable in current environment due existing OOM/stack-overflow tooling issues.

## Latest Session Update (2026-02-25, native route line cleanup)
- User feedback after Leaflet native switch:
  - Map and routes are visible, but both straight connectors and road polyline were rendering at the same time.
  - Requested road-only route line and slightly darker blue to match web/iOS.
- Implemented changes:
  1. `src/screens/MapScreen.native.tsx`
     - Removed duplicate/stacked route rendering path that caused straight connector + road line overlap.
     - Kept a single route polyline, preferring OSRM road geometry.
     - Updated route stroke color to darker blue: `#0078D4`.
- Current status:
  - Native map now renders one road route line (no duplicate straight connector overlay).
  - Visual color is aligned closer to web/iOS route appearance.

## Latest Session Update (2026-02-25, native map engine switch)
- Context:
  - User reported Android emulator map remained blank (no polyline/markers/info), and requested a different solution.
- Direction chosen:
  - Full native map rendering switch from `react-native-maps` to Leaflet (WebView) with OpenStreetMap tiles (free map path).
  - "Option 2" selected: replace native map engine, not just fallback.
- Implemented in code:
  1. Added shared native map engine:
     - `src/components/NativeLeafletMap.tsx`
     - WebView-hosted Leaflet renderer with marker/polyline support, map-fit, and marker click callbacks.
  2. Added native-specific main map screen:
     - `src/screens/MapScreen.native.tsx`
     - Preserves route data flow, bottom info card UX, cluster selection behavior, and route QC overlay.
  3. Added native-specific plan panel map:
     - `src/components/PlanVisitMapPanel.native.tsx`
  4. Added native-specific insertion preview modal map:
     - `src/components/MapPreviewModal.native.tsx`
- Current status:
  - Native map engine migration is implemented.
  - Emulator/device verification is still pending on your machine.
- Validation notes:
  - Targeted TypeScript check for new files passed.
  - Full-project `tsc` still hits existing environment/tooling limits (OOM/stack overflow), same class of issue seen previously.
- Operational notes:
  - This rendering path does not require a Google Maps API key for drawing map tiles/markers/polylines.
  - It currently depends on network availability to load Leaflet CDN assets and OSM tiles.

## Latest Session Update (2026-02-25)
- Android Studio APK build is now confirmed working end-to-end without recurring issues.
- Current baseline is stable for local debug APK generation; continue regular project work from this state.
- `Build_android.APK.nuclear.bat` refinements (evening):
  - Args: first arg numeric → port; otherwise AVD. Second arg (if present) is port.
  - PASS 1 pre-cleans locked build dirs: `android/app/build`, `android/build`, `node_modules\expo-constants|react-native-reanimated|react-native-svg\android\build`.
  - Nuke helper now retries via PowerShell delete after `takeown/icacls`; fixes `: was unexpected at this time` lock errors.
  - Label lookup robustness: build-env helper renamed to `BUILD_ENV_SETUP` and file re-saved as ASCII to avoid missing-label errors.
  - Emulator detection avoids `findstr` pipe to prevent `'C:\Users\Nikola' is not recognized` noise.
  - Requires elevated PowerShell; run from repo root: `.\Build_android.APK.nuclear.bat 8082` (or `"MyAVD" 8082`). UAC must be accepted for the run to proceed.

## Current Session Follow-Up (2026-02-25, later)
- Issue reported:
  - `Build_android.APK.nuclear.bat` kept restarting/re-entering NUCLEAR flow repeatedly.
- Work completed:
  1. Hardened admin detection in `Build_android.APK.nuclear.bat` using a PowerShell Administrator check (`WindowsBuiltInRole::Administrator`) instead of token-group matching.
  2. Added elevation sentinel argument `__ELEVATED__` to prevent recursive self-relaunch if elevation is not actually granted.
  3. Added NUCLEAR-run guard file:
     - `%TEMP%\RouteCopilot2.nuclear.inprogress.flag`
     - Script now blocks immediate repeated NUCLEAR runs and exits with a clear error (`exit /b 90`) when a prior run marker is still active.
  4. Added guaranteed cleanup of the NUCLEAR marker on all PASS 2 exits (success and failure paths).
  5. Reduced aggressive process killing in PASS 2:
     - Removed forced kills of `studio64.exe`, `studio.exe`, `code.exe`, `devenv.exe`.
     - Kept emulator + Java/Gradle/Node/ADB cleanup.
- Current status:
  - Script logic is patched to prevent infinite restart loops.
  - End-to-end behavior is now confirmed stable in your environment.
  - BAT build flow issues from this thread are treated as completed.

## Current Open Issue (2026-02-25, latest, historical context)
- Status:
  - Superseded by the native Leaflet/WebView migration above.
  - Keep this section as history of why the map-engine switch was made.
- Platform/scope:
  - Android emulator only (APK/dev client path).
- What works:
  - Route data loads correctly (appointments/waypoints/polyline/OSRM present in Route QC overlay).
  - Map camera bounds/fit works (date change zooms to the correct region).
  - Real Android device and web render route overlays correctly.
- What fails (emulator only):
  - Route polyline is not visible.
  - Route markers/waypoints are not visible.
  - Only base map tiles are visible.
- Current conclusion:
  - Data and fit logic are working; rendering of map overlays (Polyline/Marker layer) was failing specifically on Android emulator.
  - A targeted fix has now been applied in code and is pending emulator verification.

## Map Overlay Fix Applied (2026-02-25, latest)
- Implemented changes:
  1. `src/screens/MapScreen.tsx`
     - Forced Android map to Google provider + legacy renderer:
       - `provider={PROVIDER_GOOGLE}`
       - `googleRenderer="LEGACY"`
     - Added Android `mapReady` safety fallback timer (1600 ms) so overlays are not permanently blocked if native ready callbacks are flaky.
     - Added `onMapLoaded={() => setMapReady(true)}` as an extra native-ready signal.
     - Added `mapReady` to Route QC overlay for live debugging.
  2. `src/components/PlanVisitMapPanel.tsx`
     - Applied same Android provider + legacy renderer settings for consistency.
  3. `src/components/MapPreviewModal.tsx`
     - Applied same Android provider + legacy renderer settings for consistency.
- Scope:
  - Rendering-path fix only. No route data / OSRM / bounds calculation logic was changed.
- Verification status:
  - Pending full emulator retest on your machine.
  - Local `tsc` run in this shell failed due runtime/tooling limits (Node OOM and TypeScript stack overflow), so static type-check completion is not yet available from this session.

## Pending Security Follow-Up (Google Maps Key)
- Status:
  - Old hardcoded key was removed from tracked config.
  - EAS secret `ANDROID_GOOGLE_MAPS_API_KEY` is configured with a new key.
- Do later (required for secure production use):
  1. In Google Cloud Console, use key restriction type `Android apps` (not `Websites`).
  2. Add package name: `com.wiseplan.app`.
  3. Add SHA-1 fingerprints:
     - Debug SHA-1 (local/dev):
       - `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`
     - Release SHA-1 (EAS/Play): from Play Console > App Integrity (App signing certificate).
  4. Keep API restrictions minimal:
     - Map render key: `Maps SDK for Android` only.
     - If Google address search is used, prefer a separate key for `Places API (New)` + `Geocoding API`.
- Notes:
  - Do not commit Google Maps key; use in-app Profile or env only.
  - Local shell for Android builds can set:
    - `$env:ANDROID_GOOGLE_MAPS_API_KEY="<YOUR_KEY>"`

## Goal
- Get local Android dev build running reliably on emulator (Expo dev client).
- Persist native CMake fixes through `npm install`.

## What Was Done
- Added required Android Gradle flags in `android/gradle.properties`:
  - `org.gradle.parallel=false`
  - `newArchEnabled=false`
- Added `patch-package` workflow:
  - `postinstall` script in `package.json`: `"patch-package"`
  - Created patches:
    - `patches/expo-modules-core+3.0.29.patch`
    - `patches/react-native-reanimated+3.19.5.patch`
    - `patches/react-native-screens+4.16.0.patch`
- Verified patch apply flow:
  - `npm install` runs `postinstall` and applies all 3 patches.
  - `npx patch-package --error-on-fail` succeeds.
- Added docs note in `docs/ANDROID_BUILD_STEPS.md` about patch-package and required gradle flags.
- Created commit with patch setup:
  - `434959f` (`android: persist CMake fixes with patch-package`)

## Current Runtime Notes (Emulator)
- Metro may auto-switch ports if busy (`8083` -> `8084`).
- If app is stuck on white screen / `Bundling 100%...`, treat as stuck after ~2 minutes.
- Preferred clean relaunch flow:
  1. Keep Metro terminal open on chosen port.
  2. Run:
     - `adb reverse --remove-all`
     - `adb reverse tcp:<PORT> tcp:<PORT>`
     - `adb shell am force-stop com.wiseplan.app`
     - `adb shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A<PORT>" com.wiseplan.app`

## Important
- Do not remove the 3 patch files or `postinstall: patch-package`.
- Keep the two gradle flags above for local Android dev stability.

## Latest Local Build Notes (2026-02-24)
- Java: use JDK 17 installed at `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot`. `android/gradle.properties` already pins `org.gradle.java.home` to this; keep it.
- Environment to set per shell before building:
  - `JAVA_HOME` = `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot`
  - `ORG_GRADLE_JAVA_HOME` same as `JAVA_HOME`
  - `ANDROID_HOME` / `ANDROID_SDK_ROOT` = `%LOCALAPPDATA%\Android\Sdk`
  - `ANDROID_USER_HOME` = `C:\AndroidPrefs\RouteCopilot2` (shared writable prefs path)
  - Ensure `ANDROID_PREFS_ROOT` and `ANDROID_SDK_HOME` are unset (Machine and User scope) to avoid Android prefs path conflicts.
  - `GRADLE_USER_HOME` = `<repo>\.gradle`
  - `NODE_ENV` = `development`
  - `KOTLIN_COMPILER_EXECUTION_STRATEGY` = `in-process`
  - `ANDROID_GOOGLE_MAPS_API_KEY` set to a real key (needed for MapView; app.config.js injects it into manifest and react-native-maps plugin).
- Clean stuck build artifacts before rerun (prevents "Unable to delete directory ...intermediates\javac"):
  - `rmdir /s /q node_modules\react-native-reanimated\android\build`
  - `rmdir /s /q node_modules\react-native-svg\android\build`
  - If Windows refuses to delete, `Rename-Item build build_old` then `robocopy empty_dir build_old /MIR` and delete; closing Android Studio/antivirus helps.
- Build locally (dev client, no JS bundle):
  - `cd android`
  - `.\gradlew.bat app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8082 -PreactNativeArchitectures='x86_64,arm64-v8a'`
- After build succeeds:
  - Install: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
  - Start Metro: `npx expo start --port 8082`
  - Reverse + launch dev client:
    - `adb reverse --remove-all`
    - `adb reverse tcp:8082 tcp:8082`
    - `adb shell am force-stop com.wiseplan.app`
    - `adb shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8082" com.wiseplan.app`
- Status: build runs through Gradle with JDK 17. Android Studio APK build is now working reliably without issues.

## Resolved Windows Env/ACL Issues (2026-02-24, later session)
- Root cause found:
  - Machine-level `ANDROID_PREFS_ROOT` and `ANDROID_SDK_HOME` were set to `C:\Users\Nikola Dimovski\.android`.
  - Codex build user (`desktop-1ngo64l\codexsandboxoffline`) could not write there, causing `analytics.settings` access errors and AGP init failures.
- Permanent env fix applied:
  - Removed Machine vars:
    - `[Environment]::SetEnvironmentVariable('ANDROID_PREFS_ROOT', $null, 'Machine')`
    - `[Environment]::SetEnvironmentVariable('ANDROID_SDK_HOME',  $null, 'Machine')`
  - Also remove User-scope values for same two vars if present.
  - Use only `ANDROID_USER_HOME` for prefs location.
- Shared writable prefs path created:
  - `C:\AndroidPrefs\RouteCopilot2`
  - ACL granted to local Users group (`*S-1-5-32-545`) with modify rights.
- Old blocked file cleanup:
  - Removed `C:\Users\Nikola Dimovski\.android\analytics.settings` after env migration.
- Additional locked-folder fix:
  - If build fails in `react-native-screens:mergeDebugNativeLibs` with `AccessDeniedException`, stop Gradle/Java and delete:
    - `node_modules\react-native-screens\android\build`
  - Reset ownership/ACL first if needed (`takeown` + `icacls`), then rebuild.
- Defender exclusions added to reduce random file-lock failures:
  - `C:\Users\Nikola Dimovski\RouteCopilot2`
  - `C:\AndroidPrefs\RouteCopilot2`
  - `C:\Users\Nikola Dimovski\.android`
  - `C:\Users\Nikola Dimovski\.gradle`
  - Android SDK + Android Studio paths

## Known-Good Build Shell Setup
- In a fresh PowerShell session before build:
  - `$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"`
  - `$env:ORG_GRADLE_JAVA_HOME = $env:JAVA_HOME`
  - `$env:ANDROID_PREFS_ROOT = $null`
  - `$env:ANDROID_SDK_HOME = $null`
  - `$env:ANDROID_USER_HOME = "C:\AndroidPrefs\RouteCopilot2"`
  - `$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"`
  - `$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT`
  - `cd android`
  - `.\gradlew.bat --stop`
  - `.\gradlew.bat :app:assembleDebug --no-daemon --stacktrace`

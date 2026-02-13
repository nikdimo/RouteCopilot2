# Route Copilot - Project Status
**Date:** 2026-02-11
**Current Phase:** Phase 7 – Smart Scheduling (Foundation)

## ✅ What Works
1. **Microsoft Auth:** fully working with `expo-secure-store`. 401 self-healing (auto-logout, safe init, Clear Cache).
2. **Data Pipeline:** Fetches Outlook Calendar events, geocodes addresses if needed.
3. **Logic:** Time-aware sort. Stops ordered by Schedule Time.
4. **Mark as Done (Local First):** Completed stops persisted in AsyncStorage, gray on map, strike-through in list.
5. **Map:** User location, numbered pins (gray when done), polyline, callouts → external Maps.
6. **Schedule UX:** Tap meeting → Meeting Details (edit title, time, location, notes, save). Done/Undone toggle (persists). Swipe left → delete with confirm. Arrow → native directions.
7. **Outlook integration:** Session persists (offline_access + refresh). Calendars.ReadWrite: create/edit/delete events. Contacts.ReadWrite: optional save contact after booking. Local fallback when permissions missing. Dev: Restore session.

## 🚧 Phase 7: Smart Scheduling (In Progress)
- **Step 1 ✅:** UserPreferencesContext, ProfileScreen (Buffer & Lunch).
- **Step 2 ✅:** `src/utils/scheduler.ts` – TimelineItem anchors, epoch-ms, detour scoring, getMockCoordinates (Client A/B/Køge).
- **Step 3:** OpenStreetMap search (`searchAddress`).
- **Step 4 ✅:** Plan Visit screen, gated setup→results flow. Setup: location, duration (30/60/90), timeframe (Best Match / Pick Week), CTA "Find best time". Results only after CTA: Best Options (top 3, date+time), By Day merged timeline. Timeframe: Best Match = next 14 days; Pick Week = Mon–Sun exact week. Strict gating. Hard constraints: meeting within work window (not arrive/depart); buffers waived at day boundaries (first at workStart, last at workEnd); no overlap, no lunch, no past, 15-min snap UP. Score: detour*10; slack<10:+5000; slack>90:+(slack-90)*2; empty-day:+150. Empty week: one slot per working day at workStart+preBuffer; sort dayIso asc. Events without coords block time (homeBase fallback). Explain (DEV): arriveBy, departAt, travelFeasible, constraints. "On your route" = detour ≤ 5.
- **Step 5:** Confirm & Enrich sheet, Book & Save Contact.

See **SPEC.md** for full Phase 7 spec, user stories, and logic.

## Recently fixed (2026-02-11)
- **First try vs second try:** Plan Visit now fetches the full search window (14 days for Best Match) when user taps "Find best time" instead of relying on ScheduleScreen’s single-day fetch. First tap gives correct results.
- **Detour always 54 min:** Events with location but no coordinates were falling back to homeBase, making baseline = 0 for "between" slots. We now enrich appointments with geocoding before the search so detour is correct for between-meeting slots.

## How to QA Plan Visit

1. **Midnight test:** Set device time to 00:05. Confirm day headings and suggestions are for the new day (not yesterday). Use `globalThis.__simulateNowMs` in DEV to test without changing system clock.
2. **First slot (empty day):** workStart 08:00, duration 60 → best suggestion 08:00–09:00 (not 08:15–09:15). UI may show "Arrive by 07:45" (OK).
3. **Last slot:** workEnd 17:00, duration 60 → 16:00–17:00 must be allowed (depart at 17:15 OK; buffers waived at end).
4. **Overlap test:** Create a meeting 08:00–09:00 with address. Request new meeting same day. Verify NO suggested slot overlaps 08:00–09:00. Repeat with meeting without coords.
5. **Working hours test:** Set 08:00–17:00. Meeting end may be at 17:00 (buffers waived). Confirm no meeting extends beyond 17:00.
6. **Best Match rolling window:** Ensure suggestions only within next 14 days; earliest valid if empty schedule.
7. **Pick Week isolation:** Pick week with no meetings; only that week shown, one slot per working day at start.
8. **Contact save:** Check "Also save as contact", book meeting. Meeting appears in Outlook. Contact appears in People. If permission denied, meeting still books locally + clear message.
9. **Explain (DEV):** Tap (i) on ghost card; verify prev/next, arriveBy, departAt, travelFeasible, bufferWaivedAtStart/End when at boundary.

## 🛠 Tech Stack
- React Native (Expo)
- TypeScript
- Microsoft Graph API
- AsyncStorage, expo-location, expo-auth-session, expo-secure-store
# Investigation: Different Routes on Mobile Web vs PC Web

**Bug:** Completely different routes shown on mobile web vs PC web. Native iOS/Android apps match PC web; only mobile web differs.

**Status:** Investigation only (no code changes).

---

## Root cause: two competing sources of appointment order

There are **two code paths** that can set `appointments` in `RouteContext`:

### 1. SelectedDateSync (correct order)

- **Where:** `SelectedDateSync.tsx` — runs on app mount and whenever `selectedDate` changes.
- **Flow:** Clears appointments, then `fetchForDate(selectedDate)`:
  - Fetches `getCalendarEventsRaw(token, start, end)` and **`getDayOrder(dayKey)`** in parallel.
  - Applies **`applyOrderSync(rawSorted, savedOrder)`** so the list is in the user’s **saved day order** (from Schedule reorder / Save order).
  - Sets `setAppointments(rawMerged)` (Phase 1), then again after enrichment (Phase 2).
- **Order:** Matches what the user set on Schedule (and what native apps and PC web usually see).

### 2. useLoadAppointmentsForDate (wrong order on map)

- **Where:** `useLoadAppointmentsForDate.ts` — used by **MapScreen.web** and MapScreen (native) when the Map tab is focused and appointments are empty.
- **Flow:** `load()` calls:
  - `getCalendarEvents(token, start, end)` (full fetch + enrich),
  - then **`sortAppointmentsByTime(events)`** only — **no `getDayOrder` / no `applyDayOrder`**.
  - Sets `setAppointments(sorted)`.
- **Order:** Always **calendar start-time order**, ignoring any saved day order from Schedule.

So the map’s route is built from **waypoints = [home, ...appointments in context order, home]**. If the context was last updated by `load()`, the order is by time; if by SelectedDateSync, it’s by saved order. Different order ⇒ different route (different sequence of stops and thus different OSRM polyline/ETAs).

---

## Why this shows up more on mobile web

1. **Timing / race**
   - On app load, SelectedDateSync immediately does `setAppointments([])` and starts async `fetchForDate(selectedDate)`.
   - When the user opens the **Map** tab, `MapScreen.web`’s `useFocusEffect` runs and sees `appointments.length === 0`, so it calls **`load()`**.
   - Two async flows are now updating appointments:
     - **SelectedDateSync:** `getCalendarEventsRaw` + `getDayOrder` → `applyOrderSync` → `setAppointments(rawMerged)`.
     - **Map fallback:** `getCalendarEvents` → `sortAppointmentsByTime` → `setAppointments(sorted)`.
   - **Whoever runs `setAppointments` last wins.** If `load()` finishes after SelectedDateSync’s Phase 1, the map (and any consumer of context) sees **time-sorted** order ⇒ different route than Schedule / PC.

2. **Mobile web is more likely to “win” the race**
   - Users may open the app and go straight to the Map tab (e.g. bookmark, habit, or narrow layout).
   - Map tab is lazy-loaded; when it mounts it triggers `load()` on focus.
   - On mobile, network/CPU can make `getCalendarEvents` (single enriched call) sometimes complete **after** SelectedDateSync’s raw fetch + `getDayOrder`, so the last write is the time-sorted one.
   - On PC web, users often land on Schedule first; by the time they switch to Map, SelectedDateSync has already set the ordered list and Map doesn’t call `load()` because `appointments.length > 0`. So PC often keeps the correct (saved) order.

3. **Native apps**
   - Same race exists in theory, but in practice:
     - Tab order and usage (Schedule-first) and/or faster storage/network often let SelectedDateSync’s result be the last write, so route matches Schedule.
   - So native can appear “aligned with web” (PC web) while mobile web, due to timing and usage, often ends up with the time-sorted order and a different route.

---

## Evidence in the codebase

| File | Relevant behavior |
|------|--------------------|
| `SelectedDateSync.tsx` | Fetches with `getDayOrder(dayKey)` and `applyOrderSync(rawSorted, savedOrder)`; sets appointments in **saved order**. |
| `useLoadAppointmentsForDate.ts` | Uses only `sortAppointmentsByTime(events)`; **no** `getDayOrder` / `applyDayOrder`; sets appointments in **time order**. |
| `MapScreen.web.tsx` | `useFocusEffect`: when `appointments.length === 0 && isSameDay(ctxSelectedDate, today)` calls `load()` → time-sorted list can overwrite SelectedDateSync. |
| `RouteContext.tsx` | Day order is stored only in AsyncStorage (`DAY_ORDER_PREFIX + dayKey`). No synchronous localStorage read for day order (unlike meeting counts). |
| `useRouteData.ts` | Builds `waypoints` from `appointments` in context order; same logic on all platforms. So wrong order in context ⇒ wrong route on map. |

---

## Why the routes look “completely different”

- **Order of stops** changes (e.g. Hørsholm/Stenløse first vs Copenhagen-area first).
- **OSRM** gets a different waypoint sequence ⇒ different polyline, different ETAs and leg stress (e.g. “1 late, 3 long wait” on PC vs different on mobile web).
- List and map on mobile web can show a different sequence (e.g. waypoint numbers vs list order) and different drive times/distances (e.g. “2 h 20 min • 120.9 km” on PC vs different on mobile web).

---

## Summary

- **Cause:** Map fallback `load()` in `useLoadAppointmentsForDate` sets appointments in **calendar time order** and does **not** apply saved day order. When this runs and overwrites SelectedDateSync (which uses saved order), the map shows a different route.
- **Why mobile web:** Race between SelectedDateSync and `load()`; on mobile web, usage and timing make it more likely that `load()` is the last writer, so mobile web often shows the time-sorted route.
- **Why PC and native often match:** SelectedDateSync often wins the race (Schedule-focused usage, timing), so they keep the saved order and the same route.

**Recommended direction for fix (when you decide to change code):**

1. **Option A:** Remove the Map fallback that calls `load()` when appointments are empty, and rely solely on SelectedDateSync to populate appointments (so a single source of truth and no overwrite with time-sorted list).
2. **Option B:** Keep the fallback but make it respect saved order: in `useLoadAppointmentsForDate`, after fetching events, call `getDayOrder(dayKey)` and apply the same ordering (e.g. `applyDayOrder` or equivalent) before `setAppointments`, so the fallback never writes time-only order.

No code was changed in this investigation; the above is for when you want to implement a fix.

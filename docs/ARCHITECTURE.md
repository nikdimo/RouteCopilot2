# RouteCopilot / WisePlan – Architecture & Workflow

**Last updated:** 2026-02-18

> **Related:** [SPEC.md](./SPEC.md) – product & map workflow spec | [WORKING_CONFIG.md](./WORKING_CONFIG.md) – deploy & config

---

## Overview

The app is a cross-platform route planner (mobile + web) built with React Native / Expo. Map and route logic are shared between platforms via a central hook and utilities.

---

## Shared Logic (Single Source of Truth)

### `useRouteData` hook (`src/hooks/useRouteData.ts`)

All route-related data and behavior are centralized here. Both **MapScreen** (mobile) and **MapScreen.web** consume this hook.

| Responsibility | Details |
|----------------|---------|
| **OSRM fetch** | Fetches driving routes from `router.project-osrm.org` for waypoints: home → meetings → home |
| **Waypoints** | Builds `[home, ...meetings, home]` from appointments with coordinates |
| **Depart / return times** | Computes when to leave home and return based on first/last meeting + buffers |
| **ETAs** | Arrival time at each meeting; uses OSRM legs when available, else `getTravelMinutes` |
| **Meeting durations** | Formatted strings (e.g. "30 min") from meeting start/end |
| **legStats, waitTimeBeforeMeetingMin, legStress** | Per-leg duration/distance; wait before each meeting; ok/tight/late for coloring |
| **Bounds & polyline** | Coordinates for map fit and fallback straight-line route |
| **refetchRouteIfNeeded()** | Called on mobile when screen gains focus (if route not yet loaded) |

### `dateUtils` (`src/utils/dateUtils.ts`)

Shared time/date helpers used by map screens and schedule:

| Function | Purpose |
|----------|---------|
| `parseTimeToDayMs` | Parse time string ("09:00" or "09:00 - 10:00") to ms within a day |
| `formatTime` | ms → "HH:MM" |
| `formatDurationMinutes` | Meeting duration from start/end ISO strings → "X min" or "Xh Ym" |
| `formatDurationSeconds` | OSRM leg duration (seconds) → "X min" or "X h Y min" |
| `toLocalDayKey` | Date → "YYYY-MM-DD" in local timezone |

### `routeBubbles` (`src/utils/routeBubbles.ts`)

Shared logic for segment bubbles (duration/distance labels on route legs):

| Function | Purpose |
|----------|---------|
| `haversineMeters` | Distance between two points |
| `midpointAndForward` | Midpoint M and forward point F along polyline (calls pointAlongSegmentAndForward(0.5)) |
| `pointAlongSegmentAndForward` | Point at fraction (0–1) of total distance + forward direction; web uses 0.75 for bubbles |
| `pickTipCornerSimple` | Choose bubble tip corner from screen-space right vector |
| `segmentBubblePath` | SVG path for rounded rect with one sharp corner |
| `formatDistance` | meters → "X m" or "X,Y km" |
| `offsetPolyline` | Offset polyline perpendicular for overlapping route legs |

### `osrm.ts` (`src/utils/osrm.ts`)

OSRM API client. No API key required (uses public demo server).

| Export | Purpose |
|--------|---------|
| `fetchRoute(waypoints)` | Fetch driving route; returns legs with coordinates, duration, distance, labelPoint |

---

## Map Screens – Platform Responsibilities

### Mobile (`MapScreen.tsx`)

- Uses `useRouteData()` for all route data.
- Renders with **react-native-maps** (MapView, Marker, Polyline).
- Mobile-specific: clustering, pin offsets, ETA badges, selected callout overlay.
- Segment bubbles use `leg.labelPoint` and React Native components.
- Calls `refetchRouteIfNeeded()` in `useFocusEffect` when returning to screen.

### Web (`MapScreen.web.tsx`)

- Uses `useRouteData()` for all route data.
- Renders with **react-leaflet** (MapContainer, TileLayer, Marker, Polyline).
- Web-specific: `SegmentBubblesLayer` with Leaflet `DivIcon`, collision avoidance for bubbles.
- Converts shared data to Leaflet format (e.g. `[lat, lon]` tuples).
- Calls `useLoadAppointmentsForDate` on focus when appointments are empty.

---

## Data Flow

```
Appointment loaders (populate RouteContext):
  - RootNavigator: useLoadAppointmentsForDate(undefined).load() once when authenticated (today), blocks app until done
  - ScheduleScreen: getCalendarEvents for selectedDate on focus; setAppointments after sort + applyDayOrder
  - MapScreen / MapScreen.web: useLoadAppointmentsForDate(undefined).load() on focus when appointments empty (fallback)

RouteContext (appointments)
       |
       v
useRouteData()
  - waypoints = [home, ...meetings with coords, home]
  - fetchRoute(waypoints) -> osrmRoute
  - departByMs, returnByMs, etas, meetingDurations, legStress
  - allCoordsForFit, fullPolyline
       |
       +---> MapScreen.tsx (mobile: react-native-maps)
       |
       +---> MapScreen.web.tsx (web: react-leaflet)
       |
       +---> ScheduleScreen (DaySummaryBar, leg stress in list)
```

---

## Adding or Changing Route Logic

1. Update `useRouteData.ts` for OSRM, waypoints, ETAs, depart/return.
2. Add shared helpers to `dateUtils.ts` or `routeBubbles.ts` as needed.
3. Mobile and web automatically use the new logic; only change UI in each screen if needed.

---

## Related Files

| File | Role |
|------|------|
| `src/context/RouteContext.tsx` | Appointments state; markEventAsDone/unmark; saveDayOrder/applyDayOrder; optimize(userLocation) |
| `src/context/UserPreferencesContext.tsx` | homeBase, pre/post buffer, homeBaseLabel |
| `src/hooks/useLoadAppointmentsForDate.ts` | Loads Outlook events for a date into RouteContext. Used by: RootNavigator (mount), MapScreen/MapScreen.web (focus when empty). ScheduleScreen uses getCalendarEvents directly for its selected date. |
| `src/utils/scheduler.ts` | `getTravelMinutes` (fallback when OSRM unavailable) |

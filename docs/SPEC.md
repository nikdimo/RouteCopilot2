# WisePlan – Product & Technical Spec

**Last updated:** 2026-02-18

---

## Product Overview

WisePlan is a daily route planner that syncs with Outlook Calendar, optimizes visit order, and shows a map with driving directions and ETAs.

---

## Map View – Spec & Workflow

### Data Sources

- **Appointments:** From RouteContext (Outlook Calendar via Graph API)
- **Routing:** OSRM (public demo server, no API key)
- **User preferences:** Home base, pre/post meeting buffers, work hours

### Workflow

1. **Initial load:** `RootNavigator` loads today via `useLoadAppointmentsForDate` when authenticated, then shows app. User opens Map tab → `MapScreen` / `MapScreen.web` mounts, reads from RouteContext.
2. If appointments empty on focus → `useLoadAppointmentsForDate`.load() fetches today’s events (fallback when Map has triggerLoadWhenEmpty)
3. `useRouteData` builds waypoints: `[home, meeting1, meeting2, ..., home]` from appointments with coordinates
4. `useRouteData` calls `fetchRoute(waypoints)` → OSRM returns road-following legs; falls back to `getTravelMinutes` when OSRM unavailable
5. Map renders:
   - Pins for home (H) and meetings (1, 2, 3…)
   - OSRM polylines (green for first leg, blue for others; late legs in red) or straight-line fallback
   - Segment bubbles: duration + distance (mobile: leg labelPoint; web: 75% along leg)
   - Details overlay: depart by, return by, per-meeting ETA
   - Stress coloring: ok / tight (&lt; 5 min wait) / late
6. Mobile: `refetchRouteIfNeeded()` runs on focus if route not yet loaded

### Shared Logic (Single Source of Truth)

| Layer | File | Role |
|-------|------|------|
| Hook | `src/hooks/useRouteData.ts` | OSRM fetch, waypoints, ETAs, depart/return, polyline, legStress (ok/tight/late) |
| Utils | `src/utils/dateUtils.ts` | parseTimeToDayMs, formatTime, formatDurationMinutes, formatDurationSeconds |
| Utils | `src/utils/routeBubbles.ts` | midpointAndForward, pointAlongSegmentAndForward, pickTipCornerSimple, segmentBubblePath, formatDistance, offsetPolyline |
| API | `src/utils/osrm.ts` | fetchRoute(waypoints) |

### Platform Split

| | Mobile (`MapScreen.tsx`) | Web (`MapScreen.web.tsx`) |
|---|--------------------------|---------------------------|
| Map library | react-native-maps | react-leaflet |
| Uses | `useRouteData()` | `useRouteData()` |
| Specifics | Clustering, pin offsets, ETA badges, refetch on focus, triggerLoadWhenEmpty nav param | SegmentBubblesLayer (75% along leg), Leaflet DivIcon, load on empty |

---

## Deploy Workflow

See [WORKING_CONFIG.md](./WORKING_CONFIG.md) for deploy steps.

---

## Architecture Reference

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed data flow and file roles.

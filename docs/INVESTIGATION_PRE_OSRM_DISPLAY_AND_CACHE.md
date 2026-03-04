# Investigation: Display Before OSRM Finalised & Cache Causing Clustered Points at Home

**Concern:** Points and routes might be shown on the map before OSRM has finished; points could appear clustered at the home base; that state might be stored in cache and still appear after refresh.

**Status:** Investigation only (no code changes).

---

## 1. Are points and routes displayed before OSRM is finalised?

**Yes.** The map does not wait for OSRM before drawing.

### What is shown before OSRM returns

- **Markers (numbered pins 1, 2, 3, 4…)**  
  Always come from **current appointment coordinates** (`coords` → `coordList`).  
  They are drawn as soon as `coords.length > 0`. No dependency on OSRM.

- **Route line (polyline)**  
  - **MapScreen.web:** Uses either  
    - `osrmRoute?.legs` (when OSRM has returned), or  
    - **`fullPolyline`** when there is no OSRM result yet.  
    `fullPolyline` is `[home, ...meetingCoords, home]` — straight segments between waypoints. So the **route line** is shown immediately from current waypoints; it is not “from OSRM” until OSRM has run.  
  - **MapScreen (native):** Can also show **`cachedPolylineFromSession`** (faded) while `routeLoading` is true. So on native, a **previous session’s** OSRM polyline can be shown before the current OSRM call finishes.

So:

- **Points** = always from current `coords` (appointment coordinates).
- **Route** = before OSRM: on web = `fullPolyline` (straight segments); on native = optionally cached polyline + main polyline logic.

Nothing waits for OSRM to be “finalised” before showing something.

---

## 2. What is stored in the route cache?

**Single cache:** `LAST_ROUTE_CACHE_KEY` (`wiseplan_lastRoute`) in AsyncStorage.

**Stored shape:**

```ts
{
  waypointsKey: string,   // "lat,lon|lat,lon|..." for [home, ...meetings, home]
  coordinates: Array<{ latitude, longitude }>,  // OSRM route polyline (full shape)
  savedAt: number
}
```

- **Written only when** OSRM returns successfully and `route?.coordinates?.length` is truthy.
- **Key:** `waypointsKey` = exact waypoint sequence (6 decimals). Same sequence ⇒ same key ⇒ same cache entry.
- **Value:** Only the **OSRM polyline** (the line along the road).  
- **Not stored:** Marker positions, appointment list, or any “pre-OSRM” state. Marker positions are always taken from current `coords` in memory.

So the cache **cannot** store “where the pins are”. It can only store a previous OSRM **route line** for a given waypoint sequence. If that sequence was wrong (e.g. all home), the cached line can be wrong (e.g. degenerate), but the **clustering at home** comes from **coordinates on the appointments**, not from this cache.

---

## 3. How could points appear “clustered at home” and persist after refresh?

The only way markers 1–4 sit at the home base is if the **appointments** have **coordinates equal to (or very near) home** in the data the app is using.

### 3.1 Where “home” coordinates can come from

- **Geocoding fallback**  
  In `geocoding.ts`, `geocodeContactAddress` is used when enriching calendar events via contact addresses. If every variation of the address fails, it returns:

  ```ts
  return { success: true, lat: DEFAULT_HOME_BASE.lat, lon: DEFAULT_HOME_BASE.lon, usedFallback: true };
  ```

  So failed contact-address geocoding can assign **home** to an event. That is used in `enrichCalendarEventsWithContactAddresses` in `graph.ts`: events with a location but no coordinates get contact address → geocode → if that returns “success” with fallback, the event gets `coordinates = home`. If several events fail the same way, several points end up at home → they appear “clustered” at home.

- **Calendar/Graph**  
  Events can already have coordinates from the API. If the API had wrong data, that could also place points at one place, but the **documented** fallback that forces “home” is the one above.

So “points clustered at home” is explained by **appointment coordinates being set to (or near) home**, not by the route cache.

### 3.2 Why it can “persist after refresh”

- **Refresh** (e.g. Schedule “Refresh” / `triggerRefresh`) causes:
  - SelectedDateSync to clear the day cache and **refetch** calendar + **re-run enrichment** (including geocoding).
- If geocoding **again** fails for the same events and again uses the home fallback, you get the **same** coordinates (home) → same `waypoints` → same `waypointsKey`.
- Then:
  - **Markers** are still at home because **appointments still have home in `coordinates`** after re-enrichment.
  - **Route cache:** Because `waypointsKey` is unchanged, the next time the route effect runs it loads the **same** cached OSRM polyline (the one from the previous “all home” or degenerate request) into `cachedPolylineFromSession`. So:
  - **On native:** That cached (degenerate) polyline can be drawn (faded) while loading, so the “wrong” route can appear again.
  - **On web:** MapScreen.web **does not** render `cachedPolylineFromSession` at all; it only uses `osrmRoute` or `fullPolyline`. So on web, “same after refresh” is from **same appointment coordinates** (and thus same `fullPolyline`), not from re-displaying the cached polyline.

So:

- **Points** stay clustered at home after refresh because **re-enrichment keeps writing home** into event coordinates, not because of the route cache.
- **Route line** can look the same after refresh because (1) waypoints are still the same (home…), and (2) on native we may re-show the cached degenerate polyline; on web we keep showing the same degenerate `fullPolyline`.

---

## 4. Can a “pre-OSRM” or “wrong” state be stored and then shown from cache?

- **What gets cached:** Only a **successful OSRM response** for the **current** `waypointsKey`. There is no cache of “pre-OSRM” or “intermediate” state.
- **When it’s used:** When `waypointsKey` matches a stored key and TTL is ok, that stored **polyline** is loaded into `cachedPolylineFromSession` and (on native) drawn faded while the new OSRM request is in flight. So:
  - The only “wrong” thing that can persist via cache is a **previously** saved OSRM polyline for the **same** waypoint sequence (e.g. all home).
  - That does **not** move the **markers**; markers are always from current `coords`. So “points clustered at home” is not “stored in cache” in the sense of marker positions; it’s from **coordinates on the events**.
  - If, in an earlier session, waypoints were (wrongly) all home and OSRM returned something (e.g. degenerate), that **line** was cached. Later, if waypoints are again all home (because geocoding failed again), we load that **same** cached line. So the **route line** can look wrong and “same after refresh” due to cache; the **points** look wrong because the **data** (event coordinates) is still home.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| Are points/routes shown before OSRM is finalised? | **Yes.** Markers use current `coords`; route uses `fullPolyline` (web) or cached/current polyline (native). Nothing waits for OSRM. |
| Is “pre-OSRM” or “wrong” state stored in cache? | **No.** Only a successful OSRM **polyline** is stored, keyed by `waypointsKey`. No marker positions or pre-OSRM state. |
| Why do points cluster at home? | **Appointment coordinates** are set to (or near) home, mainly via **geocodeContactAddress** fallback when contact-address geocoding fails. |
| Why does it persist after refresh? | Refresh re-fetches and re-enriches. If geocoding still fails, events get **home** again → same waypoints → same markers and (on web) same `fullPolyline`; on native the **cached** polyline for that `waypointsKey` is also reloaded and drawn. |
| Does the cache “store” the clustered points? | **No.** The cache stores only the OSRM **route line**. Clustering at home is from **event coordinates**; the cache can only re-show a previously saved **line** for the same (e.g. all-home) waypoints. |

So your worry is partially right: we **do** display before OSRM is finalised, and the **route** cache can re-show an old (e.g. degenerate) line when waypoints are unchanged. But the **points** being clustered at home and staying that way after refresh come from **coordinates on the appointments** (and the geocode fallback to home), not from the route cache. The cache can make the **line** look wrong and persistent; it does not create or store the “points at home” — the data does.

No code was changed; this is for when you want to implement fixes (e.g. avoid using home as geocode fallback for calendar enrichment, or avoid caching/writing cache when waypoints are degenerate, or delay showing markers until enrichment has resolved coordinates).

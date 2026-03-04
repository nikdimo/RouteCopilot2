# Why points 1–4 appear clustered at home on the map (display only)

**Scope:** Order and numbers (1, 2, 3, 4) are correct; only the **visual positions** of the markers on the map are wrong — they appear at/near the home base.

---

## How marker positions are determined (MapScreen.web)

1. **`coords`** = appointments that have `coordinates` (from `useRouteData()` ← RouteContext).
2. **`coordList`** = `coords.map(a => a.coordinates)` → list of `{ latitude, longitude }` for each waypoint.
3. **`WaypointMarkersLayer`** gets `coordList` and calls **`getMarkerPositions(coordList, zoom, …)`**.
4. **`getMarkerPositions`** (mapClusters.ts):
   - Groups entries by **`coordKey`** = `latitude.toFixed(5),longitude.toFixed(5)` (same location to ~1 m).
   - For each group: one marker per index; if the group has several indices (same key), they are **offset** in longitude so pins sit side-by-side.
5. Each **`<Marker position={pos} />`** uses `pos` = that computed position (either the single point or the offset within the cluster).

So every waypoint marker’s position comes **only** from **`coordList`**, i.e. from **each appointment’s `coordinates`**. The map **never** uses `homeBase` (or any single “home” point) for waypoint positions — only for the separate “H” home marker and for route legs.

---

## What can cause “1 2 3 4 clustered at home”

So “points 1 2 3 4 clustered at home” can only happen if the **positions we feed the map** are at or near home. In code terms:

- **`coordList`** has four entries.
- All four round to the **same** `coordKey` (5 decimals).
- That shared position equals (or is very close to) the home base.

So:

- Either all four **appointment coordinates** are literally the same as home (or identical to each other and near home),
- Or they are so close to each other (and to home) that after `toFixed(5)` they share one `coordKey` and are drawn as one cluster; if that cluster is at home, they all look “at home”.

So the **only** way the **map display** shows 1–4 clustered at home is:

**The coordinates stored on the appointments (and thus in `coordList`) are all at or very near the home base.**

The map is just drawing what it’s given; it doesn’t substitute home for “unknown” or “loading” positions.

---

## Where those coordinates come from (data side)

The map doesn’t set coordinates; it only reads them from context. So “clustered at home” is a **data** issue, not a bug in the map’s position math or clustering:

1. **Contact-address geocode fallback**  
   When enriching calendar events, **`geocodeContactAddress`** (geocoding.ts) is used for contact addresses. If every attempt fails, it returns **`DEFAULT_HOME_BASE`** (Copenhagen) so the app can continue:

   ```ts
   return { success: true, lat: DEFAULT_HOME_BASE.lat, lon: DEFAULT_HOME_BASE.lon, usedFallback: true };
   ```

   That result is then written onto the event as `coordinates` in **`enrichCalendarEventsWithContactAddresses`** (graph.ts). So any event that gets its location from a contact and whose address fails to geocode can end up with **coordinates = home**. If several events do, they all get the same (or same-to-5-decimals) position → one cluster at home on the map.

2. **Other geocode paths**  
   Other flows (e.g. raw `geocodeAddress` for event location) do not use this “return home on failure” pattern; they leave coordinates unset on failure. So the only place that **assigns home** to event coordinates when things fail is the contact-address fallback above.

3. **Graph/API**  
   If the API already had the same coordinates for several events (e.g. all at one place), that would also produce one cluster at that place; if that place is home, again “clustered at home”.

So in practice, the cause of “points 1 2 3 4 clustered at home” on the map is:

- **Display:** Marker positions come only from `coordList` (appointment coordinates). No use of home for waypoint positions.
- **Data:** Those coordinates are all at/near home because they were set that way upstream — most plausibly by **`geocodeContactAddress`** returning **`DEFAULT_HOME_BASE`** when contact-address geocoding fails, so several meetings get the same (home) coordinates and the map draws one cluster at home.

Fixing the **display** (so 1–4 are not drawn at home when they shouldn’t be) therefore means fixing **where** and **when** event coordinates are set to home (e.g. avoid using home as fallback for calendar enrichment, or only use it when explicitly “use home” rather than on any failure). The map code itself does not need to change for this specific “clustered at home” behaviour.

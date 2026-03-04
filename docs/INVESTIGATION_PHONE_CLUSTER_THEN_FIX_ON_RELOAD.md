# Investigation: Phone Shows Clustered Points First, Same as Web After Reload

**Observed:** Same day, same meetings. PC web shows correct map (points 1–6 spread, correct polyline). Phone browser initially shows points 1–4 (and H) clustered at one spot; after some time and a reload, the phone shows the same correct map as the web.

**Conclusion:** The underlying data (coordinates) is correct — web proves that. On the phone, something caused the **first load** to display with coordinates that were all at the same (home) location; a **full reload** then ran the same data pipeline again and produced correct coordinates, so the map matched the web.

No code changes in this investigation.

---

## Why the data is correct

- Web (same day, same meetings) shows correct positions and polyline.
- So the API and the enrichment pipeline **can** produce correct coordinates.
- After reload, the phone shows the same as the web, so the phone is using the same correct pipeline when it runs again.

So the issue is not “coordinates are wrong in the backend” but “on the phone, the **first** run of the pipeline sometimes produced (or displayed) coordinates that were all at one place (home), and a **second** run (after reload) produced correct ones.”

---

## How the phone gets the data it draws

1. **SelectedDateSync** (single source for the day’s list):
   - **Phase 1:** Fetches raw calendar events + saved day order → `setAppointments(rawMerged)`.
   - **Phase 2:** Runs **enrichCalendarEventsAll** (geocode + contact enrichment) in the background → when it finishes, **setAppointments(enrichedMerged)**.
2. **dayCache** is in-memory only (no localStorage). So a **full page reload** clears it and forces a new fetch + full enrichment again.
3. Map markers use **coordList** = `coords.map(a => a.coordinates)` from context. So whatever appointments are in context (and have `coordinates`) is what the map draws.

So “clustered at home” on first load means: at that moment, the appointments in context had coordinates that were all at (or rounded to) the same place. “Correct after reload” means: after reload, the appointments in context had the correct, spread-out coordinates.

---

## What can make the first load have “all same (home)” coordinates

The only place in the code that **assigns** the home base as coordinates when something fails is **geocodeContactAddress** (geocoding.ts): when every address variation fails, it returns `DEFAULT_HOME_BASE` so the app can continue.

That is used in **enrichCalendarEventsWithContactAddresses** (graph.ts):

- For events that still have no coordinates after **geocodeEventsAsync**, we look up a matching Outlook contact and geocode the **contact’s** address via **geocodeContactAddress**.
- If **geocodeContactAddress** returns success (including when it uses the home fallback), we write that result (including home) onto the event.

So the pipeline that can produce “all at home” is:

1. **geocodeEventsAsync** runs first (geocode each event’s `location` with Nominatim).  
   - On **web** it uses **geocodeAddress** (cache then Nominatim).  
   - If Nominatim fails (network, timeout, rate limit), the event keeps **no** coordinates (we do not set home here).
2. **enrichCalendarEventsWithContactAddresses** then runs for events that still have no coordinates: contact lookup → **geocodeContactAddress(contact.formattedAddress)**.  
   - **geocodeContactAddress** tries several address variations, each via **geocodeAddress** (cache + Nominatim).  
   - If **all** variations fail, it returns **success: true** with **DEFAULT_HOME_BASE** (home fallback).  
   - That result is then written onto every event that matched that contact/location.

So we get “points 1–4 at home” when:

- Phase 2 completes,
- Those events get their coordinates from the **contact** path (contact address),
- And **geocodeContactAddress** used its **fallback to home** for them (e.g. because every **geocodeAddress** call failed).

That fits “same day, same meetings, correct on web, wrong on phone first, correct after reload”:

- **First load on phone:** Enrichment runs; on mobile, Nominatim can be slower or more likely to fail (network, timeout, rate limit, different UA). So **geocodeAddress** fails for the contact-address variations → **geocodeContactAddress** returns home → several events get home → map shows clustered.
- **Reload on phone:** Full reload clears in-memory **dayCache** and re-runs the same pipeline. Second time, Nominatim may succeed (network better, no transient failure, or different timing), so **geocodeAddress** returns real coords → **geocodeContactAddress** does not use fallback → events get correct coordinates → map matches the web.

So the most plausible cause is: **on first load on the phone, geocoding (Nominatim) failed for the contact-address path and the home fallback was used; on reload, geocoding succeeded, so the same pipeline produced correct coordinates.**

---

## Why “after some time” might not fix it without reload

- **dayCache** is in-memory. So after the first load, the day is cached with whatever coordinates we had at that moment (e.g. home).  
- Switching tabs or date and back would serve from **dayCache** and keep showing the same (wrong) data until something forces a refetch.
- **Triggering refresh** (e.g. Schedule “Refresh”) clears the day from **dayCache** and runs **fetchForDate** again (Phase 1 + Phase 2). So a **refresh** (without full page reload) could also fix the map if the second enrichment then succeeds.  
- A **full page reload** always clears **dayCache** and runs a completely fresh fetch + enrichment, which matches “after reload it shows the same as the web.”

So “after some time and reload” is consistent with: the fix happens when we run the pipeline again (reload or refresh), and the second time geocoding succeeds instead of falling back to home.

---

## Summary

| What | Why it fits |
|------|-------------|
| Data is correct | Web shows correct map for same day/meetings; phone matches web after reload. |
| First load on phone showed clustered | Enrichment completed but **geocodeContactAddress** used **home fallback** (Nominatim failed on mobile for contact addresses). |
| After reload, phone matched web | Reload cleared **dayCache** and re-ran fetch + enrichment; second time **geocodeAddress** succeeded, so no fallback and correct coordinates. |
| No bug in “order/numbers” | Order and labels were always correct; only the **positions** drawn were wrong when coordinates were (temporarily) set to home by the fallback. |

So the root cause is: **on the first load on the phone, geocoding for the contact-address path failed (e.g. Nominatim timeout/network on mobile), so the home fallback was used and several events got the same (home) coordinates; after reload, the same pipeline ran again and geocoding succeeded, so coordinates were correct and the map matched the web.** No code was changed; this is for when you want to implement mitigations (e.g. avoid using home as fallback for calendar enrichment, retry geocoding on failure, or show a “geocoding failed, tap to retry” state instead of silently using home).

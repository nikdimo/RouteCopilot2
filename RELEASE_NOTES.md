# WisePlan – Release Notes

## 2026-02-16 – TestFlight & Auth Fixes

**TestFlight:** White screen fixed. Builds now show app correctly. Causes: `expo-splash-screen` (preventAutoHideAsync, hideAsync) and `newArchEnabled: false` in app.json. EAS build + submit; Microsoft auth works on device.

**Web/mobile auth:** Microsoft sign-in now works on PC and mobile browsers. Fixes: `localStorage` for code_verifier (survives redirect); redirect flow for mobile web (no popup); production redirect URI `https://wiseplan.dk/app/`; native `wiseplan://auth`; landing page redirects `?code=` to `/app/`.

**Redirect loop:** Fixed ERR_TOO_MANY_REDIRECTS with Cloudflare SSL = Full and nginx `location = /` block.

---

## Version 1.0.0 (Initial Release)

---

### For Internal Testers (TestFlight / Play Internal)

**What’s new:**
- **Sign in with Microsoft** – Use your work or personal Microsoft account
- **Outlook Calendar** – View and manage your schedule; events are sorted by time
- **Map view** – See your meetings on a map with numbered pins; tap for details or directions
- **Mark as done** – Check off completed visits; progress is saved locally
- **Plan Visit** – Find best meeting times based on your calendar and travel
- **Profile** – Set work hours, buffer times, and lunch break
- **Meeting details** – Edit title, time, location, and notes; sync changes to Outlook

**How to test:**
1. Sign in with a Microsoft account (Outlook)
2. Allow calendar and contacts access
3. Add a few meetings with addresses to your Outlook calendar
4. Check map, schedule, and Plan Visit features

**Known limitations:**
- Plan Visit uses mock coordinates for some addresses; real geocoding may be added later
- Local development login (localhost) may show redirect errors; production (wiseplan.dk) works

---

### For App Store / Play Store Listing

**Short (for store “What’s new”):**

> WisePlan 1.0 – Your AI logistics assistant. Sign in with Microsoft, see your Outlook calendar on a map, mark visits as done, and find the best times for new meetings.

**Full description:**

> **WisePlan** helps field reps and mobile workers manage their schedule and visits.
>
> • **Microsoft sign-in** – Secure login with your Microsoft 365 or personal account  
> • **Outlook integration** – View and edit calendar events; changes sync to Outlook  
> • **Map view** – See visits on a map with numbered pins and directions  
> • **Smart scheduling** – Suggest best meeting times based on your calendar and travel  
> • **Mark as done** – Track completed visits; progress saved on your device  
> • **Profile** – Set work hours, buffer times, and lunch break for smarter suggestions  
>
> Requires a Microsoft account and Outlook calendar access.

---

### Technical Notes (for developers)

- **Auth:** Microsoft OAuth 2.0 with PKCE; tokens stored in SecureStore (native) / AsyncStorage (web)
- **Platforms:** iOS, Android, Web (wiseplan.dk/app/)
- **Stack:** Expo 54, React Native, Microsoft Graph API

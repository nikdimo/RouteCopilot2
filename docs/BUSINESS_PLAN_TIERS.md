# WisePlan - Business Plan (Tiers v2)

**Purpose:** Authoritative tier spec for go-to-market: four plans (Free + three paid: Basic, Pro, Premium). Client-facing notifications and AI assistant are Premium only.

---

## 1. Tier table (final, customer-facing)

| Feature | Free | Basic | Pro | Premium |
|---------|------|-------|-----|---------|
| Local-only meetings | Yes | Yes | Yes | Yes |
| Calendar sync | No | 1 calendar | Unlimited | Unlimited |
| Create contacts | No | Yes | Yes | Yes |
| Address search (Nominatim) | Yes | Yes | Yes | Yes |
| Better geocoding (e.g. Google) | No | Yes | Yes | Yes |
| Route on map (OSRM) | Yes | Yes | Yes | Yes |
| Real-time traffic on routes | No | No | Yes | Yes |
| "Running late" alert (to you only) | No | No | Yes | Yes |
| Route optimization (best order) | No | No | Yes | Yes |
| Export day plan (PDF/link) | No | No | Yes | Yes |
| Recurring meeting templates | No | No | Yes | Yes |
| AI assistant + notify clients (SMS/email + ETA) | No | No | No | Yes (opt-in) |

**One-sentence value per tier:**
- **Free:** Plan meetings on your phone; nothing syncs to calendar or contacts.
- **Basic:** Sync to one Outlook calendar and get reliable address search.
- **Pro:** Multiple calendars, real-time traffic, we tell you when you're late, optimize your route and export your day.
- **Premium:** Everything in Pro plus we draft and send professional "running late + ETA" messages to your clients by email/SMS when you approve.

---

## 2. Definitions

- **Calendar sync:** Read/write events to the user's Microsoft Outlook calendar(s) via Graph API. "One calendar" = single calendar in the connected account; "Unlimited" = all calendars in that account (or multiple accounts if supported).
- **Better geocoding:** Address search and lat/lon resolution using a commercial provider (e.g. Google Places/Geocoding) for higher accuracy and rate limits. Free tier uses Nominatim (OpenStreetMap) only.
- **Real-time traffic:** Driving durations and route geometry from a traffic-aware provider (e.g. Mapbox, Google Directions) so "running late" and ETA reflect current conditions.
- **Running late:** ETA at next stop > meeting start time + N minutes (e.g. 5-10). Threshold is configurable; same logic for Pro (alert to you) and Premium (alert to you + optional client message).
- **AI assistant (Premium):** Drafts and sends professional "running late + ETA" messages to your clients by email/SMS. User must enable per meeting or in settings; no automatic send without user approval or explicit opt-in.
- **Traffic-aware:** Routing API that uses live or typical traffic data; distinct from OSRM (no traffic).

---

## 3. Pricing and limits

**Decision (launch recommendation): USD list pricing**

| Plan | Monthly | Annual (effective/month) | Notes |
|------|---------|---------------------------|-------|
| **Free** | $0 | $0 | Local-only meetings, no calendar/contact sync |
| **Basic** | **$12** | **$10** | 1 Outlook calendar + better geocoding |
| **Pro** | **$29** | **$24** | Traffic-aware routing + late alerts + optimization/export/templates |
| **Premium** | **$59** | **$49** | Pro + AI client notifications (email/SMS + ETA) |

| Item | Launch decision |
|------|-----------------|
| **Billing cadence** | Monthly and annual (annual price above is ~17-20% discount). |
| **Trial** | 14-day Premium trial, one trial per user/account. |
| **Free tier limits** | Unlimited local meetings (adoption-first). Revisit if abuse appears. |
| **Basic limits** | 1 calendar, no traffic, no client notifications. |
| **Pro limits** | Traffic lookups: 3,000/month fair use. |
| **Premium included usage** | 100 SMS/month, 2,000 email notifications/month, 500 AI drafts/month. |
| **Premium overage** | SMS: $0.05/message. Email: $0.002/message. |

**Benchmark references used for these price points (checked 2026-02-27):**
- Routific pricing page (Starter/Essentials/Professional): https://routific.com/pricing
- OptimoRoute pricing page (Lite/Pro): https://optimoroute.com/pricing
- Housecall Pro pricing page (Basic/Essentials/MAX): https://www.housecallpro.com/pricing/
- Calendly pricing page (Free/Standard/Teams/Enterprise): https://calendly.com/pricing
- Google Maps Platform pricing page (Essentials/Pro/Enterprise bundles): https://mapsplatform.google.com/pricing/
- Twilio SMS pricing page (US messaging starting rate): https://www.twilio.com/en-us/sms/pricing/us

**Upgrade triggers in-product (one primary trigger per tier):**
- **Free -> Basic:** "Save to calendar" / "Sync to Outlook" (or first attempt to create a contact).
- **Basic -> Pro:** "Add another calendar" / "See traffic on route" / "Optimize my route."
- **Pro -> Premium:** "Notify my client I'm late" / "Send ETA to client."

---

## 4. Compliance and consent (messaging features)

**Premium only:** Automated or AI-assisted email/SMS to clients (running late + ETA).

- **Consent and control:** Messages are sent only when the user has explicitly enabled "Notify clients when I'm late" (global or per-client/per-meeting). In-app line: "You control when we contact your clients; we only send messages you approve or have turned on in settings."
- **Audit:** Log when a client message was sent, to whom, and which tier/user triggered it. Retain for compliance and support.
- **GDPR (EU/EEA):** Legal basis for processing client contact data (e.g. consent or legitimate interest); privacy notice and data retention. Opt-in for marketing; transactional (running late + ETA) may be under legitimate interest or contract - confirm with legal.
- **TCPA (US):** Prior express consent for automated SMS; honor opt-out (e.g. "Reply STOP to opt out"). Document consent and opt-out handling.
- **CAN-SPAM (US email):** Unsubscribe in commercial email; for transactional "running late + ETA" emails, clarify with legal whether they are transactional or require unsubscribe. Identify message as from WisePlan/user.
- **Region-specific:** Before rolling out SMS/email in a new region, confirm local telecom and privacy rules (e.g. consent, opt-out, data retention).

---

## 5. Engineering gating checklist

1. **Subscription tier:** Add `subscriptionTier: 'free' | 'basic' | 'pro' | 'premium'` to auth/preferences (or from billing provider).
2. **Local meeting store:** Implement create/edit/delete for free users (e.g. AsyncStorage keyed by day). No `createCalendarEvent` or `createContact` for Free.
3. **Calendar/contacts:** Gate `createCalendarEvent`, `createContact`, and `getCalendarEvents` (sync) behind Basic and above.
4. **Geocoding:** Free = Nominatim only. Basic and above = allow better geocoding (e.g. `useGoogleGeocoding` + key or WisePlan-provided key).
5. **Routing:** OSRM for Free/Basic. Pro and Premium = traffic-aware API for durations and late detection.
6. **Pro features:** Traffic-aware routing, late-detection logic, in-app/push "running late" alert to user only. Route optimization, export day (PDF/link), recurring templates. No client messages.
7. **Premium only:** Gate AI assistant and send-email/SMS-to-client behind `subscriptionTier === 'premium'`. Enforce consent/opt-in before sending.
8. **Subscribe CTA:** Prominent red CTA that looks good, not alarming (e.g. red accent or gradient, not full red screen; clear typography, one primary button; avoid error/warning look). Show on "Save to calendar", "Sync", or persistent banner for Free. Copy: "Sync to your calendar and get smarter routes - upgrade to Basic, Pro, or Premium."

---

## 6. Product and copy notes (internal)

- **Free vs Basic:** In UI and marketing, say Free = "basic address search" (Nominatim), Basic = "better address search" (faster, more accurate) so the difference is clear.
- **Pro:** Explicit copy: "We tell you when you're late - you decide whether to text or call the client." Avoids confusion with Premium (we message the client).
- **Premium:** One-line definition in UI: "Drafts and sends professional 'running late + ETA' messages to your clients by email/SMS when you approve."
- **Naming:** "Premium" is the top tier. If targeting teams later, consider "Business" or "Pro Plus" for that tier.

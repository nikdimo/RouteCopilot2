# Phase 7: Smart Scheduling & Contact Intelligence

**Goal:** Transform the app from a passive viewer into an active Logistics Assistant that optimizes the user's route and cleans their Outlook data.

---

## 1. Core Philosophy

> **"Clean Input, Optimized Output."**

We do not trust raw text input. We force the user to:
1. **Validate the Location (Where)** first
2. Then **mathematically solve the Time (When)**
3. Finally **enrich the Identity (Who)**

---

## 2. User Stories

| As a... | I want to... | So that... |
|---------|--------------|-------------|
| Field driver | Set my post-meeting buffer (e.g., 15 min) | The app never suggests back-to-back meetings I can't realistically make |
| Field driver | Define a "floating lunch" window (11:30–13:30, 30 min) | The app protects my lunch slot when booking new visits |
| Field driver | Set my working hours (08:00–17:00) | No travel or meeting extends beyond my shift |
| Field driver | Search by client, address, or postal code | I can quickly find where I need to go |
| Field driver | See smart slots ranked by detour cost (least added driving first) | I pick the optimal time without mental math |
| Field driver | See proposed slots as "ghost cards" in my timeline | I understand how a new visit fits into my day |
| Field driver | Confirm a slot and optionally save the contact to Outlook | I keep my CRM clean and have phone numbers for drivers |
| Logistics manager | Low-detour slots ranked first | New visits slot into existing routes with minimal extra driving |

---

## 3. The Logic Engine ("The Brain")

### A. Global Constraints (User Profile)

| Constraint | Definition | Rule |
|------------|------------|------|
| **Post-Meeting Buffer** | e.g., 15 min | Effective Duration = Meeting Duration + Buffer. A 45m meeting consumes a 60m slot. |
| **Floating Lunch Block** | 30-min block between 11:30 and 13:30 | If booking creates a gap < 30 min in this window, **REJECT** the slot. Lunch "slides" to fit. |
| **Working Hours** | e.g., 08:00 – 17:00 | No travel or meeting can extend beyond 17:00. |

### B. The Scoring Algorithm (Incremental Detour / Køge Logic)

All time calculations use **epoch milliseconds** (never compare Date objects directly). All day keys use **device local time** (toLocalDayKey).

| Concept | Logic |
|---------|-------|
| **prevDepartMs** | (Prev is meeting) ? Prev.endMs + postBuffer : Prev.timeMs |
| **nextArriveByMs** | (Next is meeting) ? Next.startMs - preBuffer : Next.timeMs |
| **Gap** | `(nextArriveByMs - prevDepartMs) / 60000` minutes |
| **Required** | `TravelTo + preBuffer + duration + postBuffer + TravelFrom` |
| **Slack** | `Gap - Required` (spare time; must be ≥ 0 for valid slot) |
| **Baseline** | `getTravel(Prev.coord, Next.coord)` – drive if we skip the new stop |
| **Detour** | `(TravelTo + TravelFrom) - Baseline` – added driving for the new visit |
| **Score** | Lower is better. Formula: `score = detour*10`; if slack<10 add 5000; if slack>90 add `(slack-90)*2`; empty-day +150 |

**Hard constraints (slot discarded if any fails):**
- Meeting within work window: meetingStartMs ≥ dayWorkStartMs, meetingEndMs ≤ dayWorkEndMs (constrain the meeting itself, not arrive/depart buffers)
- Day-boundary waiver: first meeting may start at workStart; last meeting may end at workEnd (buffers waived at start/end anchors)
- No overlap with any existing event (including events without coords)
- Meeting interval must not overlap lunch window (MVP-simple)
- meetingStartMs ≥ now + preBuffer (no past slots)
- 15-min snap UP; if snapping breaks feasibility, discard

**Travel leg:** `ceil((haversineKm * roadFactor / speedKmh) * 60)` – road factor by distance, speed by time-of-day.

---

## 4. User Interface & Flow

### Screen A: "Plan Visit" (The Input)

| Element | Behavior |
|--------|----------|
| **Entry** | + button on main Schedule Screen |
| **Search Bar** | "Search Client, Address, or Postal Code" – Hybrid (Outlook Contacts + OpenStreetMap) |
| **Contact with no address** | → Prompt: "Enter Address" |
| **Address selected** | → Lock Location, Proceed to Time |
| **Filters** | Duration (30m, 60m, 90m) \| Timeframe (Anytime / Pick Week) |
| **Best Options Carousel** | Top 3 cards: 🌟 Best Match, 🚗 Minimal Drive, 🌤️ Early Bird |
| **Timeline List** | Solid cards = existing meetings. Ghost cards = proposed slots (semi-transparent, dashed border) |
| **Ghost Content** | "10:15 - 11:00 • +12m Drive • Fits between Client A & B" |

### Screen B: "Confirm & Enrich" (The Action)

| Element | Behavior |
|--------|----------|
| **Trigger** | Tap Ghost Slot or Best Option card |
| **UI** | Toast / Bottom Sheet over map |
| **Header** | "Confirm Booking: Tuesday @ 10:15" |
| **Fields** | 📍 Address (locked), 👤 Name, 🏢 Company, 📞 Phone, 📝 Notes |
| **[ Book & Save Contact ]** | Creates Calendar Event **and** Outlook Contact |
| **[ Book Meeting Only ]** | Creates Calendar Event only |

---

## 5. Data Model

### UserPreferences
```typescript
interface UserPreferences {
  workingHours: { start: string; end: string };    // "08:00", "17:00"
  postMeetingBuffer: number;                       // Minutes – applied to each travel leg
  lunchWindow: { start: string; end: string; duration: number };  // "11:30"-"13:30", 30m
  homeBase?: { lat: number; lon: number };         // Anchor location (default: Copenhagen)
  avgSpeedKmh?: number;                            // Default 30
  workingDays?: [boolean, boolean, ...];           // [Sun..Sat]; non-working days excluded from slots
}
```

### TimelineItem (scheduler internal)
```typescript
interface TimelineItem {
  id: string;
  startMs: number;
  endMs: number;
  coord: { lat: number; lon: number };
  type: 'start' | 'end' | 'event';
}
```

### ScoredSlot (scheduler output)
```typescript
interface ScoredSlot {
  dayIso: string;
  startMs: number;
  endMs: number;
  score: number;
  metrics: {
    detourMinutes: number;
    slackMinutes: number;
    travelToMinutes: number;
    travelFromMinutes: number;
  };
  label: string;
}
```

---

## 6. Technical Implementation Steps

| Step | Description | Status |
|------|-------------|--------|
| **Step 1: The Foundation** | UserPreferencesContext (AsyncStorage), ProfileScreen UI for Buffer & Lunch | ✅ Done |
| **Step 2: The Logic** | `findSmartSlots` – constraint-based, detour scoring, epoch ms, TimelineItem anchors | ✅ Done |
| **Step 3: The Search** | `searchAddress(query)` – OpenStreetMap Nominatim (no API key) | Pending |
| **Step 4: The UI** | Plan Visit screen, Timeline with Ghost Cards, Confirm → Book creates meeting | ✅ Done |
| **Schedule UX** | Meeting Details (edit), Done/Undone toggle, swipe delete (confirm), arrow → native directions | ✅ Done |
| **Step 5: The Wiring** | Enrichment Sheet, Contacts.ReadWrite on demand | ✅ Done (optional save contact after booking) |
| **Auth persistence** | offline_access + refresh token; session persists across restarts | ✅ Done |
| **Calendar CRUD** | create (ConfirmBooking), update/delete (Meeting Details) → Outlook | ✅ Done |

### Step 2 Logic (Implemented)

**Timeframes (device local time only):**
- **Best Match:** Rolling window now → now+14 days. Ranking: score asc, then startMs asc, then dayIso asc.
- **Pick Week:** Exact Mon 00:00 local → Sun 23:59:59.999 local for selected week. Only that week’s days/meetings/slots.

**Timeline:** `[StartAnchor, ...events, EndAnchor]` per day. Anchors = homeBase @ workingHours.start/end. Events without coords block time; use homeBase for travel (marked hasCoord=false in explain).

**Hard constraints:** arriveBy ≥ workStart; departAt ≤ workEnd; no overlap with any event; no lunch overlap (MVP-simple); no past slots; 15-min snap UP.

**Score formula:** `detour*10`; slack<10: +5000; slack 10–45: 0; slack>90: +(slack-90)*2; empty-day: +150.

**Sorting:** Normal: score asc, startMs asc, dayIso asc. Empty-week: dayIso asc, startMs asc.

**Empty week:** One slot per working day at `workingHours.start + preBuffer` (snapped). Best Options = earliest day first.

**Overlap:** Proposed [meetingStart, meetingEnd] must not overlap any existing event [startMs, endMs]. Events without coords still block.

**Plan Visit gating:** Results only after location (with coords) + duration + timeframe selected + CTA pressed. Any change clears results.

**Explain (DEV):** (i) on ghost card shows prev/next, arriveBy, departAt, travel, constraints, travelFeasible.

**“On your route”** badge: detourMinutes ≤ 5.

---

## 7. Permission Strategy

- **Auth:** offline_access for refresh token (session persistence)
- **Calendar:** Calendars.Read, Calendars.ReadWrite (requested at login)
- **Contacts:** Contacts.ReadWrite (requested at login; used when user saves contact after booking)
- **Fallback:** If write permissions denied, operations save locally with clear error messaging

import { startOfDay, addDays, endOfDay } from 'date-fns';
import { toLocalDayKey } from './dateUtils';
import type { UserPreferences } from '../types';
import { DEFAULT_WORKING_DAYS } from '../types';
import type { CalendarEvent } from '../services/graph';

// ─── Constants ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const DEFAULT_HOME = { lat: 55.6761, lon: 12.5683 };
const MS_PER_MIN = 60_000;
const MAX_SLOTS = 100;
const MAX_CANDIDATES_PER_GAP = 3;
/** Slot start times snap to 15-minute grid (round UP to avoid "leave earlier than possible") */
const SNAP_MINUTES = 15;

// ─── Helper Types ──────────────────────────────────────────────────────────────

export type Coordinate = { lat: number; lon: number };

export type TimelineItem = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  coord: Coordinate;
  type: 'start' | 'end' | 'event';
  /** False when event has no coordinates; we use homeBase as fallback for travel */
  hasCoord?: boolean;
};

export type SlotExplainAnchor = {
  id: string;
  title: string;
  type: 'start' | 'end' | 'event';
  startMs: number;
  endMs: number;
  hasCoord: boolean;
};

export type SlotExplain = {
  dayKey: string;
  prev: SlotExplainAnchor;
  next: SlotExplainAnchor;
  prevDepartMs: number;
  arriveByMs: number;
  meetingStartMs: number;
  meetingEndMs: number;
  departAtMs: number;
  nextArriveByMs: number;
  gapMinutes: number;
  travelToMinutes: number;
  travelFromMinutes: number;
  travelToUsedFallback: boolean;
  travelFromUsedFallback: boolean;
  preBuffer: number;
  postBuffer: number;
  baselineMinutes: number;
  newPathMinutes: number;
  detourMinutes: number;
  /** Straight-line detour km (v2 primary metric) */
  detourKm: number;
  slackMinutes: number;
  score: number;
  tier: SlotTier;
  fitsGap: boolean;
  withinWorkingHours: boolean;
  notPast: boolean;
  workingDayAllowed: boolean;
  noOverlap: boolean;
  travelFeasible: boolean;
  /** True when prev=Start: meeting may start at workStart; buffers waived for arrival */
  bufferWaivedAtStart?: boolean;
  /** True when next=End: meeting may end at workEnd; buffers waived for departure */
  bufferWaivedAtEnd?: boolean;
  /** When prev=Start on today: true if we can leave now and reach arriveBy */
  travelFeasibleFromNow?: boolean;
  /** When prev=Start: true if departFrom + travelTo <= meetingStart */
  reachableFromWorkStart?: boolean;
  /** Arrival margin minutes before meeting start; >= preBuffer means arrive-early preferred */
  arrivalMarginMinutes?: number;
  /** True when arrivalMarginMinutes >= preBuffer */
  arriveEarlyPreferred?: boolean;
  eventsWithMissingCoordsUsed: string[];
};

/**
 * Slot tier (v2):
 * 1 = On Route – same day as other meetings, detourKm ≤ 5
 * 2 = Nearby – same day as other meetings, detourKm > 5 but ≤ distanceThresholdKm
 * 4 = New Day – no meetings that day (empty day, round-trip from home)
 * (Tier 3 = over threshold, excluded entirely from results)
 */
export type SlotTier = 1 | 2 | 4;

export type ScoredSlot = {
  dayIso: string;
  startMs: number;
  endMs: number;
  /** Lower = better. Within tier: detourKm*10 + slackPenalty. Primary sort key is tier. */
  score: number;
  /** Tier 1=On Route, 2=Nearby, 4=New Day */
  tier: SlotTier;
  metrics: {
    /** Extra km added to the day's route by inserting this meeting (primary metric v2) */
    detourKm: number;
    /** Extra driving time in minutes (for display) */
    detourMinutes: number;
    slackMinutes: number;
    travelToMinutes: number;
    travelFromMinutes: number;
  };
  label: string;
  /** DEV: why this slot was suggested (prev/next chain, constraints) */
  explain?: SlotExplain;
};

// ─── Math Helpers ──────────────────────────────────────────────────────────────

function haversineKm(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_RADIUS_KM * c;
}

/** Rush hours (local): 07–09, 15–18 */
function isRushHour(departureMs: number): boolean {
  const d = new Date(departureMs);
  const h = d.getHours();
  return (h >= 7 && h < 9) || (h >= 15 && h < 18);
}

/** Road factor by straight-line distance (km) */
function getRoadFactor(distKm: number): number {
  if (distKm < 5) return 1.45;
  if (distKm <= 20) return 1.3;
  return 1.18;
}

/** Speed (km/h) by distance and time-of-day. No buffers. */
function getSpeedKmh(distKm: number, departureMs: number): number {
  const rush = isRushHour(departureMs);
  if (distKm < 5) return rush ? 22 : 28;
  if (distKm <= 20) return rush ? 35 : 45;
  return rush ? 65 : 75;
}

/**
 * Travel minutes between two points. NO buffers.
 * minutes = ceil((distKm * roadFactor / speedKmh) * 60)
 * Uses departureTimeMs for time-of-day speed heuristics.
 */
export function getTravelMinutes(
  a: Coordinate,
  b: Coordinate,
  departureTimeMs: number
): number {
  const distKm = haversineKm(a, b);
  const roadFactor = getRoadFactor(distKm);
  const speedKmh = getSpeedKmh(distKm, departureTimeMs);
  const rawMinutes = (distKm * roadFactor / speedKmh) * 60;
  return Math.ceil(rawMinutes);
}

// ─── Mock Data (Deterministic) ──────────────────────────────────────────────────

const MOCK_COORDS: Record<string, Coordinate> = {
  'Client A': { lat: 55.678, lon: 12.565 },
  'Client B': { lat: 55.682, lon: 12.578 },
  'Køge': { lat: 55.458, lon: 12.182 },
  'Copenhagen': { lat: 55.6761, lon: 12.5683 },
  'Office': { lat: 55.6761, lon: 12.5683 },
  'Home': { lat: 55.6761, lon: 12.5683 },
  'client a': { lat: 55.678, lon: 12.565 },
  'client b': { lat: 55.682, lon: 12.578 },
  'køge': { lat: 55.458, lon: 12.182 },
  'copenhagen': { lat: 55.6761, lon: 12.5683 },
  'office': { lat: 55.6761, lon: 12.5683 },
  'home': { lat: 55.6761, lon: 12.5683 },
};

export function getMockCoordinates(query: string): Coordinate | null {
  const key = query.trim();
  if (!key) return null;
  const exact = MOCK_COORDS[key];
  if (exact) return exact;
  const lower = MOCK_COORDS[key.toLowerCase()];
  if (lower) return lower;
  return null;
}

// ─── Time Helpers (Epoch ms) ──────────────────────────────────────────────────

function parseTimeToMinutes(s: string): number {
  const parts = s.trim().split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h * 60 + m;
}

/** Set time on a date from "HH:MM", return epoch ms. dayStartMs = midnight of that day. */
function timeOnDayMs(dayStartMs: number, timeStr: string): number {
  const mins = parseTimeToMinutes(timeStr);
  return dayStartMs + mins * MS_PER_MIN;
}

function eventToStartEndMs(ev: CalendarEvent, dayStartMs: number): { startMs: number; endMs: number } | null {
  if (ev.startIso && ev.endIso) {
    try {
      return { startMs: new Date(ev.startIso).getTime(), endMs: new Date(ev.endIso).getTime() };
    } catch {
      return eventTimeToRangeMs(ev, dayStartMs);
    }
  }
  return eventTimeToRangeMs(ev, dayStartMs);
}

function eventTimeToRangeMs(ev: CalendarEvent, dayStartMs: number): { startMs: number; endMs: number } | null {
  if (!ev.time || typeof ev.time !== 'string') return null;
  const parts = ev.time.split('-').map((p) => p.trim());
  if (parts.length < 2) return null;
  const startStr = parts[0];
  const endStr = parts[1];
  if (!startStr || !endStr) return null;
  return {
    startMs: timeOnDayMs(dayStartMs, startStr),
    endMs: timeOnDayMs(dayStartMs, endStr),
  };
}

function toCoord(c: { latitude: number; longitude: number }): Coordinate {
  return { lat: c.latitude, lon: c.longitude };
}

/** Format dayIso to "Mon, Feb 13" style. */
function formatDayLabel(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Format ms to "HH:MM–HH:MM". */
function formatTimeRangeMs(startMs: number, endMs: number): string {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  return `${fmt(startMs)}–${fmt(endMs)}`;
}

/** Round UP to next 15-min boundary. Ensures we never propose "leave earlier than possible". */
function snapStartMsUp(rawMs: number): number {
  const gridMs = SNAP_MINUTES * MS_PER_MIN;
  return Math.ceil(rawMs / gridMs) * gridMs;
}

/** Round DOWN to previous 15-min boundary. Used to find the latest feasible start time. */
function snapStartMsDown(rawMs: number): number {
  const gridMs = SNAP_MINUTES * MS_PER_MIN;
  return Math.floor(rawMs / gridMs) * gridMs;
}

/** True if [aStart, aEnd] overlaps [bStart, bEnd]. */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Parse event to startMs/endMs for window overlap check. fallbackDayStartMs used when only ev.time exists. */
function eventToMsForWindow(
  ev: CalendarEvent,
  fallbackDayStartMs: number
): { startMs: number; endMs: number } | null {
  if (ev.startIso && ev.endIso) {
    try {
      return { startMs: new Date(ev.startIso).getTime(), endMs: new Date(ev.endIso).getTime() };
    } catch {
      return eventTimeToRangeMs(ev, fallbackDayStartMs);
    }
  }
  return eventTimeToRangeMs(ev, fallbackDayStartMs);
}

/** Filter schedule to events that overlap [windowStartMs, windowEndMs]. */
function filterScheduleToWindow(
  events: CalendarEvent[],
  windowStartMs: number,
  windowEndMs: number
): CalendarEvent[] {
  const fallbackDayStart = startOfDay(new Date(windowStartMs)).getTime();
  return events.filter((ev) => {
    const r = eventToMsForWindow(ev, fallbackDayStart);
    if (!r) return true; // conservative: include when unparseable
    return intervalsOverlap(r.startMs, r.endMs, windowStartMs, windowEndMs);
  });
}

// ─── Core Logic ────────────────────────────────────────────────────────────────

export type SearchWindow = { start: Date; end: Date };

/** QA log entry for a slot considered (accepted or rejected). */
export type QASlotConsidered = {
  dayIso: string;
  dayLabel: string;
  timeRange: string;
  status: 'accepted' | 'rejected';
  reason?: string;
  detourKm?: number;
  addToRouteMin?: number;
  baselineMin?: number;
  newPathMin?: number;
  slackMin?: number;
  score?: number;
  label?: string;
  prev?: string;
  next?: string;
  summary?: string;
};

export type FindSmartSlotsOptions = {
  schedule: CalendarEvent[];
  newLocation: Coordinate | { latitude: number; longitude: number };
  durationMinutes: number;
  preferences: UserPreferences;
  searchWindow: SearchWindow;
  /** When true (Best Match): clamp search start to today. When false (Pick Week): use exact window. */
  clampSearchStartToToday?: boolean;
  /** When true, include explain object on each slot (for DEV debugging). */
  includeExplain?: boolean;
  /** QA: called for each slot considered (accepted or rejected). */
  onSlotConsidered?: (entry: QASlotConsidered) => void;
};

/** Include ALL events overlapping the day's working window (even without coords). Cross-midnight events block the overlapping portion. */
function eventsForDay(
  events: CalendarEvent[],
  dayStartMs: number,
  dayWorkStartMs: number,
  dayWorkEndMs: number
): Array<{ ev: CalendarEvent; startMs: number; endMs: number; hasCoord: boolean }> {
  const dayStart = startOfDay(new Date(dayStartMs)).getTime();
  return events
    .map((ev) => {
      const r = eventToStartEndMs(ev, dayStart);
      if (!r) return null;
      // Overlap with day working window (handles cross-midnight: 23:30–09:00 blocks 08:00–09:00)
      if (!intervalsOverlap(r.startMs, r.endMs, dayWorkStartMs, dayWorkEndMs)) return null;
      // Clamp to working window so timeline never sorts before start anchor
      const startMs = Math.max(r.startMs, dayWorkStartMs);
      const endMs = Math.min(r.endMs, dayWorkEndMs);
      if (endMs <= startMs) return null;
      const hasCoord = !!(ev.coordinates && typeof ev.coordinates.latitude === 'number' && typeof ev.coordinates.longitude === 'number');
      return { ev, startMs, endMs, hasCoord };
    })
    .filter((x): x is { ev: CalendarEvent; startMs: number; endMs: number; hasCoord: boolean } => x != null)
    .sort((a, b) => a.startMs - b.startMs);
}

/** Build timeline: [StartAnchor, ...events, EndAnchor]. Events without coords use homeBase (still block time). */
function buildTimeline(
  dayStartMs: number,
  dayEvents: Array<{ ev: CalendarEvent; startMs: number; endMs: number; hasCoord: boolean }>,
  prefs: UserPreferences,
  effectiveStartMs: number,
  effectiveEndMs: number
): TimelineItem[] {
  const homeBase = prefs.homeBase ?? DEFAULT_HOME;

  const startAnchor: TimelineItem = {
    id: '_start',
    title: 'Start',
    startMs: effectiveStartMs,
    endMs: effectiveStartMs,
    coord: homeBase,
    type: 'start',
  };

  const endAnchor: TimelineItem = {
    id: '_end',
    title: 'End',
    startMs: effectiveEndMs,
    endMs: effectiveEndMs,
    coord: homeBase,
    type: 'end',
  };

  const eventItems: TimelineItem[] = dayEvents.map(({ ev, startMs, endMs, hasCoord }) => ({
    id: ev.id,
    title: ev.title ?? '(No title)',
    startMs,
    endMs,
    coord: hasCoord ? toCoord(ev.coordinates!) : homeBase,
    type: 'event' as const,
    hasCoord,
  }));

  const timeline = [startAnchor, ...eventItems, endAnchor].sort((a, b) => a.startMs - b.startMs);
  return timeline;
}

/**
 * Constraint-based scheduling with pre/post buffers and incremental detour scoring.
 * All internal time calculations use epoch milliseconds.
 * - workingDays filter: excludes non-working days
 * - no past slots: slots starting before now (or before arrive-by for today) are filtered out
 * - 15-min snapping: slot start rounded UP to next 15-min; discarded if constraints violated
 */
export function findSmartSlots(options: FindSmartSlotsOptions): ScoredSlot[] {
  const { schedule, newLocation, durationMinutes, preferences: prefs, searchWindow, clampSearchStartToToday = true, includeExplain = typeof __DEV__ !== 'undefined' && __DEV__, onSlotConsidered } = options;
  const preBuffer = prefs.preMeetingBuffer ?? 15;
  const postBuffer = prefs.postMeetingBuffer ?? 15;
  const workingDays = prefs.workingDays ?? DEFAULT_WORKING_DAYS;
  /** v2: Detour km threshold. Same-day slots with detourKm > threshold are excluded; empty days suggested instead. */
  const distanceThresholdKm = prefs.distanceThresholdKm ?? 30;
  /**
   * When true (default): first meeting accounts for travel FROM home, last meeting accounts
   * for travel back TO home. When false (field/overnight mode): no home travel counted —
   * first meeting can start at work start, last can end at work end.
   */
  const startFromHomeBase = prefs.alwaysStartFromHomeBase !== false;

  const newLoc: Coordinate =
    'lat' in newLocation
      ? newLocation
      : { lat: newLocation.latitude, lon: newLocation.longitude };

  // __DEV__: set globalThis.__simulateNowMs for midnight testing (e.g. = Date.UTC(2025,1,11,22,58) to simulate 23:58 local)
  const g = globalThis as unknown as { __simulateNowMs?: number };
  const nowMs = typeof __DEV__ !== 'undefined' && __DEV__ && typeof g.__simulateNowMs === 'number' ? g.__simulateNowMs : Date.now();
  const todayStartMs = startOfDay(new Date(nowMs)).getTime();
  // MIN_ALLOWED_START_MS: no past slots; must be able to arrive by slot start (pre-buffer)
  const minStartMs = nowMs + preBuffer * MS_PER_MIN;

  const slots: ScoredSlot[] = [];
  const windowStartMs = searchWindow.start.getTime();
  const windowEndMs = searchWindow.end.getTime();
  // Best Match: clamp to today. Pick Week: use exact window.
  const searchStartMs = clampSearchStartToToday
    ? Math.max(windowStartMs, todayStartMs)
    : windowStartMs;
  const searchEndMs = windowEndMs;
  let currentMs = searchStartMs;

  // STEP 1: Filter to events overlapping the selected window (timeframe isolation)
  const scheduleInWindow = filterScheduleToWindow(schedule, windowStartMs, windowEndMs);
  const hasRealMeetingsInWindow = scheduleInWindow.length > 0;

  while (currentMs <= searchEndMs) {
    const dayStart = startOfDay(new Date(currentMs)).getTime();
    const dayOfWeek = new Date(dayStart).getDay(); // 0=Sun, 1=Mon, ... 6=Sat (matches workingDays index)
    if (!workingDays[dayOfWeek]) {
      currentMs = addDays(new Date(currentMs), 1).getTime();
      continue;
    }

    const dayStartTimeMs = timeOnDayMs(dayStart, prefs.workingHours.start);
    const dayEndTimeMs = timeOnDayMs(dayStart, prefs.workingHours.end);

    const windowStartDayMs = startOfDay(new Date(windowStartMs)).getTime();
    const windowEndDayMs = startOfDay(new Date(windowEndMs)).getTime();
    let effectiveStartMs = dayStartTimeMs;
    let effectiveEndMs = dayEndTimeMs;
    if (dayStart === windowStartDayMs) effectiveStartMs = Math.max(effectiveStartMs, windowStartMs);
    if (dayStart === windowEndDayMs) effectiveEndMs = Math.min(effectiveEndMs, windowEndMs);
    if (effectiveEndMs <= effectiveStartMs) {
      currentMs = addDays(new Date(currentMs), 1).getTime();
      continue;
    }

    // Skip today entirely if current time is after working hours end
    const isToday = dayStart === todayStartMs;
    if (isToday && minStartMs > effectiveEndMs) {
      currentMs = addDays(new Date(currentMs), 1).getTime();
      continue;
    }

    const dayEvents = eventsForDay(scheduleInWindow, dayStart, effectiveStartMs, effectiveEndMs);
    const timeline = buildTimeline(dayStart, dayEvents, prefs, effectiveStartMs, effectiveEndMs);

    // Empty-week path: no meetings anywhere in the search window.
    // Instead of one "earliest only" slot, offer up to three anchors:
    //   Morning  – as early as you can leave home and arrive
    //   Midday   – roughly the middle of the working day
    //   Afternoon – as late as possible while still driving home before end of day
    if (dayEvents.length === 0 && !hasRealMeetingsInWindow) {
      const home = { lat: prefs.homeBase?.lat ?? DEFAULT_HOME.lat, lon: prefs.homeBase?.lon ?? DEFAULT_HOME.lon };

      // ── Morning anchor: earliest feasible ──────────────────────────────────
      // Field mode: no home travel needed, first meeting can start at work start.
      // Home mode: must account for travel from home to client.
      const travelFromHomeMs = startFromHomeBase
        ? getTravelMinutes(home, newLoc, effectiveStartMs) * MS_PER_MIN
        : 0;
      const minFromWorkStart = effectiveStartMs + travelFromHomeMs;
      const morningStart = isToday
        ? snapStartMsUp(Math.max(effectiveStartMs, minFromWorkStart, nowMs + getTravelMinutes(home, newLoc, nowMs) * MS_PER_MIN))
        : snapStartMsUp(Math.max(effectiveStartMs, minFromWorkStart));

      // ── Afternoon anchor: latest start that still gets you home before day ends ──
      // Field mode: no return drive, so last meeting can end exactly at work end time.
      // Home mode: must leave enough time to drive home before work end.
      const travelHomeFromAfternoon = startFromHomeBase
        ? getTravelMinutes(newLoc, home, effectiveEndMs - durationMinutes * MS_PER_MIN - postBuffer * MS_PER_MIN) * MS_PER_MIN
        : 0;
      const afternoonStart = snapStartMsDown(
        effectiveEndMs - durationMinutes * MS_PER_MIN - postBuffer * MS_PER_MIN - travelHomeFromAfternoon
      );

      // ── Midday anchor: halfway between morning and afternoon ───────────────
      const midDayStart = snapStartMsUp((morningStart + afternoonStart) / 2);

      // Collect anchors that are at least 30 min apart (avoids duplicates on short days)
      const MIN_ANCHOR_GAP_MS = 30 * MS_PER_MIN;
      const rawAnchors: { startMs: number; label: string }[] = [
        { startMs: morningStart,  label: 'Morning visit' },
        { startMs: midDayStart,   label: 'Midday visit' },
        { startMs: afternoonStart, label: 'Afternoon visit' },
      ];
      const anchors: { startMs: number; label: string }[] = [];
      for (const anchor of rawAnchors) {
        if (anchors.every((a) => Math.abs(a.startMs - anchor.startMs) >= MIN_ANCHOR_GAP_MS)) {
          anchors.push(anchor);
        }
      }

      const dayIsoEmpty = toLocalDayKey(dayStart);
      const detourKmEmpty = 2 * haversineKm(home, newLoc);

      for (const { startMs: meetingStartMs, label: emptyDayLabel } of anchors) {
        if (slots.length >= MAX_SLOTS) break;
        const slotEndMs = meetingStartMs + durationMinutes * MS_PER_MIN;
        if (
          meetingStartMs >= minStartMs &&
          meetingStartMs >= windowStartMs &&
          slotEndMs <= effectiveEndMs &&
          slotEndMs <= windowEndMs
        ) {
          const travelToMinutes = getTravelMinutes(home, newLoc, effectiveStartMs);
          const departAtMs = slotEndMs + postBuffer * MS_PER_MIN;
          const travelFromMinutes = getTravelMinutes(newLoc, home, departAtMs);
          const detourMinutes = travelToMinutes + travelFromMinutes;
          const slackMinutes = 0;
          const score = detourKmEmpty * 10;
          const slot: ScoredSlot = {
            dayIso: dayIsoEmpty,
            startMs: meetingStartMs,
            endMs: slotEndMs,
            score,
            tier: 4,
            metrics: { detourKm: detourKmEmpty, detourMinutes, slackMinutes, travelToMinutes, travelFromMinutes },
            label: emptyDayLabel,
          };
          if (includeExplain) {
            const arrBy = meetingStartMs - preBuffer * MS_PER_MIN;
            slot.explain = {
              dayKey: dayIsoEmpty,
              prev: { id: '_start', title: 'Start', type: 'start', startMs: effectiveStartMs, endMs: effectiveStartMs, hasCoord: true },
              next: { id: '_end', title: 'End', type: 'end', startMs: effectiveEndMs, endMs: effectiveEndMs, hasCoord: true },
              prevDepartMs: effectiveStartMs,
              arriveByMs: arrBy,
              meetingStartMs,
              meetingEndMs: slotEndMs,
              departAtMs,
              nextArriveByMs: effectiveEndMs,
              gapMinutes: (effectiveEndMs - effectiveStartMs) / MS_PER_MIN,
              travelToMinutes,
              travelFromMinutes,
              travelToUsedFallback: false,
              travelFromUsedFallback: false,
              preBuffer,
              postBuffer,
              baselineMinutes: 0,
              newPathMinutes: travelToMinutes + travelFromMinutes,
              detourMinutes,
              detourKm: detourKmEmpty,
              slackMinutes,
              score,
              tier: 4,
              fitsGap: true,
              withinWorkingHours: true,
              notPast: true,
              workingDayAllowed: true,
              noOverlap: true,
              travelFeasible: true,
              bufferWaivedAtStart: true,
              bufferWaivedAtEnd: true,
              travelFeasibleFromNow: isToday
                ? nowMs + getTravelMinutes(home, newLoc, nowMs) * MS_PER_MIN <= meetingStartMs
                : undefined,
              reachableFromWorkStart: true,
              arrivalMarginMinutes: (meetingStartMs - (effectiveStartMs + travelToMinutes * MS_PER_MIN)) / MS_PER_MIN,
              arriveEarlyPreferred:
                (meetingStartMs - (effectiveStartMs + travelToMinutes * MS_PER_MIN)) / MS_PER_MIN >= preBuffer,
              eventsWithMissingCoordsUsed: [],
            };
          }
          slots.push(slot);
          if (onSlotConsidered) {
            onSlotConsidered({
              dayIso: dayIsoEmpty,
              dayLabel: formatDayLabel(dayIsoEmpty),
              timeRange: formatTimeRangeMs(meetingStartMs, slotEndMs),
              status: 'accepted',
              detourKm: Math.round(detourKmEmpty * 10) / 10,
              addToRouteMin: detourMinutes,
              baselineMin: 0,
              newPathMin: travelToMinutes + travelFromMinutes,
              slackMin: 0,
              score,
              label: emptyDayLabel,
              prev: 'Start',
              next: 'End',
              summary: `Empty day (${emptyDayLabel}). +${detourMinutes} min drive (${detourKmEmpty.toFixed(1)} km round trip). Score ${score}.`,
            });
          }
        }
      }

      currentMs = addDays(new Date(currentMs), 1).getTime();
      continue;
    }

    for (let i = 0; i < timeline.length - 1 && slots.length < MAX_SLOTS; i++) {
      const prev = timeline[i]!;
      const next = timeline[i + 1]!;

      const prevDepartMs =
        prev.type === 'event'
          ? prev.endMs + postBuffer * MS_PER_MIN
          : prev.endMs;

      const nextArriveByMs =
        next.type === 'event'
          ? next.startMs - preBuffer * MS_PER_MIN
          : next.startMs;

      const gapMs = nextArriveByMs - prevDepartMs;
      const gapMinutes = gapMs / MS_PER_MIN;

      if (gapMs <= 0) continue;

      const travelToMinutes = getTravelMinutes(prev.coord, newLoc, prevDepartMs);
      const bufferWaivedAtStart = prev.type === 'start';
      const bufferWaivedAtEnd = next.type === 'end';

      // In field mode (alwaysStartFromHomeBase=false), no home travel is needed for the
      // first gap — the worker is already in the field, so the first meeting can start at
      // exactly work start time. For all other gaps (prev=event), travel from prev event
      // to the new meeting is still required regardless of mode.
      const effectiveTravelToStart = !startFromHomeBase && bufferWaivedAtStart ? 0 : travelToMinutes;

      const minStartFromWorkStartMs = prevDepartMs + effectiveTravelToStart * MS_PER_MIN;
      const rawMeetingStartMs = bufferWaivedAtStart
        ? minStartFromWorkStartMs
        : prevDepartMs + (travelToMinutes + preBuffer) * MS_PER_MIN;
      let candidateStart0: number;
      let travelToNowMinutes = 0;
      if (bufferWaivedAtStart && isToday) {
        const home = { lat: prefs.homeBase?.lat ?? DEFAULT_HOME.lat, lon: prefs.homeBase?.lon ?? DEFAULT_HOME.lon };
        travelToNowMinutes = getTravelMinutes(home, newLoc, nowMs);
        const minStartFromNowWithTravelMs = nowMs + travelToNowMinutes * MS_PER_MIN;
        candidateStart0 = snapStartMsUp(Math.max(rawMeetingStartMs, minStartFromNowWithTravelMs));
      } else {
        candidateStart0 = snapStartMsUp(rawMeetingStartMs);
      }
      const requiredMinutesSansTravelFrom = bufferWaivedAtStart && bufferWaivedAtEnd
        ? durationMinutes
        : bufferWaivedAtStart
          ? durationMinutes + postBuffer
          : bufferWaivedAtEnd
            ? travelToMinutes + preBuffer + durationMinutes
            : travelToMinutes + preBuffer + durationMinutes + postBuffer;

      // Build candidate start times: earliest 3 positions PLUS the midpoint of the gap.
      // The midpoint gives a balanced placement — breathing room on both sides — which is
      // often more comfortable than always packing the new meeting against the previous one.
      const approxTravelFrom = bufferWaivedAtEnd
        ? 0
        : getTravelMinutes(newLoc, next.coord, nextArriveByMs);
      const latestFeasibleStart = bufferWaivedAtEnd
        ? snapStartMsDown(effectiveEndMs - durationMinutes * MS_PER_MIN)
        : snapStartMsDown(
            nextArriveByMs -
              approxTravelFrom * MS_PER_MIN -
              postBuffer * MS_PER_MIN -
              durationMinutes * MS_PER_MIN
          );
      const midCandidateStart = snapStartMsUp((candidateStart0 + latestFeasibleStart) / 2);

      const rawCandidates = [
        candidateStart0,
        candidateStart0 + SNAP_MINUTES * MS_PER_MIN,
        candidateStart0 + 2 * SNAP_MINUTES * MS_PER_MIN,
        midCandidateStart,
      ];
      const candidateStarts = [
        ...new Set(
          rawCandidates.filter(
            (t) => t >= candidateStart0 && t <= latestFeasibleStart + durationMinutes * MS_PER_MIN
          )
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, MAX_CANDIDATES_PER_GAP + 1);

      for (const meetingStartMs of candidateStarts) {
        if (slots.length >= MAX_SLOTS) break;
        const slotEndMs = meetingStartMs + durationMinutes * MS_PER_MIN;
        const departAtMs = slotEndMs + postBuffer * MS_PER_MIN;
        const travelFromMinutes = getTravelMinutes(newLoc, next.coord, departAtMs);
        const requiredMinutes = requiredMinutesSansTravelFrom + (bufferWaivedAtEnd ? 0 : travelFromMinutes);

        const dayIsoGap = toLocalDayKey(dayStart);
        const dayLabelGap = formatDayLabel(dayIsoGap);
        const timeRangeGap = formatTimeRangeMs(meetingStartMs, slotEndMs);
        const qaReject = (reason: string) => {
          if (onSlotConsidered) onSlotConsidered({ dayIso: dayIsoGap, dayLabel: dayLabelGap, timeRange: timeRangeGap, status: 'rejected', reason });
        };
        if (gapMinutes < requiredMinutes) { qaReject(`Gap too small (need ${Math.ceil(requiredMinutes)} min)`); continue; }
        if (slotEndMs > effectiveEndMs) break;
        if (slotEndMs > windowEndMs) break;
        if (meetingStartMs < effectiveStartMs) { qaReject('Before work start'); continue; }
        if (meetingStartMs < windowStartMs) { qaReject('Before window'); continue; }
        if (!bufferWaivedAtEnd && departAtMs + travelFromMinutes * MS_PER_MIN > nextArriveByMs) { qaReject("Can't reach next meeting in time"); continue; }
        if (meetingStartMs < minStartMs) { qaReject('In the past'); continue; }
        if (bufferWaivedAtStart && prevDepartMs + effectiveTravelToStart * MS_PER_MIN > meetingStartMs) { qaReject('Arrive late'); continue; }
        if (bufferWaivedAtStart && isToday && nowMs + travelToNowMinutes * MS_PER_MIN > meetingStartMs) { qaReject("Can't leave now in time"); continue; }

        const noOverlap = !dayEvents.some((e) => intervalsOverlap(meetingStartMs, slotEndMs, e.startMs, e.endMs));
        if (!noOverlap) { qaReject('Overlaps existing meeting'); continue; }

        const baselineKm = haversineKm(prev.coord, next.coord);
        const newPathKm = haversineKm(prev.coord, newLoc) + haversineKm(newLoc, next.coord);
        const detourKmVal = newPathKm - baselineKm;
        const isEmptyDay = dayEvents.length === 0;

        if (!isEmptyDay && detourKmVal > distanceThresholdKm) {
          qaReject(`Detour ${detourKmVal.toFixed(1)} km exceeds threshold ${distanceThresholdKm} km`);
          continue;
        }

        const tier: SlotTier = isEmptyDay ? 4 : (detourKmVal <= 5 ? 1 : 2);

        const slackMinutes = bufferWaivedAtEnd ? 0 : (nextArriveByMs - (departAtMs + travelFromMinutes * MS_PER_MIN)) / MS_PER_MIN;
        const baselineMinutes = getTravelMinutes(prev.coord, next.coord, prevDepartMs);
        const newPathMinutes = travelToMinutes + travelFromMinutes;
        const detourMinutes = newPathMinutes - baselineMinutes;
        const detourKm = Math.round(detourKmVal * 10) / 10;
        let score = detourKm * 10;

        // Smooth slack penalty — replaces the old hard cliff at 10 min.
        // < 2 min: still a hard veto (truly impossible, no margin at all)
        // 2–20 min: smooth curve 200/slack (~100 at 2min → ~10 at 20min)
        // > 60 min: gentle penalty for long waits between meetings
        if (!bufferWaivedAtEnd) {
          if (slackMinutes < 2) {
            score += 5000;
          } else if (slackMinutes < 20) {
            score += 200 / slackMinutes;
          } else if (slackMinutes > 60) {
            score += (slackMinutes - 60) * 1.5;
          }
        }

        // Busy day penalty: lightly prefer adding to a day that already has fewer meetings.
        // Days with 1–3 meetings: no penalty. Each extra meeting beyond 3 adds 15 points.
        score += Math.max(0, dayEvents.length - 3) * 15;

        const arriveByMs = meetingStartMs - preBuffer * MS_PER_MIN;
        const travelFeasibleFromNow = bufferWaivedAtStart && isToday
          ? nowMs + travelToNowMinutes * MS_PER_MIN <= meetingStartMs
          : undefined;
        const reachableFromWorkStart = bufferWaivedAtStart
          ? prevDepartMs + effectiveTravelToStart * MS_PER_MIN <= meetingStartMs
          : undefined;
        const arrivalMarginMinutes = bufferWaivedAtStart
          ? (meetingStartMs - (prevDepartMs + effectiveTravelToStart * MS_PER_MIN)) / MS_PER_MIN
          : undefined;
        const arriveEarlyPreferred = arrivalMarginMinutes != null && arrivalMarginMinutes >= preBuffer;
        const label = isEmptyDay
          ? 'Only meeting of the day'
          : next.type === 'end'
            ? `After ${prev.title}`
            : `Between ${prev.title} and ${next.title}`;
        const dayIso = toLocalDayKey(dayStart);
        const dayLabelSlot = formatDayLabel(dayIso);
        const travelToUsedFallback = prev.type === 'event' && prev.hasCoord === false;
        const travelFromUsedFallback = next.type === 'event' && next.hasCoord === false;
        const eventsWithMissingCoordsUsed = dayEvents.filter((e) => !e.hasCoord).map((e) => e.ev.title ?? '(No title)');
        const travelFeasible = bufferWaivedAtStart && bufferWaivedAtEnd
          ? true
          : bufferWaivedAtStart
            ? departAtMs + travelFromMinutes * MS_PER_MIN <= nextArriveByMs
            : bufferWaivedAtEnd
              ? prevDepartMs + travelToMinutes * MS_PER_MIN <= arriveByMs
              : prevDepartMs + travelToMinutes * MS_PER_MIN <= arriveByMs &&
                departAtMs + travelFromMinutes * MS_PER_MIN <= nextArriveByMs;

        const slot: ScoredSlot = {
          dayIso,
          startMs: meetingStartMs,
          endMs: slotEndMs,
          score,
          tier,
          metrics: { detourKm, detourMinutes, slackMinutes, travelToMinutes, travelFromMinutes },
          label,
        };
        if (includeExplain) {
          slot.explain = {
            dayKey: dayIso,
            prev: { id: prev.id, title: prev.title, type: prev.type, startMs: prev.startMs, endMs: prev.endMs, hasCoord: prev.hasCoord !== false },
            next: { id: next.id, title: next.title, type: next.type, startMs: next.startMs, endMs: next.endMs, hasCoord: next.hasCoord !== false },
            prevDepartMs,
            arriveByMs,
            meetingStartMs,
            meetingEndMs: slotEndMs,
            departAtMs,
            nextArriveByMs,
            gapMinutes,
            travelToMinutes,
            travelFromMinutes,
            travelToUsedFallback,
            travelFromUsedFallback,
            preBuffer,
            postBuffer,
            baselineMinutes,
            newPathMinutes,
            detourMinutes,
            detourKm,
            slackMinutes,
            score,
            tier,
            fitsGap: gapMinutes >= requiredMinutes,
            withinWorkingHours: meetingStartMs >= effectiveStartMs && slotEndMs <= effectiveEndMs,
            notPast: meetingStartMs >= minStartMs,
            workingDayAllowed: true,
            noOverlap,
            travelFeasible,
            bufferWaivedAtStart: bufferWaivedAtStart || undefined,
            bufferWaivedAtEnd: bufferWaivedAtEnd || undefined,
            travelFeasibleFromNow,
            reachableFromWorkStart,
            arrivalMarginMinutes,
            arriveEarlyPreferred,
            eventsWithMissingCoordsUsed,
          };
        }
        slots.push(slot);
        if (onSlotConsidered) {
          const detourStr = detourMinutes >= 0 ? `+${detourMinutes} min` : `Saves ${Math.abs(detourMinutes)} min`;
          const kmStr = detourKm >= 0 ? `+${detourKm.toFixed(1)} km` : `Saves ${(-detourKm).toFixed(1)} km`;
          const tierLabel = tier === 1 ? ' On Route.' : tier === 2 ? ' Nearby.' : ' New Day.';
          onSlotConsidered({
            dayIso,
            dayLabel: dayLabelSlot,
            timeRange: formatTimeRangeMs(meetingStartMs, slotEndMs),
            status: 'accepted',
            detourKm: Math.abs(detourKm),
            addToRouteMin: detourMinutes,
            baselineMin: baselineMinutes,
            newPathMin: newPathMinutes,
            slackMin: slackMinutes,
            score,
            label,
            prev: prev.title,
            next: next.title,
            summary: `Tier ${tier}${tierLabel} ${detourStr} (${kmStr}), ${slackMinutes} min slack. Score ${score.toFixed(1)}.`,
          });
        }
      }
    }

    currentMs = addDays(new Date(currentMs), 1).getTime();
  }

  // ── Cross-day adjacency bonus ─────────────────────────────────────────────
  // Only active in field/overnight mode (alwaysStartFromHomeBase = false).
  // In that mode, ending a day near where tomorrow's first meeting is genuinely saves
  // a morning drive. In home-base mode you drive home every night, so this doesn't apply.
  if (!startFromHomeBase) { for (const slot of slots) {
    // Find next working day after this slot's day
    const slotDate = new Date(slot.dayIso + 'T12:00:00'); // noon avoids DST edge cases
    let nextDay = addDays(slotDate, 1);
    for (let guard = 0; guard < 7 && !workingDays[nextDay.getDay()]; guard++) {
      nextDay = addDays(nextDay, 1);
    }
    const nextDayKey = toLocalDayKey(nextDay);
    // Find first geocoded event on that next working day
    const nextDayFirst = scheduleInWindow
      .filter(
        (ev) =>
          ev.startIso &&
          ev.coordinates != null &&
          typeof ev.coordinates.latitude === 'number' &&
          toLocalDayKey(new Date(ev.startIso)) === nextDayKey
      )
      .sort((a, b) => new Date(a.startIso!).getTime() - new Date(b.startIso!).getTime())[0];
    if (nextDayFirst?.coordinates) {
      const distKm = haversineKm(newLoc, {
        lat: nextDayFirst.coordinates.latitude,
        lon: nextDayFirst.coordinates.longitude,
      });
      // Within 15 km = "in the same area as tomorrow's first stop" → small bonus
      if (distKm <= 15) {
        slot.score = Math.max(0, slot.score - 20);
      }
    }
  } } // end cross-day bonus loop + if (!startFromHomeBase)

  slots.sort((a, b) => {
    if (!hasRealMeetingsInWindow) {
      const dayCmp = a.dayIso.localeCompare(b.dayIso);
      if (dayCmp !== 0) return dayCmp;
      return a.startMs - b.startMs;
    }
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.score !== b.score) return a.score - b.score;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.dayIso.localeCompare(b.dayIso);
  });

  const hasSameDaySlots = slots.some((s) => s.tier === 1 || s.tier === 2);
  const adminFiltered = hasSameDaySlots ? slots.filter((s) => s.tier !== 4) : slots;

  const feasible = adminFiltered.filter((s) => {
    if (s.explain) {
      if (s.explain.travelFeasible === false || s.explain.noOverlap === false) return false;
      if (s.explain.bufferWaivedAtStart && s.explain.reachableFromWorkStart === false) return false;
      if (s.explain.bufferWaivedAtStart && s.explain.travelFeasibleFromNow === false) return false;
    }
    return true;
  });

  return feasible.slice(0, MAX_SLOTS);
}

/** Unique id for a slot (for selection, keys) */
export function slotId(slot: ScoredSlot): string {
  return `${slot.dayIso}-${slot.startMs}`;
}

const DEFAULT_PREFS: UserPreferences = {
  workingHours: { start: '08:00', end: '17:00' },
  postMeetingBuffer: 15,
  preMeetingBuffer: 15,
  workingDays: [false, true, true, true, true, true, false],
};

/**
 * DEV sanity checks. Call from console: require('./utils/scheduler').runOverlapSanityCheck()
 */
export function runOverlapSanityCheck(): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = startOfDay(tomorrow).getTime();
  const evStart = dayStart + 8 * 60 * 60_000;
  const evEnd = dayStart + 9 * 60 * 60_000;
  const schedule: CalendarEvent[] = [{
    id: 'test-no-coords',
    title: 'Blocking meeting (no coords)',
    time: '08:00 - 09:00',
    location: 'Copenhagen',
    status: 'pending',
    startIso: new Date(evStart).toISOString(),
    endIso: new Date(evEnd).toISOString(),
  }];
  const result = findSmartSlots({
    schedule,
    newLocation: { lat: 55.458, lon: 12.182 },
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
  });
  const overlap = result.some((s) => intervalsOverlap(s.startMs, s.endMs, evStart, evEnd));
  if (overlap) {
    console.error('Overlap sanity check FAILED: slot overlaps existing meeting');
    return false;
  }

  // 1) Cross-midnight blocker: event 23:30 prev day → 09:00 today must block 08:00–09:00
  const yesterday = addDays(tomorrow, -1);
  const crossMidnightStart = startOfDay(yesterday).getTime() + 23.5 * 60 * 60_000;
  const crossMidnightEnd = dayStart + 9 * 60 * 60_000;
  const scheduleCross = [{
    id: 'cross-midnight',
    title: 'Overnight',
    status: 'pending' as const,
    startIso: new Date(crossMidnightStart).toISOString(),
    endIso: new Date(crossMidnightEnd).toISOString(),
  }] as CalendarEvent[];
  const resultCross = findSmartSlots({
    schedule: scheduleCross,
    newLocation: { lat: 55.458, lon: 12.182 },
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
  });
  const blocked08to09 = dayStart + 8 * 60 * 60_000;
  const blockedEnd = blocked08to09 + 60 * 60_000;
  const crossOverlap = resultCross.some((s) => intervalsOverlap(s.startMs, s.endMs, blocked08to09, blockedEnd));
  if (crossOverlap) {
    console.error('Cross-midnight sanity FAILED: 23:30–09:00 event did not block 08:00–09:00');
    return false;
  }

  // 2) Empty-day scoring: score should vary with distance, not be fixed 150
  const farLoc = { lat: 55.458, lon: 12.182 };
  const closeLoc = { lat: 55.67, lon: 12.57 };
  const emptySchedule: CalendarEvent[] = [];
  const resultFar = findSmartSlots({
    schedule: emptySchedule,
    newLocation: farLoc,
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
  });
  const resultClose = findSmartSlots({
    schedule: emptySchedule,
    newLocation: closeLoc,
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
  });
  const scoreFar = resultFar[0]?.score ?? 0;
  const scoreClose = resultClose[0]?.score ?? 0;
  if (scoreFar <= 150 && scoreClose <= 150 && Math.abs(scoreFar - scoreClose) < 1) {
    console.error('Empty-day scoring FAILED: scores should differ by detour, not fixed 150');
    return false;
  }

  // 3) Slack penalty: slack < 10 should add +5000
  const ev1Start = dayStart + 9 * 60 * 60_000;
  const ev1End = dayStart + 10 * 60 * 60_000;
  const ev2Start = dayStart + 11 * 60 * 60_000; // 1h gap; with 60m meeting + buffers, slack ~5
  const ev2End = dayStart + 12 * 60 * 60_000;
  const tightSchedule: CalendarEvent[] = [
    { id: 'e1', title: 'E1', status: 'pending', startIso: new Date(ev1Start).toISOString(), endIso: new Date(ev1End).toISOString() },
    { id: 'e2', title: 'E2', status: 'pending', startIso: new Date(ev2Start).toISOString(), endIso: new Date(ev2End).toISOString() },
  ] as CalendarEvent[];
  const resultTight = findSmartSlots({
    schedule: tightSchedule,
    newLocation: { lat: 55.67, lon: 12.57 },
    durationMinutes: 30,
    preferences: { ...DEFAULT_PREFS, preMeetingBuffer: 5, postMeetingBuffer: 5 },
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
    includeExplain: true,
  });
  const tightSlot = resultTight.find((s) => s.startMs >= ev1End && s.endMs <= ev2Start);
  if (tightSlot && tightSlot.explain && tightSlot.explain.slackMinutes < 10 && tightSlot.score < 5000) {
    console.error('Slack penalty sanity FAILED: slack<10 should add +5000');
    return false;
  }

  // 4) Empty day today at 09:30: should still return a valid slot later today (non-empty-week path)
  const today = startOfDay(new Date());
  const simulate09_30 = today.getTime() + 9.5 * 60 * 60_000;
  const g = globalThis as unknown as { __simulateNowMs?: number };
  const origSim = g.__simulateNowMs;
  g.__simulateNowMs = simulate09_30;
  try {
    const tmrStart = addDays(today, 1).getTime() + 10 * 60 * 60_000;
    const tmrEnd = addDays(today, 1).getTime() + 11 * 60 * 60_000;
    const meetingTomorrow: CalendarEvent[] = [{
      id: 'tmr',
      title: 'Tomorrow',
      time: '10:00 - 11:00',
      location: '',
      status: 'pending',
      startIso: new Date(tmrStart).toISOString(),
      endIso: new Date(tmrEnd).toISOString(),
    }];
    const resultToday = findSmartSlots({
      schedule: meetingTomorrow,
      newLocation: { lat: 55.67, lon: 12.57 },
      durationMinutes: 30,
      preferences: DEFAULT_PREFS,
      searchWindow: { start: today, end: endOfDay(addDays(today, 1)) },
      clampSearchStartToToday: true,
    });
    const todaySlots = resultToday.filter((s) => s.dayIso === toLocalDayKey(today));
    if (todaySlots.length === 0) {
      console.error('Empty-day-today sanity FAILED: at 09:30 with meeting tomorrow, should get slot today');
      return false;
    }
  } finally {
    g.__simulateNowMs = origSim;
  }

  return true;
}

/**
 * QA: Køge 09:00-10:00 → new meeting at Høje-Taastrup (far). Must NOT propose 10:00.
 * Travel Køge→Høje-Taastrup ~35-40 min. Earliest slot after = 10:00 + 15 postBuffer + 35 travel = 10:50.
 */
export function runTravelFeasibilityQA(): { pass: boolean; message: string } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = startOfDay(tomorrow).getTime();

  const kogeMeeting: CalendarEvent = {
    id: 'koge',
    title: 'Meeting at Køge',
    time: '09:00 - 10:00',
    location: 'Køge',
    status: 'pending',
    startIso: new Date(dayStart + 9 * 60 * 60_000).toISOString(),
    endIso: new Date(dayStart + 10 * 60 * 60_000).toISOString(),
    coordinates: { latitude: 55.458, longitude: 12.182 },
  };

  const hojeTaastrup = { lat: 55.6517, lon: 12.2722 };
  const travelMin = getTravelMinutes({ lat: 55.458, lon: 12.182 }, hojeTaastrup, dayStart + 10 * 60 * 60_000);
  const minGapAfter = 15 + travelMin;
  const earliestStartAfter = dayStart + 10 * 60 * 60_000 + minGapAfter * 60_000;

  const result = findSmartSlots({
    schedule: [kogeMeeting],
    newLocation: hojeTaastrup,
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: endOfDay(tomorrow) },
    clampSearchStartToToday: false,
    includeExplain: true,
  });

  const impossibleSlots = result.filter((s) => s.startMs < earliestStartAfter);
  if (impossibleSlots.length > 0) {
    return {
      pass: false,
      message: `FAIL: Proposed impossible slot(s) at ${impossibleSlots.map((x) => new Date(x.startMs).toTimeString().slice(0, 5)).join(', ')}. Need ${minGapAfter} min after 10:00, earliest start ${new Date(earliestStartAfter).toTimeString().slice(0, 5)}.`,
    };
  }

  if (result.length === 0) {
    return { pass: false, message: 'FAIL: No slots proposed (expected at least one after 10:00 + travel + buffer).' };
  }

  const best = result[0]!;
  const overlap = intervalsOverlap(best.startMs, best.endMs, dayStart + 9 * 60 * 60_000, dayStart + 10 * 60 * 60_000);
  if (overlap) {
    return { pass: false, message: 'FAIL: Best slot overlaps Køge meeting 09:00-10:00.' };
  }

  return { pass: true, message: `PASS: ${result.length} slot(s), best at ${new Date(best.startMs).toTimeString().slice(0, 5)}, travel ${travelMin}m, detour ${best.metrics.detourMinutes}m` };
}

/**
 * Fake schedule for QA: Køge 09:00–10:00, Copenhagen 14:00–15:00 (tomorrow + D+1).
 * Used by runFakeMeetingsQA and dev "Load QA scenario".
 */
export function getFakeQASchedule(): CalendarEvent[] {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = startOfDay(tomorrow).getTime();
  const nextDay = addDays(tomorrow, 1).getTime();

  return [
    {
      id: 'qa-koge',
      title: 'Meeting at Køge',
      time: '09:00 - 10:00',
      location: 'Køge',
      status: 'pending',
      startIso: new Date(dayStart + 9 * 60 * 60_000).toISOString(),
      endIso: new Date(dayStart + 10 * 60 * 60_000).toISOString(),
      coordinates: { latitude: 55.458, longitude: 12.182 },
    },
    {
      id: 'qa-cph',
      title: 'Meeting in Copenhagen',
      time: '14:00 - 15:00',
      location: 'Copenhagen',
      status: 'pending',
      startIso: new Date(dayStart + 14 * 60 * 60_000).toISOString(),
      endIso: new Date(dayStart + 15 * 60 * 60_000).toISOString(),
      coordinates: { latitude: 55.6761, longitude: 12.5683 },
    },
    {
      id: 'qa-cph2',
      title: 'Another meeting Copenhagen',
      time: '10:00 - 11:00',
      location: 'Copenhagen',
      status: 'pending',
      startIso: new Date(nextDay + 10 * 60 * 60_000).toISOString(),
      endIso: new Date(nextDay + 11 * 60 * 60_000).toISOString(),
      coordinates: { latitude: 55.6761, longitude: 12.5683 },
    },
  ] as CalendarEvent[];
}

/**
 * QA: Run findSmartSlots with fake meetings, validate every slot is feasible.
 * Ensures no overlap, travel feasible, reachable from work/now when Start-anchor.
 */
export function runFakeMeetingsQA(): { pass: boolean; message: string } {
  const fakeSchedule = getFakeQASchedule();
  const hojeTaastrup = { lat: 55.6517, lon: 12.2722 };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const windowEnd = addDays(tomorrow, 6);

  const result = findSmartSlots({
    schedule: fakeSchedule,
    newLocation: hojeTaastrup,
    durationMinutes: 60,
    preferences: DEFAULT_PREFS,
    searchWindow: { start: tomorrow, end: windowEnd },
    clampSearchStartToToday: false,
    includeExplain: true,
  });

  // Køge ends 10:00, postBuffer 15, travel ~35m → earliest start after Køge ~10:50
  const kogeEndMs = startOfDay(tomorrow).getTime() + 10 * 60 * 60_000;
  const postBuffer = 15;
  const travelMin = getTravelMinutes({ lat: 55.458, lon: 12.182 }, hojeTaastrup, kogeEndMs);
  const earliestAfterKoge = kogeEndMs + postBuffer * MS_PER_MIN + travelMin * MS_PER_MIN;

  const errors: string[] = [];

  for (let i = 0; i < result.length; i++) {
    const s = result[i]!;
    // No overlap with any fake meeting
    for (const ev of fakeSchedule) {
      const r = ev.startIso && ev.endIso
        ? { startMs: new Date(ev.startIso).getTime(), endMs: new Date(ev.endIso).getTime() }
        : null;
      if (r && intervalsOverlap(s.startMs, s.endMs, r.startMs, r.endMs)) {
        errors.push(`Slot ${i} (${s.dayIso} ${new Date(s.startMs).toTimeString().slice(0, 5)}) overlaps ${ev.title}`);
      }
    }
    // After Køge same day: must respect travel
    if (s.dayIso === toLocalDayKey(new Date(kogeEndMs)) && s.startMs < earliestAfterKoge) {
      errors.push(`Slot ${i} (${new Date(s.startMs).toTimeString().slice(0, 5)}) too soon after Køge: need ${postBuffer}+${travelMin}m, earliest ${new Date(earliestAfterKoge).toTimeString().slice(0, 5)}`);
    }
    // Explain must show feasible
    if (s.explain) {
      if (s.explain.travelFeasible === false) errors.push(`Slot ${i} explain.travelFeasible=false`);
      if (s.explain.noOverlap === false) errors.push(`Slot ${i} explain.noOverlap=false`);
      if (s.explain.bufferWaivedAtStart && s.explain.reachableFromWorkStart === false) {
        errors.push(`Slot ${i} explain.reachableFromWorkStart=false`);
      }
      if (s.explain.bufferWaivedAtStart && s.explain.travelFeasibleFromNow === false) {
        errors.push(`Slot ${i} explain.travelFeasibleFromNow=false`);
      }
    }
  }

  if (errors.length > 0) {
    return { pass: false, message: `FAIL: ${errors.join('; ')}` };
  }
  const best = result[0];
  const bestStr = best ? `${best.dayIso} ${new Date(best.startMs).toTimeString().slice(0, 5)}` : 'none';
  return { pass: true, message: `PASS: ${result.length} slots, best ${bestStr}, all feasible` };
}

/**
 * Run full QA suite. Call from dev: require('./utils/scheduler').runFullQASuite()
 */
export function runFullQASuite(): void {
  const results: { name: string; ok: boolean; msg: string }[] = [];

  const overlapOk = runOverlapSanityCheck();
  results.push({ name: 'Overlap + cross-midnight + empty-day + slack', ok: overlapOk, msg: overlapOk ? 'PASS' : 'FAIL' });

  const travelRes = runTravelFeasibilityQA();
  results.push({ name: 'Køge→Høje-Taastrup travel feasibility', ok: travelRes.pass, msg: travelRes.message });

  const fakeRes = runFakeMeetingsQA();
  results.push({ name: 'Fake meetings QA (multi-day)', ok: fakeRes.pass, msg: fakeRes.message });

  console.log('=== Scheduler QA Suite ===');
  results.forEach((r) => {
    console.log(`[${r.ok ? 'OK' : 'FAIL'}] ${r.name}: ${r.msg}`);
  });
  const allPass = results.every((r) => r.ok);
  console.log(allPass ? 'All tests PASS' : 'Some tests FAIL');
}

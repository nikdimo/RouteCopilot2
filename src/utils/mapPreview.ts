import { addDays, startOfDay } from 'date-fns';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot, SlotExplainShift } from './scheduler';

const MS_PER_MIN = 60_000;

function eventToStartMs(ev: CalendarEvent, dayStartMs: number): number | null {
  if (ev.startIso) {
    try {
      return new Date(ev.startIso).getTime();
    } catch {
      return parseTimeStart(ev.time, dayStartMs);
    }
  }
  return parseTimeStart(ev.time, dayStartMs);
}

function parseTimeStart(timeStr: string | undefined, dayStartMs: number): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split('-').map((p) => p.trim());
  if (parts.length < 2) return null;
  const [sh, sm] = (parts[0] ?? '00:00').split(':').map((x) => parseInt(x || '0', 10));
  return dayStartMs + (sh * 60 + sm) * MS_PER_MIN;
}

function getDayStartMs(dayIso: string): number {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  return startOfDay(new Date(y, mo - 1, d)).getTime();
}

function getShiftedStartMsById(shifted: SlotExplainShift[] | undefined): Map<string, number> {
  if (!shifted || shifted.length === 0) return new Map();
  return new Map(shifted.map((s) => [s.id, s.toStartMs]));
}

type EventWithCoord = CalendarEvent & { coordinates: { latitude: number; longitude: number } };
type PreparedEvent = {
  event: EventWithCoord;
  startMs: number;
  adjustedStartMs: number;
};

export type LatLng = { latitude: number; longitude: number };
export type InsertionSource = 'anchors' | 'adjusted-time' | 'start-time' | 'append';

export type RouteInsertionResolution = {
  orderedEvents: EventWithCoord[];
  insertIndex: number;
  insertionSource: InsertionSource;
  prevAnchorId: string | null;
  nextAnchorId: string | null;
  orderedEventIds: string[];
  orderedEventIdsWithInsertion: string[];
};

export type RouteWithInsertionMeta = {
  coordsWithInsertion: LatLng[];
  insertIndexInMiddle: number;
  sortedEventIds: string[];
  orderedSequenceIds: string[];
  insertionSource: InsertionSource;
  prevAnchorId: string | null;
  nextAnchorId: string | null;
};

/**
 * Resolve insertion order for map preview.
 * Priority:
 * 1) Slot logical anchors (prev/next) from scheduler explain metadata.
 * 2) Shift-adjusted temporal order.
 * 3) Slot start-time fallback.
 */
export function resolveRouteInsertion(
  dayEvents: CalendarEvent[],
  slot: ScoredSlot,
  insertionMarkerId = '__NEW__'
): RouteInsertionResolution {
  const dayStartMs = getDayStartMs(slot.dayIso);
  const shiftedStartById = getShiftedStartMsById(slot.explain?.shiftedEvents);

  const prepared: PreparedEvent[] = dayEvents
    .filter(
      (a): a is EventWithCoord =>
        a.coordinates != null &&
        typeof a.coordinates.latitude === 'number' &&
        typeof a.coordinates.longitude === 'number'
    )
    .map((event) => {
      const startMs = eventToStartMs(event, dayStartMs) ?? Number.MAX_SAFE_INTEGER;
      const adjustedStartMs = shiftedStartById.get(event.id) ?? startMs;
      return { event, startMs, adjustedStartMs };
    })
    .sort((a, b) => {
      if (a.adjustedStartMs !== b.adjustedStartMs) return a.adjustedStartMs - b.adjustedStartMs;
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return a.event.id.localeCompare(b.event.id);
    });

  const orderedEvents = prepared.map((item) => item.event);
  const orderedEventIds = orderedEvents.map((ev) => ev.id);

  const prevAnchorId = slot.explain?.prev.type === 'event' ? slot.explain.prev.id : null;
  const nextAnchorId = slot.explain?.next.type === 'event' ? slot.explain.next.id : null;
  const prevIndex = prevAnchorId ? orderedEventIds.indexOf(prevAnchorId) : -1;
  const nextIndex = nextAnchorId ? orderedEventIds.indexOf(nextAnchorId) : -1;

  let insertIndex = -1;
  let insertionSource: InsertionSource = 'append';

  if (prevIndex >= 0 || nextIndex >= 0) {
    if (prevIndex >= 0 && nextIndex >= 0) {
      insertIndex = prevIndex < nextIndex ? prevIndex + 1 : nextIndex;
    } else if (prevIndex >= 0) {
      insertIndex = prevIndex + 1;
    } else {
      insertIndex = nextIndex;
    }
    insertionSource = 'anchors';
  }

  if (insertIndex < 0) {
    const fallbackStartMs = slot.explain?.meetingStartMs ?? slot.startMs;
    const fallbackIndex = prepared.findIndex((ev) => fallbackStartMs < ev.adjustedStartMs);
    if (fallbackIndex >= 0) {
      insertIndex = fallbackIndex;
      insertionSource = shiftedStartById.size > 0 ? 'adjusted-time' : 'start-time';
    } else {
      insertIndex = prepared.length;
      insertionSource = 'append';
    }
  }

  const safeInsertIndex = Math.max(0, Math.min(insertIndex, orderedEvents.length));
  const orderedEventIdsWithInsertion = [
    ...orderedEventIds.slice(0, safeInsertIndex),
    insertionMarkerId,
    ...orderedEventIds.slice(safeInsertIndex),
  ];

  return {
    orderedEvents,
    insertIndex: safeInsertIndex,
    insertionSource,
    prevAnchorId,
    nextAnchorId,
    orderedEventIds,
    orderedEventIdsWithInsertion,
  };
}

export function buildRouteWithInsertionMeta(
  dayEvents: CalendarEvent[],
  insertionCoord: { lat: number; lon: number },
  slot: ScoredSlot,
  homeBase: { lat: number; lon: number },
  insertionMarkerId = '__NEW__'
): RouteWithInsertionMeta {
  const homePoint = { latitude: homeBase.lat, longitude: homeBase.lon };
  const insertionPoint = { latitude: insertionCoord.lat, longitude: insertionCoord.lon };

  const resolved = resolveRouteInsertion(dayEvents, slot, insertionMarkerId);
  const middle = [
    ...resolved.orderedEvents.slice(0, resolved.insertIndex).map((a) => a.coordinates),
    insertionPoint,
    ...resolved.orderedEvents.slice(resolved.insertIndex).map((a) => a.coordinates),
  ];

  return {
    coordsWithInsertion: [homePoint, ...middle, homePoint],
    insertIndexInMiddle: resolved.insertIndex,
    sortedEventIds: resolved.orderedEventIds,
    orderedSequenceIds: resolved.orderedEventIdsWithInsertion,
    insertionSource: resolved.insertionSource,
    prevAnchorId: resolved.prevAnchorId,
    nextAnchorId: resolved.nextAnchorId,
  };
}

/** Build route coordinates for a day with the new visit inserted at the resolved position. */
export function buildRouteWithInsertion(
  dayEvents: CalendarEvent[],
  insertionCoord: { lat: number; lon: number },
  slot: ScoredSlot,
  homeBase: { lat: number; lon: number }
): LatLng[] {
  return buildRouteWithInsertionMeta(dayEvents, insertionCoord, slot, homeBase).coordsWithInsertion;
}

/**
 * QA: preview insertion consistency for proposals with different display times
 * but the same logical prev/next insertion anchors.
 */
export function runMapPreviewInsertionQA(): { pass: boolean; message: string } {
  const day = addDays(startOfDay(new Date()), 1);
  const dayIso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const dayStartMs = startOfDay(day).getTime();

  const mkEvent = (id: string, hour: number): CalendarEvent => {
    const startMs = dayStartMs + hour * 60 * MS_PER_MIN;
    const endMs = startMs + 30 * MS_PER_MIN;
    return {
      id,
      title: id,
      time: `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:30`,
      location: id,
      status: 'pending',
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      coordinates: { latitude: 55.67 + hour / 1000, longitude: 12.56 + hour / 1000 },
    };
  };

  const m1 = mkEvent('M1', 10);
  const m2 = mkEvent('M2', 12);
  const dayEvents = [m1, m2];

  const mkSlot = (id: string, slotHour: number): ScoredSlot => {
    const startMs = dayStartMs + slotHour * 60 * MS_PER_MIN;
    const endMs = startMs + 30 * MS_PER_MIN;
    return {
      dayIso,
      startMs,
      endMs,
      score: 0,
      tier: 1,
      metrics: {
        detourKm: 0,
        detourMinutes: 0,
        slackMinutes: 20,
        travelToMinutes: 5,
        travelFromMinutes: 5,
      },
      label: id,
      explain: {
        dayKey: dayIso,
        prev: { id: 'M1', title: 'M1', type: 'event', startMs: dayStartMs + 10 * 60 * MS_PER_MIN, endMs: dayStartMs + 10.5 * 60 * MS_PER_MIN, hasCoord: true },
        next: { id: 'M2', title: 'M2', type: 'event', startMs: dayStartMs + 12 * 60 * MS_PER_MIN, endMs: dayStartMs + 12.5 * 60 * MS_PER_MIN, hasCoord: true },
        prevDepartMs: dayStartMs + 10.5 * 60 * MS_PER_MIN,
        arriveByMs: startMs - 15 * MS_PER_MIN,
        meetingStartMs: startMs,
        meetingEndMs: endMs,
        departAtMs: endMs + 15 * MS_PER_MIN,
        nextArriveByMs: dayStartMs + 12 * 60 * MS_PER_MIN - 15 * MS_PER_MIN,
        gapMinutes: 90,
        travelToMinutes: 5,
        travelFromMinutes: 5,
        travelToUsedFallback: false,
        travelFromUsedFallback: false,
        preBuffer: 15,
        postBuffer: 15,
        baselineMinutes: 10,
        newPathMinutes: 10,
        detourMinutes: 0,
        detourKm: 0,
        slackMinutes: 20,
        score: 0,
        tier: 1,
        fitsGap: true,
        withinWorkingHours: true,
        notPast: true,
        workingDayAllowed: true,
        noOverlap: true,
        travelFeasible: true,
        eventsWithMissingCoordsUsed: [],
      },
    };
  };

  const proposalA = mkSlot('A', 11);
  const proposalB = mkSlot('B', 14); // different display slot, same logical anchors

  const resA = resolveRouteInsertion(dayEvents, proposalA, 'NEW');
  const resB = resolveRouteInsertion(dayEvents, proposalB, 'NEW');

  const seqA = resA.orderedEventIdsWithInsertion.join('>');
  const seqB = resB.orderedEventIdsWithInsertion.join('>');
  const expected = 'M1>NEW>M2';

  if (seqA !== expected || seqB !== expected) {
    return {
      pass: false,
      message: `FAIL: expected ${expected} for both proposals, got A=${seqA}, B=${seqB}.`,
    };
  }

  return {
    pass: true,
    message: 'PASS: map preview insertion follows logical anchors consistently across proposal variants.',
  };
}

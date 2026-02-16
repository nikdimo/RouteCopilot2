import { startOfDay } from 'date-fns';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';

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

export type LatLng = { latitude: number; longitude: number };

/** Build route coordinates for a day with the new visit inserted at the correct position. */
export function buildRouteWithInsertion(
  dayEvents: CalendarEvent[],
  insertionCoord: { lat: number; lon: number },
  slot: ScoredSlot,
  homeBase: { lat: number; lon: number }
): LatLng[] {
  const homePoint = { latitude: homeBase.lat, longitude: homeBase.lon };
  const insertionPoint = { latitude: insertionCoord.lat, longitude: insertionCoord.lon };

  const withCoords = dayEvents.filter(
    (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
      a.coordinates != null
  );

  const [y, mo, d] = slot.dayIso.split('-').map((x) => parseInt(x, 10));
  const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();

  const sorted = [...withCoords].sort((a, b) => {
    const aMs = eventToStartMs(a, dayStartMs) ?? 0;
    const bMs = eventToStartMs(b, dayStartMs) ?? 0;
    return aMs - bMs;
  });

  const slotStartMs = slot.startMs;
  let insertIndex = sorted.length;
  for (let i = 0; i < sorted.length; i++) {
    const evMs = eventToStartMs(sorted[i], dayStartMs);
    if (evMs != null && slotStartMs < evMs) {
      insertIndex = i;
      break;
    }
  }

  const middle = [
    ...sorted.slice(0, insertIndex).map((a) => a.coordinates),
    insertionPoint,
    ...sorted.slice(insertIndex).map((a) => a.coordinates),
  ];

  return [homePoint, ...middle, homePoint];
}

import type { CalendarEvent } from '../services/graph';

const EARTH_RADIUS_KM = 6371;

/**
 * Parse start time from event.time (e.g. "10:00 - 11:00" -> "10:00").
 * Used for sorting; returns empty string if no time.
 */
function getStartTimeString(event: CalendarEvent): string {
  if (!event.time || typeof event.time !== 'string') return '';
  const part = event.time.split('-')[0];
  return part ? part.trim() : '';
}

/**
 * Haversine distance in kilometers between two points.
 */
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_RADIUS_KM * c;
}

export type StartLocation = { latitude: number; longitude: number };

/**
 * Sort appointments by start time (earlier first).
 * Tie-breaker: if startLocation is provided and times are equal, use distance (nearest first); otherwise keep order.
 */
export function sortAppointmentsByTime(
  appointments: CalendarEvent[],
  startLocation?: StartLocation
): CalendarEvent[] {
  const sorted = [...appointments];
  sorted.sort((a, b) => {
    const timeA = getStartTimeString(a);
    const timeB = getStartTimeString(b);
    if (timeA !== timeB) {
      return timeA.localeCompare(timeB);
    }
    if (startLocation && a.coordinates && b.coordinates) {
      const distA = haversineKm(startLocation, a.coordinates);
      const distB = haversineKm(startLocation, b.coordinates);
      return distA - distB;
    }
    return 0;
  });
  return sorted;
}

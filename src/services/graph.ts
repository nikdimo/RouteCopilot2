import * as Location from 'expo-location';

export type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  location: string;
  coordinates?: { latitude: number; longitude: number };
};

type GraphLocationCoordinates = {
  latitude?: number;
  longitude?: number;
};

type GraphEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  location?: {
    displayName?: string;
    address?: string | { street?: string; city?: string; state?: string; countryOrRegion?: string };
    coordinates?: GraphLocationCoordinates;
  };
  organizer?: { emailAddress?: { name?: string } };
};

function formatTimeRange(startIso: string, endIso: string): string {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const s = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const e = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return `${s} - ${e}`;
  } catch {
    return '';
  }
}

function getAddressString(loc: GraphEvent['location']): string | undefined {
  if (!loc) return undefined;
  if (loc.displayName?.trim()) return loc.displayName.trim();
  if (typeof loc.address === 'string' && loc.address.trim()) return loc.address.trim();
  if (loc.address && typeof loc.address === 'object') {
    const a = loc.address;
    const parts = [a.street, a.city, a.state, a.countryOrRegion].filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  return undefined;
}

async function mapEventAsync(ev: GraphEvent): Promise<CalendarEvent> {
  const time = formatTimeRange(ev.start.dateTime, ev.end.dateTime);
  const location = ev.location?.displayName ?? '';
  let coordinates: { latitude: number; longitude: number } | undefined;

  const coords = ev.location?.coordinates;
  if (
    coords != null &&
    typeof coords.latitude === 'number' &&
    typeof coords.longitude === 'number'
  ) {
    coordinates = { latitude: coords.latitude, longitude: coords.longitude };
  } else {
    const addressString = getAddressString(ev.location);
    if (addressString) {
      try {
        const result = await Location.geocodeAsync(addressString);
        if (result.length > 0 && result[0]) {
          coordinates = {
            latitude: result[0].latitude,
            longitude: result[0].longitude,
          };
        }
      } catch {
        // leave coordinates undefined
      }
    }
  }

  return {
    id: ev.id,
    title: ev.subject ?? '(No title)',
    time,
    location,
    coordinates,
  };
}

export async function getCalendarEvents(
  token: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    // continue without geocoding; events will have coordinates only when provided by Graph
  }

  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $select: 'subject,start,end,location,organizer',
  });
  const url = `https://graph.microsoft.com/v1.0/me/calendarview?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar request failed: ${res.status}`);
  }
  const data = await res.json();
  const events: GraphEvent[] = data.value ?? [];
  return Promise.all(events.map(mapEventAsync));
}

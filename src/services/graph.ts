import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { EventStatus } from '../types';
import { geocodeAddress, geocodeContactAddress } from '../utils/geocoding';

/** Thrown when Graph API returns 401 Unauthorized - token is expired or invalid */
export class GraphUnauthorizedError extends Error {
  constructor() {
    super('Session expired or invalid');
    this.name = 'GraphUnauthorizedError';
  }
}

// ===== REQUEST DEDUPLICATION & RATE LIMIT HANDLING =====

/** Cache in-flight calendar requests to prevent duplicate fetches */
const _calendarInflight = new Map<string, Promise<CalendarEvent[]>>();

/** Helper: retry with exponential backoff for 429 rate limit errors */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);

    // Success or non-retryable error
    if (res.ok || (res.status !== 429 && res.status !== 503)) {
      return res;
    }

    // Rate limited - wait and retry
    if (attempt < maxRetries) {
      const retryAfter = res.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s

      await new Promise(resolve => setTimeout(resolve, delayMs));
    } else {
      // Max retries reached
      return res;
    }
  }

  throw new Error('Max retries exceeded');
}

/** Helper: limit parallel promises to maxConcurrent */
async function limitConcurrency<T>(
  items: T[],
  maxConcurrent: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < maxConcurrent && queue.length > 0) {
      const item = queue.shift()!;
      const promise = fn(item).finally(() => {
        active.splice(active.indexOf(promise), 1);
      });
      active.push(promise);
    }

    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

export type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  location: string;
  coordinates?: { latitude: number; longitude: number };
  status: EventStatus;
  /** ISO string for scheduler (date filtering) */
  startIso?: string;
  endIso?: string;
  /** Local notes (MVP; not synced to Outlook yet) */
  notes?: string;
  /** Contact phone for call button (populated from contact lookup when available) */
  phone?: string;
  /** Contact email for mail button (populated from contact lookup when available) */
  email?: string;
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

/**
 * Graph returns dateTime with timeZone e.g. "2025-02-13T07:45:00.0000000" + timeZone "UTC".
 * Without a Z suffix, JS parses it as LOCAL time, causing a 1-hour display error.
 * Normalize so UTC times parse correctly.
 */
function normalizeGraphDateTime(dateTime: string, timeZone?: string): string {
  if (!dateTime) return dateTime;
  const tz = (timeZone ?? '').toLowerCase();
  const isUtc = tz === 'utc' || tz === 'gmt' || tz === 'z';
  const hasOffset = /[Zz+-]\d{2}:?\d{2}$/.test(dateTime);
  if (isUtc && !hasOffset && !dateTime.endsWith('Z')) {
    const normalized = dateTime.replace(/\.\d+$/, '');
    return normalized + 'Z';
  }
  return dateTime;
}

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

/** Location label shown to user (prefer displayName). */
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

/** Best string for geocoding. Prefer full address over displayName (contacts often have address in address field). */
function getAddressForGeocode(loc: GraphEvent['location']): string | undefined {
  if (!loc) return undefined;
  if (typeof loc.address === 'string' && loc.address.trim()) return loc.address.trim();
  if (loc.address && typeof loc.address === 'object') {
    const a = loc.address;
    const parts = [a.street, a.city, a.state, a.countryOrRegion].filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  if (loc.displayName?.trim()) return loc.displayName.trim();
  return undefined;
}

/** Synchronous field mapping — no geocoding. Uses only Graph-provided coordinates. */
function mapEventSync(ev: GraphEvent): CalendarEvent {
  const startIso = normalizeGraphDateTime(ev.start.dateTime, ev.start.timeZone);
  const endIso = normalizeGraphDateTime(ev.end.dateTime, ev.end.timeZone);
  const time = formatTimeRange(startIso, endIso);
  const location = getAddressString(ev.location) ?? '';

  let coordinates: { latitude: number; longitude: number } | undefined;
  const coords = ev.location?.coordinates;
  if (
    coords != null &&
    typeof coords.latitude === 'number' &&
    typeof coords.longitude === 'number'
  ) {
    coordinates = { latitude: coords.latitude, longitude: coords.longitude };
  }

  return {
    id: ev.id,
    title: ev.subject ?? '(No title)',
    time,
    location,
    coordinates,
    status: 'pending',
    startIso,
    endIso,
  };
}

/** Geocode all events in parallel that have an address but no coordinates. */
async function geocodeEventsAsync(events: CalendarEvent[]): Promise<CalendarEvent[]> {
  const needGeocode = events.filter((ev) => !ev.coordinates && (ev.location?.trim() ?? '') !== '');
  if (needGeocode.length === 0) return events;

  if (Platform.OS !== 'web') {
    await Location.requestForegroundPermissionsAsync().catch(() => {});
  }

  const enriched = await Promise.all(
    needGeocode.map(async (ev) => {
      const addr = ev.location?.trim() || null;
      if (!addr) return ev;
      let coordinates: { latitude: number; longitude: number } | undefined;
      if (Platform.OS === 'web') {
        const result = await geocodeAddress(addr);
        if (result.success) coordinates = { latitude: result.lat, longitude: result.lon };
      } else {
        try {
          const result = await Location.geocodeAsync(addr);
          if (result.length > 0 && result[0]) {
            coordinates = { latitude: result[0].latitude, longitude: result[0].longitude };
          }
        } catch { /* native failed */ }
        if (!coordinates) {
          const fallback = await geocodeAddress(addr);
          if (fallback.success) coordinates = { latitude: fallback.lat, longitude: fallback.lon };
        }
      }
      return coordinates ? { ...ev, coordinates } : ev;
    })
  );

  const byId = new Map(enriched.map((ev) => [ev.id, ev]));
  return events.map((ev) => byId.get(ev.id) ?? ev);
}

/** Full single-event mapping with geocoding (used by create/update flows). */
async function mapEventAsync(ev: GraphEvent): Promise<CalendarEvent> {
  const raw = mapEventSync(ev);
  if (raw.coordinates) return raw;
  const [withCoords] = await geocodeEventsAsync([raw]);
  return withCoords ?? raw;
}

/** Fetch raw Graph calendar events and map them synchronously (no geocoding, no enrichment). */
async function fetchGraphEvents(
  token: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  // Deduplicate identical requests
  const cacheKey = `${startDate.toISOString()}|${endDate.toISOString()}`;
  if (_calendarInflight.has(cacheKey)) {
    return _calendarInflight.get(cacheKey)!;
  }

  const promise = _fetchGraphEventsInternal(token, startDate, endDate);
  _calendarInflight.set(cacheKey, promise);
  promise.finally(() => {
    // Clean up after 2 seconds to allow short-term deduplication
    setTimeout(() => _calendarInflight.delete(cacheKey), 2000);
  });

  return promise;
}

async function _fetchGraphEventsInternal(
  token: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $select: 'subject,start,end,location,organizer',
    $top: '999',
  });
  const baseUrl = `https://graph.microsoft.com/v1.0/me/calendarview?${params.toString()}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Prefer: `outlook.timezone="${tz}"`,
  };

  const allGraphEvents: GraphEvent[] = [];
  let nextLink: string | null = baseUrl;
  while (nextLink) {
    const res = await fetchWithRetry(nextLink, { headers });
    if (res.status === 401) throw new GraphUnauthorizedError();
    if (!res.ok) throw new Error(`Calendar request failed: ${res.status}`);
    const data = await res.json();
    const page: GraphEvent[] = data.value ?? [];
    allGraphEvents.push(...page);
    nextLink = data['@odata.nextLink'] ?? null;
  }

  return allGraphEvents.map(mapEventSync);
}

/**
 * Fast calendar fetch — returns events immediately using only Graph-provided coordinates.
 * Use this when you need to show the list quickly; call enrichCalendarEventsAll afterwards
 * in the background to fill in geocoded coordinates and contact info.
 */
export async function getCalendarEventsRaw(
  token: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  return fetchGraphEvents(token, startDate, endDate);
}

/**
 * Enrich a batch of events: geocode addresses + fill contact addresses + fill contact info.
 * Run this after getCalendarEventsRaw to progressively improve displayed data.
 */
export async function enrichCalendarEventsAll(
  token: string,
  events: CalendarEvent[]
): Promise<CalendarEvent[]> {
  const geocoded = await geocodeEventsAsync(events);
  try {
    const withAddresses = await enrichCalendarEventsWithContactAddresses(token, geocoded);
    return await enrichCalendarEventsWithContactInfo(token, withAddresses);
  } catch {
    return geocoded;
  }
}

/** Full pipeline: fetch + geocode + enrich. Use when you can afford the wait. */
export async function getCalendarEvents(
  token: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const raw = await fetchGraphEvents(token, startDate, endDate);
  return enrichCalendarEventsAll(token, raw);
}

/**
 * For events missing phone/email, try to find a matching Outlook contact by event title or location
 * and attach their phone and email. Runs for all events (including those that already have coordinates)
 * so that e.g. "D4_Faxe" at "Hovedgaden 24, 4654 Faxe" gets contact details from the D4_Faxe contact.
 */
async function enrichCalendarEventsWithContactInfo(
  token: string,
  events: CalendarEvent[]
): Promise<CalendarEvent[]> {
  const needInfo = events.filter(
    (e) => (!e.phone || !e.email) && ((e.title?.trim() ?? '') !== '' || (e.location?.trim() ?? '') !== '')
  );
  if (needInfo.length === 0) return events;

  const keys = new Set<string>();
  for (const e of needInfo) {
    const t = e.title?.trim();
    const loc = e.location?.trim();
    if (t) keys.add(t);
    if (loc && loc !== t) keys.add(loc);
  }

  const keyToContact = new Map<string, { phone?: string; email?: string }>();

  // Throttled contact lookups (max 3 concurrent to avoid rate limits)
  await limitConcurrency([...keys], 3, async (key) => {
    // Add small delay to spread out requests
    await new Promise(resolve => setTimeout(resolve, 100));
    const result = await searchContacts(token, key);
    if (!result.success || !result.contacts?.length) return;
    const exact = result.contacts.find((c) => c.displayName.toLowerCase() === key.toLowerCase());
    const contact = exact ?? result.contacts.find((c) => c.phones.length > 0 || c.emails.length > 0);
    if (contact) {
      keyToContact.set(key, {
        phone: contact.phones[0]?.trim() || undefined,
        email: contact.emails[0]?.trim() || undefined,
      });
    }
  });

  if (keyToContact.size === 0) return events;

  return events.map((ev) => {
    if (ev.phone && ev.email) return ev;
    const byTitle = ev.title?.trim() ? keyToContact.get(ev.title.trim()) : undefined;
    const byLocation = ev.location?.trim() ? keyToContact.get(ev.location.trim()) : undefined;
    const data = byTitle ?? byLocation;
    if (!data) return ev;
    return {
      ...ev,
      ...(ev.phone ? {} : data.phone ? { phone: data.phone } : {}),
      ...(ev.email ? {} : data.email ? { email: data.email } : {}),
    };
  });
}

/**
 * For events with location but no coordinates, try to find a matching Outlook contact
 * and use their business address for geocoding. Fixes events created in Outlook with
 * contact name (e.g. "D4_Faxe") instead of full address.
 */
export async function enrichCalendarEventsWithContactAddresses(
  token: string,
  events: CalendarEvent[]
): Promise<CalendarEvent[]> {
  const needEnrichment = events.filter((e) => (e.location?.trim() ?? '') !== '' && !e.coordinates);
  if (needEnrichment.length === 0) return events;

  const uniqueLocations = [...new Set(needEnrichment.map((e) => e.location!.trim()))];
  const locationToEnriched = new Map<
    string,
    { location: string; coordinates: { latitude: number; longitude: number }; phone?: string; email?: string }
  >();

  // Parallel contact + geocode lookups for all unique locations
  await Promise.all(
    uniqueLocations.map(async (loc) => {
      const result = await searchContacts(token, loc);
      if (!result.success || !result.contacts || result.contacts.length === 0) return;

      const exactMatch = result.contacts.find(
        (c) => c.displayName.toLowerCase() === loc.toLowerCase() && c.hasAddress
      );
      const contact = exactMatch ?? result.contacts.find((c) => c.hasAddress);
      if (!contact?.hasAddress || !contact.formattedAddress) return;

      const geocodeResult = await geocodeContactAddress(contact.formattedAddress, contact.bestAddress);
      if (!geocodeResult.success) return;

      locationToEnriched.set(loc, {
        location: contact.formattedAddress,
        coordinates: { latitude: geocodeResult.lat, longitude: geocodeResult.lon },
        phone: contact.phones[0]?.trim() || undefined,
        email: contact.emails[0]?.trim() || undefined,
      });
    })
  );

  if (locationToEnriched.size === 0) return events;

  return events.map((ev) => {
    if (!ev.coordinates && ev.location) {
      const enriched = locationToEnriched.get(ev.location.trim());
      if (enriched) {
        return {
          ...ev,
          location: enriched.location,
          coordinates: enriched.coordinates,
          ...(enriched.phone && { phone: enriched.phone }),
          ...(enriched.email && { email: enriched.email }),
        };
      }
    }
    return ev;
  });
}

export type CreateEventInput = {
  subject: string;
  startIso: string;
  endIso: string;
  location?: string;
  body?: string;
};

export type CreateEventResult =
  | { success: true; event: CalendarEvent }
  | { success: false; error: string; needsConsent?: boolean };

/** Format UTC ISO string as local datetime + timezone for Graph (avoids UTC round-trip display shifts) */
function toGraphDateTime(utcIso: string): { dateTime: string; timeZone: string } {
  const d = new Date(utcIso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const localDateTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  return { dateTime: localDateTime, timeZone: tz };
}

/** Create a calendar event. Uses Calendars.ReadWrite scope. */
export async function createCalendarEvent(
  token: string,
  input: CreateEventInput
): Promise<CreateEventResult> {
  const url = 'https://graph.microsoft.com/v1.0/me/events';
  const start = toGraphDateTime(input.startIso);
  const end = toGraphDateTime(input.endIso);
  const body = {
    subject: input.subject,
    start: { dateTime: start.dateTime, timeZone: start.timeZone },
    end: { dateTime: end.dateTime, timeZone: end.timeZone },
    location: input.location ? { displayName: input.location } : undefined,
    body: input.body ? { content: input.body, contentType: 'text' } : undefined,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new GraphUnauthorizedError();
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    const code = data?.error?.code ?? '';
    return {
      success: false,
      error: 'Calendar write permission denied',
      needsConsent: code.includes('AccessDenied') || code.includes('Forbidden'),
    };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: txt || `HTTP ${res.status}` };
  }
  const graphEv = (await res.json()) as GraphEvent;
  const event = await mapEventAsync(graphEv);
  return { success: true, event };
}

export type UpdateEventResult =
  | { success: true; event: CalendarEvent }
  | { success: false; error: string; needsConsent?: boolean };

/** Update a calendar event. Event must have been created via Graph (not local-only). */
export async function updateCalendarEvent(
  token: string,
  eventId: string,
  patch: { subject?: string; startIso?: string; endIso?: string; location?: string; body?: string }
): Promise<UpdateEventResult> {
  if (eventId.startsWith('local-')) {
    return { success: false, error: 'Cannot sync local-only event to Outlook' };
  }
  const url = `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
  const body: Record<string, unknown> = {};
  if (patch.subject != null) body.subject = patch.subject;
  if (patch.startIso != null) body.start = toGraphDateTime(patch.startIso);
  if (patch.endIso != null) body.end = toGraphDateTime(patch.endIso);
  if (patch.location != null) body.location = { displayName: patch.location };
  if (patch.body != null) body.body = { content: patch.body, contentType: 'text' };
  if (Object.keys(body).length === 0) return { success: false, error: 'No fields to update' };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new GraphUnauthorizedError();
  if (res.status === 403) {
    return { success: false, error: 'Calendar write permission denied', needsConsent: true };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: txt || `HTTP ${res.status}` };
  }
  const graphEv = (await res.json()) as GraphEvent;
  const event = await mapEventAsync(graphEv);
  return { success: true, event };
}

export type DeleteEventResult =
  | { success: true }
  | { success: false; error: string; needsConsent?: boolean };

/** Delete a calendar event. Event must have been created via Graph. */
export async function deleteCalendarEvent(
  token: string,
  eventId: string
): Promise<DeleteEventResult> {
  if (eventId.startsWith('local-')) {
    return { success: false, error: 'Cannot delete local-only event from Outlook' };
  }
  const url = `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new GraphUnauthorizedError();
  if (res.status === 403) {
    return { success: false, error: 'Calendar write permission denied', needsConsent: true };
  }
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
  return { success: true };
}

export type CreateContactInput = {
  givenName?: string;
  surname?: string;
  displayName?: string;
  companyName?: string;
  businessPhones?: string[];
  emailAddresses?: { address: string; name?: string }[];
};

export type CreateContactResult =
  | { success: true; id: string }
  | { success: false; error: string; needsConsent?: boolean };

/** Create a contact. Uses Contacts.ReadWrite scope. */
export async function createContact(
  token: string,
  input: CreateContactInput
): Promise<CreateContactResult> {
  const url = 'https://graph.microsoft.com/v1.0/me/contacts';
  const body: Record<string, unknown> = {};
  if (input.givenName) body.givenName = input.givenName;
  if (input.surname) body.surname = input.surname;
  if (input.displayName) body.displayName = input.displayName;
  if (input.companyName) body.companyName = input.companyName;
  if (input.businessPhones?.length) body.businessPhones = input.businessPhones;
  if (input.emailAddresses?.length)
    body.emailAddresses = input.emailAddresses.map((e) => ({
      address: e.address,
      name: e.name ?? e.address,
    }));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new GraphUnauthorizedError();
  if (res.status === 403) {
    return { success: false, error: 'Contacts write permission denied', needsConsent: true };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: txt || `HTTP ${res.status}` };
  }
  const data = (await res.json()) as { id?: string };
  return { success: true, id: data.id ?? '' };
}

// ─── Contact Search (Plan Visit location) ────────────────────────────────────
// In-flight deduplication: if the same query is already fetching, return the same promise
// Session cache: avoid re-fetching the same query within a session
const _contactInflight = new Map<string, Promise<SearchContactsResult>>();
const _contactCache = new Map<string, SearchContactsResult>();
const _CONTACT_CACHE_MAX = 200;

type GraphPhysicalAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryOrRegion?: string;
};

type GraphContact = {
  id?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  companyName?: string;
  businessPhones?: string[];
  homePhones?: string[];
  mobilePhone?: string;
  emailAddresses?: { address?: string; name?: string }[];
  homeAddress?: GraphPhysicalAddress;
  businessAddress?: GraphPhysicalAddress;
  otherAddress?: GraphPhysicalAddress;
};

export type ContactSearchResult = {
  id: string;
  displayName: string;
  companyName?: string;
  phones: string[];
  emails: string[];
  bestAddress: GraphPhysicalAddress | null;
  formattedAddress: string; // "street, postalCode city, country"
  hasAddress: boolean;
};

function formatPhysicalAddress(addr: GraphPhysicalAddress | undefined): string {
  if (!addr) return '';
  const parts: string[] = [];
  if (addr.street?.trim()) parts.push(addr.street.trim());
  const locality = [addr.postalCode, addr.city].filter(Boolean).join(' ');
  if (locality) parts.push(locality);
  if (addr.state?.trim()) parts.push(addr.state.trim());
  if (addr.countryOrRegion?.trim()) parts.push(addr.countryOrRegion.trim());
  return parts.join(', ');
}

function getBestAddress(c: GraphContact): GraphPhysicalAddress | null {
  const biz = c.businessAddress;
  const home = c.homeAddress;
  const other = c.otherAddress;
  if (biz && formatPhysicalAddress(biz)) return biz;
  if (home && formatPhysicalAddress(home)) return home;
  if (other && formatPhysicalAddress(other)) return other;
  return null;
}

function contactMatchesQuery(c: GraphContact, queryLower: string): boolean {
  if (!queryLower || queryLower.length < 1) return false;
  const fields = [
    c.displayName,
    c.givenName,
    c.surname,
    c.companyName,
    c.emailAddresses?.[0]?.address,
  ].filter(Boolean) as string[];
  return fields.some((f) => f.toLowerCase().includes(queryLower));
}

export type SearchContactsResult =
  | { success: true; contacts: ContactSearchResult[] }
  | { success: false; error: string; needsConsent?: boolean; is401?: boolean; is403?: boolean };

/**
 * Search Outlook contacts by display name, given name, surname, company.
 * Uses a session cache and in-flight deduplication to avoid redundant API calls.
 * Tries a fast server-side $search first ($top=25); falls back to fetching all 500 if needed.
 */
export async function searchContacts(
  token: string,
  query: string
): Promise<SearchContactsResult> {
  const q = query.trim();
  if (!q) return { success: true, contacts: [] };

  const cacheKey = q.toLowerCase();

  // Session cache hit
  if (_contactCache.has(cacheKey)) {
    return _contactCache.get(cacheKey)!;
  }

  // In-flight deduplication: reuse an ongoing request for the same query
  if (_contactInflight.has(cacheKey)) {
    return _contactInflight.get(cacheKey)!;
  }

  const promise = _doSearchContacts(token, q);
  _contactInflight.set(cacheKey, promise);
  promise
    .then((result) => {
      if (_contactCache.size >= _CONTACT_CACHE_MAX) {
        // Evict oldest entry when cache is full
        const firstKey = _contactCache.keys().next().value;
        if (firstKey) _contactCache.delete(firstKey);
      }
      _contactCache.set(cacheKey, result);
    })
    .finally(() => _contactInflight.delete(cacheKey));

  return promise;
}

async function _doSearchContacts(
  token: string,
  q: string
): Promise<SearchContactsResult> {
  const select =
    'id,displayName,givenName,surname,companyName,businessPhones,homePhones,mobilePhone,emailAddresses,homeAddress,businessAddress,otherAddress';

  // Fast path: server-side $search (returns top 25, avoids downloading 500 contacts)
  const searchUrl = `https://graph.microsoft.com/v1.0/me/contacts?$search="${encodeURIComponent(q)}"&$top=25&$select=${encodeURIComponent(select)}`;
  try {
    const searchRes = await fetchWithRetry(searchUrl, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
    });
    if (searchRes.ok) {
      const searchData = (await searchRes.json()) as { value?: GraphContact[] };
      const contacts = _mapGraphContacts(searchData.value ?? [], q);
      if (contacts.length > 0) return { success: true, contacts };
      // $search returned empty — fall through to full fetch for partial matches
    }
    // $search not supported or returned nothing — fall through
  } catch {
    // network error on fast path — fall through
  }

  // Fallback: full fetch + client-side filter
  const url = `https://graph.microsoft.com/v1.0/me/contacts?$top=500&$select=${encodeURIComponent(select)}`;
  try {
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      return { success: false, error: 'Session expired. Sign in again.', is401: true };
    }
    if (res.status === 403) {
      return {
        success: false,
        error: 'Grant Contacts.Read or Contacts.ReadWrite to search contacts.',
        needsConsent: true,
        is403: true,
      };
    }
    if (!res.ok) {
      const txt = await res.text();
      return { success: false, error: `Contacts request failed: ${res.status} ${txt}` };
    }

    const data = (await res.json()) as { value?: GraphContact[] };
    const all = data.value ?? [];
    const queryLower = q.toLowerCase();
    const filtered = q ? all.filter((c) => contactMatchesQuery(c, queryLower)) : [];
    return { success: true, contacts: _mapGraphContacts(filtered, q) };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

function _mapGraphContacts(raw: GraphContact[], _query: string): ContactSearchResult[] {
  return raw.map((c) => {
    const bestAddr = getBestAddress(c);
    const formatted = bestAddr ? formatPhysicalAddress(bestAddr) : '';
    const phones = [
      ...(c.businessPhones ?? []),
      ...(c.homePhones ?? []),
      c.mobilePhone,
    ].filter(Boolean) as string[];
    const emails = (c.emailAddresses ?? []).map((e) => e.address).filter(Boolean) as string[];
    return {
      id: c.id ?? '',
      displayName: c.displayName ?? c.givenName ?? c.surname ?? '(No name)',
      companyName: c.companyName,
      phones,
      emails,
      bestAddress: bestAddr,
      formattedAddress: formatted,
      hasAddress: !!formatted,
    };
  });
}

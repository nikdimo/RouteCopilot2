import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_HOME_BASE } from '../types';

const CACHE_KEY_PREFIX = 'routecopilot_geocode_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RouteCopilot/1.0 (field logistics MVP)';

export type GeocodeResult =
  | { success: true; lat: number; lon: number; displayName?: string; fromCache: boolean; usedFallback?: boolean }
  | { success: false; error: string };

export type AddressSuggestion = {
  displayName: string;
  /** When using Google Places, suggestions may have placeId and no coords; resolve via getCoordsForPlaceId on select. */
  lat?: number;
  lon?: number;
  placeId?: string;
};

export type PhysicalAddressParts = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryOrRegion?: string;
};

function normalizeAddressForCache(addr: string): string {
  return addr
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

type CacheEntry = { lat: number; lon: number; cachedAt: number };

async function getCached(addr: string): Promise<{ lat: number; lon: number } | null> {
  const key = CACHE_KEY_PREFIX + normalizeAddressForCache(addr);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
    return { lat: entry.lat, lon: entry.lon };
  } catch {
    return null;
  }
}

async function setCached(addr: string, lat: number, lon: number): Promise<void> {
  const key = CACHE_KEY_PREFIX + normalizeAddressForCache(addr);
  const entry: CacheEntry = { lat, lon, cachedAt: Date.now() };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // ignore cache write errors
  }
}

const COMMON_TYPOS: [RegExp, string][] = [
  [/\bcopehnagen\b/gi, 'Copenhagen'],
  [/\bkobenhavn\b/gi, 'København'],
];

function normalizeForGeocode(addr: string): string {
  let s = addr
    .trim()
    .replace(/\n/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
  for (const [re, repl] of COMMON_TYPOS) {
    s = s.replace(re, repl);
  }
  return s;
}

async function tryGeocode(q: string): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    addressdetails: '1',
  });

  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    return { success: false, error: `Geocoding failed: ${res.status}` };
  }

  const data = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;

  if (!Array.isArray(data) || data.length === 0) {
    return { success: false, error: 'Address not found' };
  }

  const first = data[0];
  const lat = parseFloat(first?.lat ?? '');
  const lon = parseFloat(first?.lon ?? '');

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return { success: false, error: 'Invalid geocode result' };
  }

  return {
    success: true,
    lat,
    lon,
    displayName: first?.display_name,
    fromCache: false,
  };
}

/**
 * Geocode an address to lat/lon using OpenStreetMap Nominatim.
 * Results are cached in AsyncStorage by normalized address.
 * Tries the address as-is, then with ", Denmark" if no result (for Nordic addresses).
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const trimmed = normalizeForGeocode(address);
  if (!trimmed) {
    return { success: false, error: 'Address is empty' };
  }

  const cached = await getCached(trimmed);
  if (cached) {
    return { success: true, lat: cached.lat, lon: cached.lon, fromCache: true };
  }

  try {
    let result = await tryGeocode(trimmed);
    if (result.success) {
      await setCached(trimmed, result.lat, result.lon);
      return result;
    }

    const hasCountry = /\b(denmark|dänemark|danmark|sverige|sweden|norge|norway|finland|tyskland|germany)\b/i.test(trimmed);
    if (!hasCountry && trimmed.length > 3) {
      const withCountry = `${trimmed}, Denmark`;
      result = await tryGeocode(withCountry);
      if (result.success) {
        await setCached(trimmed, result.lat, result.lon);
        return result;
      }
    }

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Geocode a contact's address with progressive fallback.
 * Tries: full address → postalCode+city+country → city+country → city.
 * If all fail, uses Denmark default (Copenhagen) so user can proceed.
 */
export async function geocodeContactAddress(
  formattedAddress: string,
  parts: PhysicalAddressParts | null
): Promise<GeocodeResult> {
  const variations: string[] = [formattedAddress];
  if (parts) {
    const pc = parts.postalCode?.trim();
    const city = parts.city?.trim();
    const country = parts.countryOrRegion?.trim();
    if (pc && city && country) {
      variations.push(`${pc} ${city}, ${country}`);
    }
    if (city && country) {
      variations.push(`${city}, ${country}`);
    }
    if (city) {
      variations.push(city);
    }
  }

  for (const addr of variations) {
    const trimmed = normalizeForGeocode(addr);
    if (!trimmed) continue;
    const result = await geocodeAddress(trimmed);
    if (result.success) return result;
  }

  return {
    success: true,
    lat: DEFAULT_HOME_BASE.lat,
    lon: DEFAULT_HOME_BASE.lon,
    fromCache: false,
    usedFallback: true,
  };
}

export type AddressSuggestResult =
  | { success: true; suggestions: AddressSuggestion[] }
  | { success: false; error: string };

/**
 * Get address suggestions from Nominatim (for autocomplete).
 * Not cached per-suggestion; selection will trigger geocode (which is cached).
 */
export async function getAddressSuggestions(query: string): Promise<AddressSuggestResult> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { success: true, suggestions: [] };
  }

  const params = new URLSearchParams({
    q: trimmed,
    format: 'json',
    limit: '5',
    addressdetails: '1',
  });

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!res.ok) {
      return { success: false, error: `Search failed: ${res.status}` };
    }

    const data = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;

    if (!Array.isArray(data)) {
      return { success: true, suggestions: [] };
    }

    const suggestions: AddressSuggestion[] = data
      .filter((item) => item?.lat && item?.lon)
      .map((item) => ({
        displayName: item.display_name ?? '',
        lat: parseFloat(item.lat!),
        lon: parseFloat(item.lon!),
      }))
      .filter((s) => s.lat != null && s.lon != null && !Number.isNaN(s.lat) && !Number.isNaN(s.lon));

    return { success: true, suggestions };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// --- Google Places & Geocoding API (optional, requires API key) ---

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Default bias: Copenhagen area (API allows max 50,000 m radius)
const DEFAULT_LOCATION_BIAS = {
  circle: {
    center: { latitude: 55.6761, longitude: 12.5683 },
    radius: 50_000, // 50 km max per API; biases results toward Copenhagen
  },
};

/**
 * Get address suggestions from Google Places Autocomplete (New).
 * Returns suggestions with placeId and displayName; use getCoordsForPlaceId when user selects.
 */
export async function getAddressSuggestionsGoogle(
  query: string,
  apiKey: string
): Promise<AddressSuggestResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { success: true, suggestions: [] };
  }

  try {
    const body = {
      input: trimmed,
      locationBias: DEFAULT_LOCATION_BIAS,
      regionCode: 'dk', // Prefer Denmark for formatting and relevance
    };

    const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const errText = await res.text();
    if (!res.ok) {
      const short = errText.slice(0, 200);
      if (res.status === 403) {
        return {
          success: false,
          error: `Access denied (403). Enable "Places API (New)" in Google Cloud and ensure billing is on. ${short}`,
        };
      }
      return { success: false, error: `Places API: ${res.status} ${short}` };
    }

    let data: { suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }> };
    try {
      data = JSON.parse(errText);
    } catch {
      return { success: false, error: 'Invalid response from Places API' };
    }

    const suggestions: AddressSuggestion[] = (data.suggestions ?? [])
      .map((s) => {
        const pred = s.placePrediction;
        if (!pred?.placeId) return null;
        return {
          displayName: pred.text?.text ?? '',
          placeId: pred.placeId,
        };
      })
      .filter((s): s is AddressSuggestion => s !== null && !!s.displayName)
      .slice(0, 5);

    return { success: true, suggestions };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Get latitude/longitude for a Google Place ID (Place Details with location field).
 */
export async function getCoordsForPlaceId(
  placeId: string,
  apiKey: string
): Promise<{ success: true; lat: number; lon: number } | { success: false; error: string }> {
  try {
    const url = `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'location',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Place Details: ${res.status} ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      location?: { latitude?: number; longitude?: number };
    };

    const lat = data.location?.latitude;
    const lon = data.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { success: false, error: 'Place has no location' };
    }

    return { success: true, lat, lon };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Geocode an address using Google Geocoding API.
 */
export async function geocodeAddressGoogle(
  address: string,
  apiKey: string
): Promise<GeocodeResult> {
  const trimmed = normalizeForGeocode(address);
  if (!trimmed) {
    return { success: false, error: 'Address is empty' };
  }

  const cached = await getCached(trimmed);
  if (cached) {
    return { success: true, lat: cached.lat, lon: cached.lon, fromCache: true };
  }

  try {
    const params = new URLSearchParams({ address: trimmed, key: apiKey });
    const res = await fetch(`${GEOCODE_URL}?${params.toString()}`);

    if (!res.ok) {
      return { success: false, error: `Geocoding failed: ${res.status}` };
    }

    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat?: number; lng?: number } };
        formatted_address?: string;
      }>;
    };

    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      return { success: false, error: data.status === 'ZERO_RESULTS' ? 'Address not found' : (data.status ?? 'Unknown error') };
    }

    const loc = data.results[0]?.geometry?.location;
    const lat = typeof loc?.lat === 'number' ? loc.lat : undefined;
    const lon = typeof loc?.lng === 'number' ? loc.lng : undefined;

    if (lat == null || lon == null) {
      return { success: false, error: 'Invalid geocode result' };
    }

    await setCached(trimmed, lat, lon);
    return {
      success: true,
      lat,
      lon,
      displayName: data.results[0]?.formatted_address,
      fromCache: false,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

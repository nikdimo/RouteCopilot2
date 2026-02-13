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
  lat: number;
  lon: number;
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
      .filter((s) => !Number.isNaN(s.lat) && !Number.isNaN(s.lon));

    return { success: true, suggestions };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

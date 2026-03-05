import { env } from "../config/env.js";

type NominatimResponse = Array<{
  lat: string;
  lon: string;
  display_name?: string;
  importance?: number;
  type?: string;
}>;

type NominatimSuggestResult = {
  displayName: string;
  lat: number;
  lon: number;
};

export type GeocodeProviderResult = {
  lat: number;
  lon: number;
  provider: "nominatim" | "google_geocoding";
  confidence?: number;
  raw: unknown;
};

type GoogleGeocodePayload = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: { lat?: number; lng?: number };
      location_type?: string;
    };
  }>;
};

type GooglePlacesAutocompletePayload = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
  error?: {
    message?: string;
  };
};

type GooglePlacesSuggestResult = {
  displayName: string;
  placeId?: string;
};

function getGoogleMapsApiKey() {
  return env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_GEOCODING_API_KEY;
}

export async function geocodeAddressViaNominatim(input: {
  address: string;
  countryCode?: string;
}) {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    q: input.address
  });

  if (input.countryCode) {
    params.set("countrycodes", input.countryCode.toLowerCase());
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.GEOCODE_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed (${response.status})`);
  }

  const payload = (await response.json()) as NominatimResponse;
  const first = payload[0];
  if (!first) {
    return null;
  }

  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat,
    lon,
    provider: "nominatim" as const,
    confidence: typeof first.importance === "number" ? first.importance : undefined,
    raw: first
  } satisfies GeocodeProviderResult;
}

export async function suggestAddressesViaNominatim(input: {
  query: string;
  countryCode?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({
    format: "json",
    addressdetails: "1",
    limit: String(input.limit ?? 8),
    q: input.query
  });

  if (input.countryCode) {
    params.set("countrycodes", input.countryCode.toLowerCase());
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.GEOCODE_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Nominatim suggest request failed (${response.status})`);
  }

  const payload = (await response.json()) as NominatimResponse;
  if (!Array.isArray(payload)) {
    return [];
  }

  const suggestions: NominatimSuggestResult[] = [];
  for (const row of payload) {
    if (!row?.display_name) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    suggestions.push({
      displayName: row.display_name,
      lat,
      lon
    });
  }

  return suggestions;
}

export async function geocodeAddressViaGoogle(input: {
  address: string;
  countryCode?: string;
}) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return null;
  }

  const params = new URLSearchParams({
    address: input.address,
    key: apiKey
  });
  if (input.countryCode) {
    params.set("components", `country:${input.countryCode.toLowerCase()}`);
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google geocode request failed (${response.status})`);
  }

  const payload = (await response.json()) as GoogleGeocodePayload;
  if (payload.status === "ZERO_RESULTS") {
    return null;
  }
  if (payload.status !== "OK") {
    throw new Error(
      `Google geocode response invalid (${payload.status ?? "unknown"}): ${
        payload.error_message ?? "no details"
      }`
    );
  }

  const first = payload.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lon = first?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lon !== "number") {
    return null;
  }

  return {
    lat,
    lon,
    provider: "google_geocoding" as const,
    raw: first,
    confidence:
      first?.geometry?.location_type === "ROOFTOP"
        ? 1
        : first?.geometry?.location_type === "RANGE_INTERPOLATED"
          ? 0.75
          : first?.geometry?.location_type === "GEOMETRIC_CENTER"
            ? 0.6
            : first?.geometry?.location_type === "APPROXIMATE"
              ? 0.45
              : undefined
  } satisfies GeocodeProviderResult;
}

export async function suggestAddressesViaGoogle(input: {
  query: string;
  countryCode?: string;
  limit?: number;
}) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return [];

  const body = {
    input: input.query,
    regionCode: input.countryCode?.toUpperCase() ?? "DK",
    locationBias: {
      circle: {
        center: { latitude: 55.6761, longitude: 12.5683 },
        radius: 50000
      }
    }
  };

  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as GooglePlacesAutocompletePayload;
  if (!response.ok) {
    const detail =
      payload?.error?.message?.slice(0, 200) ??
      `status ${response.status}`;
    throw new Error(`Google places suggest request failed (${detail})`);
  }

  const out: GooglePlacesSuggestResult[] = [];
  const seen = new Set<string>();
  const max = Math.max(1, Math.min(input.limit ?? 8, 12));

  for (const item of payload.suggestions ?? []) {
    const pred = item.placePrediction;
    const displayName = pred?.text?.text?.trim();
    if (!displayName) continue;
    const dedupeKey = displayName.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      displayName,
      ...(pred?.placeId ? { placeId: pred.placeId } : {})
    });
    if (out.length >= max) break;
  }

  return out;
}

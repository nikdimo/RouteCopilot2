import { env } from "../config/env.js";

type NominatimResponse = Array<{
  lat: string;
  lon: string;
  display_name?: string;
  importance?: number;
  type?: string;
}>;

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

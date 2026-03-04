import { env } from "../config/env.js";
import type { RouteLeg, Waypoint } from "../services/types.js";

type OsrmResponse = {
  code: string;
  waypoints?: Array<{
    location?: [number, number];
  }>;
  routes?: Array<{
    geometry: {
      coordinates?: [number, number][];
    };
    distance: number;
    duration: number;
    legs?: Array<{
      distance: number;
      duration: number;
    }>;
  }>;
};

export type RouteProviderResult = {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  legs: RouteLeg[];
};

type GoogleDirectionsPayload = {
  status?: string;
  error_message?: string;
  routes?: Array<{
    overview_polyline?: {
      points?: string;
    };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      duration_in_traffic?: { value?: number };
    }>;
  }>;
};

function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLon = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    coordinates.push([lon / 1e5, lat / 1e5]);
  }

  return coordinates;
}

function getGoogleMapsApiKey() {
  return env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_GEOCODING_API_KEY;
}

export function canUseGoogleTrafficProvider() {
  return Boolean(getGoogleMapsApiKey());
}

export async function fetchRouteViaOsrm(input: {
  profile: string;
  waypoints: Waypoint[];
}) {
  const coords = input.waypoints.map((point) => `${point.lon},${point.lat}`).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "false",
    annotations: "false"
  });
  const url = `${env.OSRM_BASE_URL}/route/v1/${encodeURIComponent(input.profile)}/${coords}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM request failed (${response.status})`);
  }

  const payload = (await response.json()) as OsrmResponse;
  if (payload.code !== "Ok" || !payload.routes || payload.routes.length === 0) {
    throw new Error(`OSRM response invalid (${payload.code})`);
  }

  const route = payload.routes[0];
  const coordinates = route.geometry?.coordinates ?? [];
  const legs = (route.legs ?? []).map((leg) => ({
    distanceM: Math.round(leg.distance),
    durationS: Math.round(leg.duration)
  }));

  return {
    coordinates,
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    legs
  } satisfies RouteProviderResult;
}

export async function fetchRouteViaGoogleTraffic(input: {
  waypoints: Waypoint[];
}) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return null;
  }
  if (input.waypoints.length < 2) {
    return null;
  }

  const origin = input.waypoints[0];
  const destination = input.waypoints[input.waypoints.length - 1];
  if (!origin || !destination) {
    return null;
  }

  const via = input.waypoints.slice(1, -1);
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lon}`,
    destination: `${destination.lat},${destination.lon}`,
    mode: "driving",
    alternatives: "false",
    departure_time: "now",
    traffic_model: "best_guess",
    key: apiKey
  });

  if (via.length > 0) {
    params.set(
      "waypoints",
      via.map((point) => `${point.lat},${point.lon}`).join("|")
    );
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Google Directions request failed (${response.status})`);
  }

  const payload = (await response.json()) as GoogleDirectionsPayload;
  if (payload.status === "ZERO_RESULTS") {
    return null;
  }
  if (payload.status !== "OK" || !payload.routes?.[0]) {
    throw new Error(
      `Google Directions response invalid (${payload.status ?? "unknown"}): ${
        payload.error_message ?? "no details"
      }`
    );
  }

  const route = payload.routes[0];
  const encoded = route.overview_polyline?.points;
  const coordinates = encoded ? decodePolyline(encoded) : [];
  const legs = (route.legs ?? []).map((leg) => ({
    distanceM: Math.round(leg.distance?.value ?? 0),
    durationS: Math.round(leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0)
  }));

  const distanceM = legs.reduce((sum, leg) => sum + leg.distanceM, 0);
  const durationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);

  return {
    coordinates,
    distanceM,
    durationS,
    legs
  } satisfies RouteProviderResult;
}

import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import {
  canUseGoogleTrafficProvider,
  fetchRouteViaGoogleTraffic,
  fetchRouteViaOsrm
} from "../providers/routeProvider.js";
import { buildRouteKeyHash } from "./cacheKeyService.js";
import type { Waypoint } from "./types.js";

type RouteCacheRow = {
  route_key_hash: string;
  profile: string;
  provider: string | null;
  traffic_aware: boolean | null;
  geometry: string;
  distance_m: number;
  duration_s: number;
  legs: unknown;
};

export type RouteResult = {
  source: "cache" | "live";
  routeKey: string;
  profile: string;
  provider: string;
  trafficAware: boolean;
  coordinates: Array<[number, number]>;
  distanceM: number;
  durationS: number;
  legs: unknown;
};

type ResolveRouteOptions = {
  useTrafficAwareRouting?: boolean;
};

type RouteMode = {
  cacheProfile: string;
  providerName: string;
  trafficAware: boolean;
};

function getRouteMode(input: {
  profile: string;
  useTrafficAwareRouting?: boolean;
}): RouteMode {
  if (
    input.useTrafficAwareRouting &&
    env.TRAFFIC_PROVIDER === "google" &&
    canUseGoogleTrafficProvider()
  ) {
    return {
      cacheProfile: `${input.profile}:traffic:google`,
      providerName: "google_directions",
      trafficAware: true
    };
  }

  return {
    cacheProfile: `${input.profile}:standard:osrm`,
    providerName: "osrm",
    trafficAware: false
  };
}

export async function resolveRoute(
  input: { profile: string; waypoints: Waypoint[] },
  options?: ResolveRouteOptions
) {
  const mode = getRouteMode({
    profile: input.profile,
    useTrafficAwareRouting: options?.useTrafficAwareRouting
  });
  const routeKey = buildRouteKeyHash(mode.cacheProfile, input.waypoints);

  const cached = await query<RouteCacheRow>(
    `SELECT route_key_hash, profile, provider, traffic_aware, geometry, distance_m, duration_s, legs
     FROM route_cache
     WHERE route_key_hash = $1
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [routeKey]
  );

  if ((cached.rowCount ?? 0) > 0) {
    await query(
      `UPDATE route_cache
       SET hit_count = hit_count + 1,
           last_hit_at = now()
       WHERE route_key_hash = $1`,
      [routeKey]
    );

    const row = cached.rows[0];
    let cachedCoordinates: Array<[number, number]> = [];
    try {
      const parsed = JSON.parse(row.geometry) as unknown;
      if (Array.isArray(parsed)) {
        cachedCoordinates = parsed as Array<[number, number]>;
      }
    } catch {
      cachedCoordinates = [];
    }
    return {
      source: "cache",
      routeKey: row.route_key_hash,
      profile: row.profile,
      provider: row.provider ?? "osrm",
      trafficAware: Boolean(row.traffic_aware),
      coordinates: cachedCoordinates,
      distanceM: row.distance_m,
      durationS: row.duration_s,
      legs: row.legs
    } satisfies RouteResult;
  }

  let route = null;
  let provider = mode.providerName;
  let trafficAware = mode.trafficAware;

  if (mode.providerName === "google_directions") {
    try {
      route = await fetchRouteViaGoogleTraffic({
        waypoints: input.waypoints
      });
    } catch (error) {
      console.warn("Google traffic route failed; falling back to OSRM:", error);
      route = null;
    }
  }

  if (!route) {
    route = await fetchRouteViaOsrm(input);
    provider = "osrm";
    trafficAware = false;
  }

  const legs = route.legs;

  await query(
    `INSERT INTO route_cache(
       route_key_hash, profile, provider, traffic_aware, waypoint_count, waypoints, geometry, distance_m, duration_s, legs, expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, now() + ($11::text || ' days')::interval
     )
     ON CONFLICT (route_key_hash)
     DO UPDATE SET
       profile = EXCLUDED.profile,
       provider = EXCLUDED.provider,
       traffic_aware = EXCLUDED.traffic_aware,
       waypoint_count = EXCLUDED.waypoint_count,
       waypoints = EXCLUDED.waypoints,
       geometry = EXCLUDED.geometry,
       distance_m = EXCLUDED.distance_m,
       duration_s = EXCLUDED.duration_s,
       legs = EXCLUDED.legs,
       hit_count = route_cache.hit_count + 1,
       last_hit_at = now(),
       expires_at = EXCLUDED.expires_at`,
    [
      routeKey,
      mode.cacheProfile,
      provider,
      trafficAware,
      input.waypoints.length,
      JSON.stringify(input.waypoints),
      JSON.stringify(route.coordinates),
      route.distanceM,
      route.durationS,
      JSON.stringify(legs),
      String(env.ROUTE_CACHE_TTL_DAYS)
    ]
  );

  return {
    source: "live",
    routeKey,
    profile: mode.cacheProfile,
    provider,
    trafficAware,
    coordinates: route.coordinates,
    distanceM: route.distanceM,
    durationS: route.durationS,
    legs
  } satisfies RouteResult;
}

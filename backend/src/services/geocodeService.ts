import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import {
  geocodeAddressViaGoogle,
  geocodeAddressViaNominatim
} from "../providers/geocodeProvider.js";
import { normalizeAddress } from "./cacheKeyService.js";

type GeocodeCacheRow = {
  query_normalized: string;
  lat: number;
  lon: number;
  provider: string;
};

export type GeocodeResult = {
  source: "cache" | "live";
  normalizedQuery: string;
  lat: number;
  lon: number;
  provider: string;
};

type ResolveGeocodeOptions = {
  useAdvancedGeocoding?: boolean;
};

export async function resolveGeocode(
  input: { address: string; countryCode?: string },
  options?: ResolveGeocodeOptions
) {
  const normalizedQuery = normalizeAddress(input.address);

  const cached = await query<GeocodeCacheRow>(
    `SELECT query_normalized, lat, lon, provider
     FROM geocode_cache
     WHERE query_normalized = $1
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [normalizedQuery]
  );

  if ((cached.rowCount ?? 0) > 0) {
    await query(
      `UPDATE geocode_cache
       SET hit_count = hit_count + 1,
           last_hit_at = now()
       WHERE query_normalized = $1`,
      [normalizedQuery]
    );

    const row = cached.rows[0];
    return {
      source: "cache",
      normalizedQuery: row.query_normalized,
      lat: row.lat,
      lon: row.lon,
      provider: row.provider
    } satisfies GeocodeResult;
  }

  let resolved = null;

  if (options?.useAdvancedGeocoding) {
    try {
      resolved = await geocodeAddressViaGoogle({
        address: input.address,
        countryCode: input.countryCode
      });
    } catch (error) {
      console.warn("Google geocode failed; falling back to Nominatim:", error);
    }
  }

  if (!resolved) {
    resolved = await geocodeAddressViaNominatim({
      address: input.address,
      countryCode: input.countryCode
    });
  }

  if (!resolved) {
    return null;
  }

  await query(
    `INSERT INTO geocode_cache(query_normalized, lat, lon, provider, confidence, raw, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() + ($7::text || ' days')::interval)
     ON CONFLICT (query_normalized)
     DO UPDATE SET
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       provider = EXCLUDED.provider,
       confidence = EXCLUDED.confidence,
       raw = EXCLUDED.raw,
       hit_count = geocode_cache.hit_count + 1,
       last_hit_at = now(),
       expires_at = EXCLUDED.expires_at`,
    [
      normalizedQuery,
      resolved.lat,
      resolved.lon,
      resolved.provider,
      resolved.confidence ?? null,
      JSON.stringify(resolved.raw),
      String(env.GEOCODE_CACHE_TTL_DAYS)
    ]
  );

  return {
    source: "live",
    normalizedQuery,
    lat: resolved.lat,
    lon: resolved.lon,
    provider: resolved.provider
  } satisfies GeocodeResult;
}

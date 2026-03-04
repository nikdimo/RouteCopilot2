import { createHash } from "node:crypto";
import type { Waypoint } from "./types.js";

export function normalizeAddress(address: string) {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildRouteKeyHash(profile: string, waypoints: Waypoint[]) {
  const payload = JSON.stringify({
    profile,
    waypoints: waypoints.map((point) => ({
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6))
    }))
  });
  return createHash("sha256").update(payload).digest("hex");
}

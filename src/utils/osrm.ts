/**
 * OSRM route API - driving directions following streets.
 * Uses public demo server: https://router.project-osrm.org
 * No API key required.
 */

const OSRM_BASE = 'https://router.project-osrm.org';

export type OSRMLeg = {
  distance: number; // meters
  duration: number; // seconds
  /** Point ON the route geometry for placing segment label (tail touches route) */
  labelPoint: { latitude: number; longitude: number };
  /** Coordinates for this leg's polyline segment */
  coordinates: Array<{ latitude: number; longitude: number }>;
};

export type OSRMRoute = {
  /** Full route coordinates for polyline */
  coordinates: Array<{ latitude: number; longitude: number }>;
  legs: OSRMLeg[];
  totalDistance: number;
  totalDuration: number;
};

function toCoordsString(points: Array<{ latitude: number; longitude: number }>): string {
  return points.map((p) => `${p.longitude},${p.latitude}`).join(';');
}

/**
 * Fetch driving route from OSRM. Returns geometry following streets + per-leg distance/duration.
 */
export async function fetchRoute(
  waypoints: Array<{ latitude: number; longitude: number }>
): Promise<OSRMRoute | null> {
  if (waypoints.length < 2) return null;

  const coords = toCoordsString(waypoints);
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) return null;

    const route = data.routes[0];
    const routeLegs = route.legs ?? [];
    const coordsList = route.geometry?.coordinates ?? [];
    const respWaypoints = data.waypoints ?? [];

    function dist(a: [number, number], b: [number, number]): number {
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }

    function findNearestIndex(target: [number, number]): number {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < coordsList.length; i++) {
        const d = dist(coordsList[i], target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    const waypointIndices: number[] = [];
    for (let i = 0; i < respWaypoints.length; i++) {
      const loc = respWaypoints[i]?.location;
      if (Array.isArray(loc) && loc.length >= 2) {
        waypointIndices.push(findNearestIndex([loc[0], loc[1]]));
      } else {
        waypointIndices.push(i === 0 ? 0 : coordsList.length - 1);
      }
    }
    if (waypointIndices.length < 2) {
      waypointIndices.length = 0;
      for (let i = 0; i < waypoints.length; i++) {
        const w = waypoints[i]!;
        waypointIndices.push(findNearestIndex([w.longitude, w.latitude]));
      }
    }

    const legs: OSRMLeg[] = [];
    const LABEL_OVERLAP_THRESHOLD = 0.002;
    const WAYPOINT_AVOID_THRESHOLD = 0.0015;
    const labelPositions: Array<{ lat: number; lon: number }> = [];

    for (let i = 0; i < routeLegs.length; i++) {
      const leg = routeLegs[i];
      let startIdx = waypointIndices[i] ?? 0;
      let endIdx = waypointIndices[i + 1] ?? coordsList.length - 1;
      if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
      const segLen = Math.max(1, endIdx - startIdx);

      const legCoords = coordsList
        .slice(startIdx, endIdx + 1)
        .map(([lon, lat]: [number, number]) => ({ latitude: lat, longitude: lon }));

      const waypointCoords = [
        [waypoints[i]?.longitude ?? 0, waypoints[i]?.latitude ?? 0],
        [waypoints[i + 1]?.longitude ?? 0, waypoints[i + 1]?.latitude ?? 0],
      ];

      let t = 0.75;
      let midIdx = startIdx + Math.floor(segLen * t);
      let [midLon, midLat] = coordsList[Math.min(midIdx, coordsList.length - 1)] ?? coordsList[0];
      let labelPoint = { latitude: midLat, longitude: midLon };

      const nearWaypoint = waypointCoords.some(
        ([wLon, wLat]) =>
          Math.abs(wLat - labelPoint.latitude) < WAYPOINT_AVOID_THRESHOLD &&
          Math.abs(wLon - labelPoint.longitude) < WAYPOINT_AVOID_THRESHOLD
      );
      if (nearWaypoint && segLen > 4) {
        t = 0.85;
        midIdx = startIdx + Math.floor(segLen * t);
        [midLon, midLat] = coordsList[Math.min(midIdx, coordsList.length - 1)] ?? coordsList[0];
        labelPoint = { latitude: midLat, longitude: midLon };
      }

      const tooClose = labelPositions.some(
        (p) =>
          Math.abs(p.lat - labelPoint.latitude) < LABEL_OVERLAP_THRESHOLD &&
          Math.abs(p.lon - labelPoint.longitude) < LABEL_OVERLAP_THRESHOLD
      );
      if (tooClose && segLen > 2) {
        t = labelPositions.length % 2 === 0 ? 0.25 : 0.75;
        midIdx = startIdx + Math.floor(segLen * t);
        [midLon, midLat] = coordsList[Math.min(midIdx, coordsList.length - 1)] ?? coordsList[0];
        labelPoint = { latitude: midLat, longitude: midLon };
      }
      labelPositions.push(labelPoint);

      legs.push({
        distance: leg.distance ?? 0,
        duration: leg.duration ?? 0,
        labelPoint,
        coordinates: legCoords,
      });
    }

    if (legs.length === 0 && coordsList.length >= 2) {
      const mid = Math.floor(coordsList.length / 2);
      const [lon, lat] = coordsList[mid];
      legs.push({
        distance: route.distance ?? 0,
        duration: route.duration ?? 0,
        labelPoint: { latitude: lat, longitude: lon },
        coordinates: coordsList.map(([lon2, lat2]: [number, number]) => ({
          latitude: lat2,
          longitude: lon2,
        })),
      });
    }

    const coordinates = coordsList.map(([lon, lat]: [number, number]) => ({
      latitude: lat,
      longitude: lon,
    }));

    return {
      coordinates,
      legs,
      totalDistance: route.distance ?? 0,
      totalDuration: route.duration ?? 0,
    };
  } catch {
    return null;
  }
}

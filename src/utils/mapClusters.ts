/**
 * Map waypoints: co-located points are not merged; each gets its own marker
 * with a small offset so they sit next to each other and are easily tappable.
 */

export function coordKey(c: { latitude: number; longitude: number }): string {
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

export type MapCluster = {
  coordKey: string;
  /** Indices into the original coords array */
  indices: number[];
  coordinate: { latitude: number; longitude: number };
};

/**
 * Groups coordinates by rounded key (5 decimals ~ same location).
 * Returns one cluster per unique location, with indices of all appointments at that location.
 */
export function getClusters(
  coords: Array<{ latitude: number; longitude: number }>
): MapCluster[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < coords.length; i++) {
    const k = coordKey(coords[i]!);
    const list = byKey.get(k) ?? [];
    list.push(i);
    byKey.set(k, list);
  }
  return Array.from(byKey.entries()).map(([coordKey, indices]) => ({
    coordKey,
    indices,
    coordinate: coords[indices[0]!]!,
  }));
}

/** Marker circle diameter in px – circumferences touch when center-to-center = this. */
export const MARKER_DIAMETER_PX = 28;

export type MarkerPosition = {
  index: number;
  coordinate: { latitude: number; longitude: number };
  /** When offset (cluster): the actual location; use for dashed connector line */
  realCoordinate?: { latitude: number; longitude: number };
  clusterKey?: string;
  isCluster?: boolean;
};

export type GetMarkerPositionsOptions = {
  focusedClusterKey?: string | null;
  /** Pixel gap for the focused cluster (default 64). */
  focusedPixelGap?: number;
};

/**
 * Longitude offset in degrees so that two markers are `pixelGap` pixels apart
 * at the given zoom and latitude (Web Mercator). Use the cluster's latitude so
 * spacing is correct at any zoom.
 */
export function getMarkerOffsetDegrees(
  zoom: number,
  lat: number,
  pixelGap: number = MARKER_DIAMETER_PX
): number {
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(0.01, Math.cos(latRad));
  const pxPerDegLon = (256 * Math.pow(2, zoom)) / 360 * cosLat;
  return pixelGap / pxPerDegLon;
}

/**
 * Longitude offset in degrees for native maps: so that two markers are `pixelGap`
 * pixels apart at the cluster's latitude. Uses region.longitudeDelta and screen width.
 */
export function getMarkerOffsetDegreesFromRegion(
  longitudeDelta: number,
  screenWidth: number,
  lat: number,
  pixelGap: number = MARKER_DIAMETER_PX
): number {
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(0.01, Math.cos(latRad));
  const degPerPx = longitudeDelta / screenWidth / cosLat;
  return pixelGap * degPerPx;
}

/**
 * Returns one marker position per waypoint. Offset is computed per cluster using
 * the cluster's latitude and current zoom/region so circumferences always touch (28px)
 * at any zoom level.
 * @param coords - waypoint coordinates
 * @param zoom - current map zoom (web). Not used when regionParams is provided.
 * @param options - focusedClusterKey, focusedPixelGap for tap-to-spread
 * @param regionParams - for native: { longitudeDelta, screenWidth } to compute offset per cluster
 */
export function getMarkerPositions(
  coords: Array<{ latitude: number; longitude: number }>,
  zoom: number,
  options: GetMarkerPositionsOptions = {},
  regionParams?: { longitudeDelta: number; screenWidth: number }
): MarkerPosition[] {
  const { focusedClusterKey, focusedPixelGap = 64 } = options;
  const clusters = getClusters(coords);
  const result: MarkerPosition[] = [];
  for (const cluster of clusters) {
    const { coordKey, indices, coordinate } = cluster;
    const clusterLat = coordinate.latitude;
    const isFocused = indices.length > 1 && focusedClusterKey === coordKey;
    const pixelGap = isFocused ? focusedPixelGap : MARKER_DIAMETER_PX;
    const deg = regionParams
      ? getMarkerOffsetDegreesFromRegion(
          regionParams.longitudeDelta,
          regionParams.screenWidth,
          clusterLat,
          pixelGap
        )
      : getMarkerOffsetDegrees(zoom, clusterLat, pixelGap);
    if (indices.length === 1) {
      result.push({ index: indices[0]!, coordinate });
      continue;
    }
    const n = indices.length;
    const startLon = coordinate.longitude - ((n - 1) / 2) * deg;
    for (let i = 0; i < n; i++) {
      result.push({
        index: indices[i]!,
        coordinate: {
          latitude: coordinate.latitude,
          longitude: startLon + i * deg,
        },
        realCoordinate: coordinate,
        clusterKey: coordKey,
        isCluster: true,
      });
    }
  }
  return result.sort((a, b) => a.index - b.index);
}

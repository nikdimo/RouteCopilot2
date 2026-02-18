/**
 * Shared route bubble logic for mobile (MapScreen) and web (MapScreen.web).
 * Midpoint-by-distance, corner selection, bubble path.
 */

export type LatLng = { latitude: number; longitude: number };

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Midpoint M and forward point F by cumulative Haversine distance along polyline. */
export function midpointAndForward(coords: LatLng[]): { M: LatLng; F: LatLng } | null {
  return pointAlongSegmentAndForward(coords, 0.5);
}

/** Point at fraction of total distance (0 = start, 1 = end) and forward direction. */
export function pointAlongSegmentAndForward(
  coords: LatLng[],
  fraction: number
): { M: LatLng; F: LatLng } | null {
  if (coords.length < 2) return null;
  const cumDist: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist[i] = cumDist[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!);
  }
  const L = cumDist[cumDist.length - 1]!;
  if (L <= 0) return null;
  const target = L * Math.max(0, Math.min(1, fraction));
  let k = 0;
  while (k < cumDist.length - 1 && cumDist[k + 1]! <= target) k++;
  const segLen = cumDist[k + 1]! - cumDist[k]!;
  const t = segLen > 0 ? (target - cumDist[k]!) / segLen : 0;
  const a = coords[k]!;
  const b = coords[Math.min(k + 1, coords.length - 1)]!;
  const M: LatLng = {
    latitude: a.latitude + t * (b.latitude - a.latitude),
    longitude: a.longitude + t * (b.longitude - a.longitude),
  };
  const t2 = Math.min(t + 0.05, 1);
  const F: LatLng = {
    latitude: a.latitude + t2 * (b.latitude - a.latitude),
    longitude: a.longitude + t2 * (b.longitude - a.longitude),
  };
  return { M, F };
}

/** Offset a polyline perpendicular to its overall direction so overlapping routes stay visible. */
export function offsetPolyline(
  coords: LatLng[],
  offsetDegrees: number,
  sign: 1 | -1
): LatLng[] {
  if (coords.length < 2 || offsetDegrees <= 0) return coords;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const dx = last.longitude - first.longitude;
  const dy = last.latitude - first.latitude;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpLat = (-dx / len) * offsetDegrees * sign;
  const perpLon = (dy / len) * offsetDegrees * sign;
  return coords.map((c) => ({
    latitude: c.latitude + perpLat,
    longitude: c.longitude + perpLon,
  }));
}

export type TipCorner = 'TL' | 'TR' | 'BL' | 'BR';

export const SEGMENT_BUBBLE_W = 80;
export const SEGMENT_BUBBLE_H = 40;
export const SEGMENT_BUBBLE_R = 8;

/** Pick tip corner from screen-space right vector. Body extends to right of path. */
export function pickTipCornerSimple(
  rightScreen: { x: number; y: number },
  W: number,
  H: number
): TipCorner {
  const corners: TipCorner[] = ['TL', 'TR', 'BL', 'BR'];
  const centerToCorner: Record<TipCorner, { x: number; y: number }> = {
    TL: { x: -W / 2, y: -H / 2 },
    TR: { x: W / 2, y: -H / 2 },
    BL: { x: -W / 2, y: H / 2 },
    BR: { x: W / 2, y: H / 2 },
  };
  let best: TipCorner = 'BR';
  let bestDot = Infinity;
  for (const c of corners) {
    const v = centerToCorner[c]!;
    const dot = v.x * rightScreen.x + v.y * rightScreen.y;
    if (dot < bestDot) {
      bestDot = dot;
      best = c;
    }
  }
  return best;
}

/** SVG path d for rounded rect with one sharp corner. tipCorner = pointer tip. */
export function segmentBubblePath(tipCorner: TipCorner): string {
  const w = SEGMENT_BUBBLE_W;
  const h = SEGMENT_BUBBLE_H;
  const r = SEGMENT_BUBBLE_R;
  const isSharp = (c: TipCorner) => c === tipCorner;
  const arc = (cx: number, cy: number, startDeg: number, sweepDeg: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const x2 = cx + r * Math.cos(rad(startDeg + sweepDeg));
    const y2 = cy + r * Math.sin(rad(startDeg + sweepDeg));
    const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
    return `A ${r} ${r} 0 ${large} ${sweepDeg > 0 ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  let d = `M ${r} 0`;
  d += ` L ${w - r} 0`;
  if (isSharp('TR')) d += ` L ${w} 0 L ${w} ${r} L ${w} ${h - r}`;
  else d += ` ${arc(w - r, r, -90, 90)} L ${w} ${h - r}`;
  if (isSharp('BR')) d += ` L ${w} ${h} L ${w - r} ${h}`;
  else d += ` ${arc(w - r, h - r, 0, 90)} L ${r} ${h}`;
  if (isSharp('BL')) d += ` L 0 ${h} L 0 ${h - r}`;
  else d += ` ${arc(r, h - r, 90, 90)} L 0 ${r}`;
  if (isSharp('TL')) d += ` L 0 0 L ${r} 0`;
  else d += ` ${arc(r, r, 180, 90)}`;
  d += ' Z';
  return d;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

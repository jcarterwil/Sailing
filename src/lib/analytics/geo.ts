import { DEG, norm180, norm360 } from "@/lib/analytics/angles";

const EARTH_RADIUS_M = 6371008.8;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG);
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
  return norm360(Math.atan2(y, x) / DEG);
}

// Equirectangular local frame in meters; sub-decimeter error below ~10 km.
export function toLocalXY(
  originLat: number,
  originLon: number,
  lat: number,
  lon: number,
): { x: number; y: number } {
  return {
    x: norm180(lon - originLon) * Math.cos(originLat * DEG) * EARTH_RADIUS_M * DEG,
    y: (lat - originLat) * EARTH_RADIUS_M * DEG,
  };
}

/** Inverse of `toLocalXY`, with longitude wrapped across the antimeridian. */
export function fromLocalXY(
  originLat: number,
  originLon: number,
  x: number,
  y: number,
): { lat: number; lon: number } {
  const longitudeScale = Math.cos(originLat * DEG) * EARTH_RADIUS_M * DEG;
  return {
    lat: originLat + y / (EARTH_RADIUS_M * DEG),
    lon: Math.abs(longitudeScale) < 1e-12 ? norm180(originLon) : norm180(originLon + x / longitudeScale),
  };
}

/** Point-to-segment distance in meters using the local equirectangular frame. */
export function distanceToSegmentM(
  lat: number,
  lon: number,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const originLat = (a.lat + b.lat) / 2;
  const originLon = (a.lon + b.lon) / 2;
  const p = toLocalXY(originLat, originLon, lat, lon);
  const pa = toLocalXY(originLat, originLon, a.lat, a.lon);
  const pb = toLocalXY(originLat, originLon, b.lat, b.lon);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    const ex = p.x - pa.x;
    const ey = p.y - pa.y;
    return Math.hypot(ex, ey);
  }
  let t = ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = pa.x + t * dx;
  const qy = pa.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}

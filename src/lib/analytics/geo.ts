import { DEG, norm360 } from "@/lib/analytics/angles";

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
    x: (lon - originLon) * Math.cos(originLat * DEG) * EARTH_RADIUS_M * DEG,
    y: (lat - originLat) * EARTH_RADIUS_M * DEG,
  };
}

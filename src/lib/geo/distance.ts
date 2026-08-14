import type { LatLng } from "@/types/domain";

/** Haversine distance in metres. Used for the "nearby" geofence — PostGIS not needed in v1. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Implied speed in km/h between two samples. Used to reject spoofed/GPS-drift jumps. */
export function impliedSpeedKmh(
  a: LatLng & { captured_at: string },
  b: LatLng & { captured_at: string },
): number {
  const dtHours =
    Math.abs(new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()) /
    3_600_000;
  if (dtHours === 0) return Number.POSITIVE_INFINITY;
  return distanceMeters(a, b) / 1000 / dtHours;
}

import { distanceMeters } from "@/lib/geo/distance";
import type { LatLng } from "@/types/domain";

/**
 * Live ETA for the customer tracking page.
 *
 * Routing comes from OSRM (OSM family — see PROGRESS.md decisions log
 * 2026-08-15: tiles are OpenFreeMap/OSM, so routing/ETA must be OSM-family
 * too, never mixed with Google). Default is the public demo server, fine at
 * pilot volume; OSRM_URL env overrides for a hosted instance.
 *
 * OSRM being down must never break the page: fall back to straight-line
 * distance at a conservative Lagos-traffic speed. The ETA is labelled an
 * estimate in the UI either way.
 */

const FALLBACK_SPEED_KMH = 22;
const OSRM_TIMEOUT_MS = 3_000;

export async function estimateEtaMinutes(from: LatLng, to: LatLng): Promise<number> {
  const base = process.env.OSRM_URL ?? "https://router.project-osrm.org";
  try {
    const res = await fetch(
      `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
      { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) },
    );
    if (res.ok) {
      const body = (await res.json()) as { routes?: { duration?: number }[] };
      const seconds = body.routes?.[0]?.duration;
      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        return Math.max(1, Math.round(seconds / 60));
      }
    }
  } catch {
    // fall through to haversine
  }
  const km = distanceMeters(from, to) / 1000;
  return Math.max(1, Math.round((km / FALLBACK_SPEED_KMH) * 60));
}

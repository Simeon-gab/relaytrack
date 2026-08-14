import { distanceMeters } from "@/lib/geo/distance";
import type { LatLng } from "@/types/domain";
import type { Enums } from "@/types/database";

/**
 * Exception detection for the dispatch live map (SPEC section 5, Phase 4):
 * offline > 5 min, stalled > 10 min, off-route heuristic.
 *
 * Pure functions over an observed track so the fire/clear behaviour is
 * unit-testable. Derived state, not stored state: each tick recomputes from
 * the track, so an exception clears the moment its condition stops holding.
 */

export const EXCEPTION_LIMITS = {
  /** No ping for this long while on delivery -> offline. */
  offlineAfterMs: 5 * 60_000,
  /** Position stays inside stalledRadiusMeters for this long -> stalled. */
  stalledAfterMs: 10 * 60_000,
  stalledRadiusMeters: 50,
  /**
   * Off-route: rider is now this much farther from the dropoff than their
   * closest approach so far. Progress toward the drop should be monotonic-ish;
   * losing 500m of it means they are heading the wrong way.
   */
  offRouteSlackMeters: 500,
} as const;

export type ExceptionType = "offline" | "stalled" | "off_route";

export interface TrackSample extends LatLng {
  /** ISO timestamp (server received_at / last_position.at). */
  at: string;
}

export interface RiderTrack {
  riderId: string;
  riderName: string;
  status: Enums<"rider_status">;
  /** Ascending by `at`. Callers prune to the observation window. */
  samples: TrackSample[];
  /** Dropoff of the active delivery, when the order has coordinates. */
  dropoff: LatLng | null;
}

export interface RiderException {
  riderId: string;
  riderName: string;
  type: ExceptionType;
  /** Human-readable detail for the alert stack. */
  detail: string;
}

/** Keep only samples inside the retention window (plus always the newest). */
export function pruneTrack(samples: TrackSample[], nowMs: number, windowMs: number): TrackSample[] {
  const cutoff = nowMs - windowMs;
  const kept = samples.filter((s) => Date.parse(s.at) >= cutoff);
  const newest = samples[samples.length - 1];
  if (kept.length === 0 && newest) return [newest];
  return kept;
}

function minutesAgo(iso: string, nowMs: number): number {
  return Math.max(1, Math.round((nowMs - Date.parse(iso)) / 60_000));
}

/**
 * Derive the active exceptions for one rider. Only riders on an active
 * delivery are judged — an offline "available" rider is normal, not an alert.
 */
export function deriveExceptions(track: RiderTrack, nowMs: number): RiderException[] {
  if (track.status !== "on_delivery") return [];

  const latest = track.samples[track.samples.length - 1];
  const base = { riderId: track.riderId, riderName: track.riderName };

  // Offline: pings stopped. Supersedes stalled/off-route — with no fresh data
  // the other two would be judging a ghost.
  if (!latest || nowMs - Date.parse(latest.at) > EXCEPTION_LIMITS.offlineAfterMs) {
    return [
      {
        ...base,
        type: "offline",
        detail: latest
          ? `No signal for ${minutesAgo(latest.at, nowMs)} min`
          : "No signal since delivery started",
      },
    ];
  }

  const exceptions: RiderException[] = [];

  // Stalled: enough observation to cover the window, and every sample in the
  // window sits within the stall radius of the newest position.
  const windowStart = nowMs - EXCEPTION_LIMITS.stalledAfterMs;
  const windowSamples = track.samples.filter((s) => Date.parse(s.at) >= windowStart);
  const first = windowSamples[0];
  const coversWindow =
    first !== undefined &&
    // 90% tolerance: pings arrive every ~10s, the first one rarely lands
    // exactly on the window edge.
    nowMs - Date.parse(first.at) >= EXCEPTION_LIMITS.stalledAfterMs * 0.9;
  if (
    coversWindow &&
    windowSamples.every((s) => distanceMeters(s, latest) <= EXCEPTION_LIMITS.stalledRadiusMeters)
  ) {
    exceptions.push({
      ...base,
      type: "stalled",
      detail: `Not moving for ${Math.round(EXCEPTION_LIMITS.stalledAfterMs / 60_000)}+ min`,
    });
  }

  // Off-route: farther from the dropoff than the closest approach by more
  // than the slack. Clears as soon as the rider closes the gap again.
  if (track.dropoff) {
    const dropoff = track.dropoff;
    const closest = Math.min(...track.samples.map((s) => distanceMeters(s, dropoff)));
    const current = distanceMeters(latest, dropoff);
    if (current - closest > EXCEPTION_LIMITS.offRouteSlackMeters) {
      exceptions.push({
        ...base,
        type: "off_route",
        detail: `${Math.round((current - closest) / 100) / 10} km past closest approach`,
      });
    }
  }

  return exceptions;
}

import { describe, expect, it } from "vitest";
import {
  deriveExceptions,
  pruneTrack,
  EXCEPTION_LIMITS,
  type RiderTrack,
  type TrackSample,
} from "@/lib/geo/exceptions";

// Phase 4 acceptance: exceptions fire AND clear correctly. Each case below
// asserts both sides of the transition.

const NOW = Date.parse("2026-08-14T12:00:00Z");
const BASE = { lat: 6.4281, lng: 3.4219 }; // Victoria Island, Lagos

/** ~1 deg latitude = 111.32 km. Offset a point north by `meters`. */
function north(meters: number): { lat: number; lng: number } {
  return { lat: BASE.lat + meters / 111_320, lng: BASE.lng };
}

function sample(minAgo: number, pos = BASE): TrackSample {
  return { ...pos, at: new Date(NOW - minAgo * 60_000).toISOString() };
}

function track(overrides: Partial<RiderTrack>): RiderTrack {
  return {
    riderId: "r1",
    riderName: "Tunde",
    status: "on_delivery",
    samples: [],
    dropoff: null,
    ...overrides,
  };
}

/** Samples every 30s from `fromMinAgo` to now, mapped to a position. */
function trail(fromMinAgo: number, at: (minAgo: number) => { lat: number; lng: number }): TrackSample[] {
  const samples: TrackSample[] = [];
  for (let m = fromMinAgo; m >= 0; m -= 0.5) samples.push(sample(m, at(m)));
  return samples;
}

describe("offline", () => {
  it("fires when pings stop for more than 5 min on an active delivery", () => {
    const t = track({ samples: [sample(6)] });
    expect(deriveExceptions(t, NOW)).toEqual([
      expect.objectContaining({ type: "offline", riderId: "r1" }),
    ]);
  });

  it("fires when a delivery has produced no pings at all", () => {
    expect(deriveExceptions(track({}), NOW)[0]?.type).toBe("offline");
  });

  it("clears when a fresh ping arrives", () => {
    const t = track({ samples: [sample(6), sample(0.5)] });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });

  it("never fires for riders not on a delivery", () => {
    expect(deriveExceptions(track({ status: "available" }), NOW)).toEqual([]);
    expect(deriveExceptions(track({ status: "offline" }), NOW)).toEqual([]);
  });

  it("supersedes stalled and off-route (stale data judges nothing)", () => {
    const t = track({ samples: trail(20, () => BASE).filter((s) => Date.parse(s.at) < NOW - 6 * 60_000), dropoff: north(5000) });
    const types = deriveExceptions(t, NOW).map((e) => e.type);
    expect(types).toEqual(["offline"]);
  });
});

describe("stalled", () => {
  it("fires after 10 min inside the 50m radius", () => {
    const t = track({ samples: trail(11, () => BASE) });
    expect(deriveExceptions(t, NOW).map((e) => e.type)).toEqual(["stalled"]);
  });

  it("does not fire without enough observation to cover the window", () => {
    // Only 3 minutes of data — rider might have been moving before we looked.
    const t = track({ samples: trail(3, () => BASE) });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });

  it("clears once the rider moves outside the radius", () => {
    // Parked for 11 min, then drove 200m north in the last minute.
    const t = track({
      samples: trail(11, (minAgo) => (minAgo <= 1 ? north(200) : BASE)),
    });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });

  it("ignores GPS jitter inside the radius", () => {
    const t = track({ samples: trail(11, (minAgo) => north((minAgo * 7) % 40)) });
    expect(deriveExceptions(t, NOW).map((e) => e.type)).toEqual(["stalled"]);
  });
});

describe("off-route", () => {
  const dropoff = BASE; // rider approaches, then retreats

  it("fires when the rider retreats >500m past their closest approach", () => {
    // Came within 300m of the drop, now 1000m away: 700m of lost progress.
    const t = track({
      dropoff,
      samples: [sample(5, north(2000)), sample(3, north(300)), sample(0.5, north(1000))],
    });
    expect(deriveExceptions(t, NOW).map((e) => e.type)).toEqual(["off_route"]);
  });

  it("does not fire while progress is merely slow or wiggly", () => {
    // 400m of retreat is inside the slack (detours, one-way streets).
    const t = track({
      dropoff,
      samples: [sample(5, north(2000)), sample(3, north(300)), sample(0.5, north(700))],
    });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });

  it("clears when the rider closes back within the slack", () => {
    const t = track({
      dropoff,
      samples: [sample(5, north(300)), sample(3, north(1000)), sample(0.5, north(600))],
    });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });

  it("is skipped when the order has no coordinates", () => {
    const t = track({
      dropoff: null,
      samples: [sample(3, north(300)), sample(0.5, north(5000))],
    });
    expect(deriveExceptions(t, NOW)).toEqual([]);
  });
});

describe("pruneTrack", () => {
  it("drops samples outside the window but always keeps the newest", () => {
    const samples = [sample(30), sample(20), sample(16)];
    const pruned = pruneTrack(samples, NOW, 15 * 60_000);
    expect(pruned).toEqual([sample(16)]);
  });

  it("keeps everything inside the window", () => {
    const samples = [sample(20), sample(10), sample(1)];
    expect(pruneTrack(samples, NOW, 15 * 60_000)).toEqual([sample(10), sample(1)]);
  });
});

describe("limits", () => {
  it("match the spec: offline 5 min, stalled 10 min", () => {
    expect(EXCEPTION_LIMITS.offlineAfterMs).toBe(5 * 60_000);
    expect(EXCEPTION_LIMITS.stalledAfterMs).toBe(10 * 60_000);
  });
});

import { NextResponse } from "next/server";

/**
 * Rider location ingest. SPEC.md section 2 (Location pipeline).
 *
 * HARD REQUIREMENTS — do not ship without all of these (Phase 3):
 *  - Auth: per-rider signed JWT (RIDER_JWT_SECRET). Reject unsigned/invalid with 401.
 *  - Reject stale batches: device clock skew > 10 min.
 *  - Reject impossible jumps: implied speed > 150 km/h.
 *  - Discard points with accuracy > 100m.
 *  - Batch insert into rider_locations, upsert riders.last_position.
 *  - Geofence: if distance(rider, dropoff) < 500m and status = in_transit,
 *    fire order.nearby once (guarded by deliveries.nearby_fired_at).
 *  - Rate limit per rider.
 *
 * There is no anonymous path into this handler. Ever.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Not implemented (Phase 3)" }, { status: 501 });
}

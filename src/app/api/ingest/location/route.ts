import { verifyRiderToken } from "@/lib/rider/jwt";
import { createAdminClient } from "@/lib/supabase/admin";
import { locationBatchSchema, INGEST_LIMITS } from "@/lib/validation/schemas";
import { distanceMeters, impliedSpeedKmh } from "@/lib/geo/distance";
import type { LocationPoint } from "@/types/domain";

/**
 * Rider location ingest. SPEC.md section 2 (Location pipeline).
 *
 * Auth: per-rider signed JWT (RIDER_JWT_SECRET). There is no anonymous path
 * into this handler — unsigned/invalid requests get 401 before anything else.
 * The service-role client is used ONLY after the JWT is verified and the
 * rider row is confirmed active + org-matched (SPEC section 3, RLS summary).
 *
 * Point-level guardrails (spec: reject spoofing/drift, keep offline sync):
 *  - accuracy > 100 m           -> discarded
 *  - captured_at in the future beyond 10 min (device clock skew) -> discarded
 *  - implied speed > 150 km/h vs previous point / last known position -> discarded
 * Old captured_at values are ACCEPTED on purpose: the offline buffer replays
 * them after reconnect (airplane-mode test), and received_at (server clock)
 * is the authoritative timestamp.
 *
 * Geofence "nearby" firing lands here in Phase 5. Formal rate limiting is
 * Phase 8; the batch cap (50 points) bounds each request until then.
 */
export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Missing rider token" }, { status: 401 });
  }
  const claims = await verifyRiderToken(authHeader.slice("Bearer ".length));
  if (!claims) {
    return Response.json({ error: "Invalid rider token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = locationBatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid batch" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: rider } = await admin
    .from("riders")
    .select("id,org_id,active,last_position")
    .eq("id", claims.riderId)
    .maybeSingle();
  if (!rider || !rider.active || rider.org_id !== claims.orgId) {
    return Response.json({ error: "Unknown rider" }, { status: 401 });
  }

  // delivery_id is only trusted if that delivery actually belongs to this rider.
  // The joined order fields feed the geofence check below.
  let deliveryId: string | null = null;
  let geofence: { orderStatus: string; dropoff: { lat: number; lng: number } } | null = null;
  if (parsed.data.delivery_id) {
    const { data: delivery } = await admin
      .from("deliveries")
      .select("id,nearby_fired_at,orders!inner(status,dropoff_lat,dropoff_lng)")
      .eq("id", parsed.data.delivery_id)
      .eq("rider_id", rider.id)
      .maybeSingle();
    deliveryId = delivery?.id ?? null;
    if (
      delivery &&
      delivery.nearby_fired_at === null &&
      delivery.orders.dropoff_lat !== null &&
      delivery.orders.dropoff_lng !== null
    ) {
      geofence = {
        orderStatus: delivery.orders.status,
        dropoff: { lat: delivery.orders.dropoff_lat, lng: delivery.orders.dropoff_lng },
      };
    }
  }

  const now = Date.now();
  const lastPosition = rider.last_position as
    | { lat: number; lng: number; at: string }
    | null;

  const sorted = [...parsed.data.points].sort(
    (a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at),
  );

  const accepted: LocationPoint[] = [];
  let previous: (LocationPoint & { captured_at: string }) | null =
    lastPosition
      ? {
          lat: lastPosition.lat,
          lng: lastPosition.lng,
          accuracy: 0,
          speed: null,
          heading: null,
          captured_at: lastPosition.at,
        }
      : null;

  for (const point of sorted) {
    const capturedMs = Date.parse(point.captured_at);
    if (Number.isNaN(capturedMs)) continue;
    if (point.accuracy > INGEST_LIMITS.maxAccuracyMeters) continue;
    if (capturedMs > now + INGEST_LIMITS.maxClockSkewMs) continue;
    if (previous && impliedSpeedKmh(previous, point) > INGEST_LIMITS.maxImpliedSpeedKmh) {
      continue;
    }
    accepted.push(point);
    previous = point;
  }

  if (accepted.length > 0) {
    const { error: insertError } = await admin.from("rider_locations").insert(
      accepted.map((p) => ({
        org_id: rider.org_id,
        rider_id: rider.id,
        delivery_id: deliveryId,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        captured_at: p.captured_at,
      })),
    );
    if (insertError) {
      return Response.json({ error: "Storage failure" }, { status: 500 });
    }

    const newest = accepted[accepted.length - 1];
    if (newest) {
      await admin
        .from("riders")
        .update({
          last_position: {
            lat: newest.lat,
            lng: newest.lng,
            accuracy: newest.accuracy,
            at: newest.captured_at,
          },
        })
        .eq("id", rider.id);

      // Geofence "nearby" (SPEC section 2): <500m from dropoff while
      // in_transit. fire_nearby's null-guard makes it fire exactly once even
      // if concurrent batches race; the delivery_events trigger then queues
      // the customer notification.
      if (
        deliveryId &&
        geofence &&
        geofence.orderStatus === "in_transit" &&
        distanceMeters(newest, geofence.dropoff) < INGEST_LIMITS.nearbyRadiusMeters
      ) {
        await admin.rpc("fire_nearby", { p_delivery: deliveryId });
      }
    }
  }

  return Response.json({
    accepted: accepted.length,
    discarded: parsed.data.points.length - accepted.length,
  });
}

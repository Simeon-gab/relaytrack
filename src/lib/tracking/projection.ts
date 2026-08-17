import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTrackingToken } from "@/lib/tracking-token";
import { estimateEtaMinutes } from "@/lib/tracking/eta";
import { INGEST_LIMITS } from "@/lib/validation/schemas";

/**
 * Customer tracking projection (SPEC section 2, surface 3).
 *
 * The ONLY read path for /t/[token] and its polling API. Auth is the signed
 * token itself: signature is checked before any DB access, then the service
 * role fetches a read-only projection. Never expose the rider's phone, other
 * orders, or raw rows — everything the page can ever see is built here.
 *
 * Expiry: link dies 24h after delivery (delivered_at + 24h, checked at read
 * time — SPEC section 2 surface list).
 */

const EXPIRY_HOURS_AFTER_DELIVERY = 24;
/** Rider position older than this is not worth routing an ETA from. */
const ETA_POSITION_MAX_AGE_MS = 5 * 60_000;

export type TimelineKey = "assigned" | "picked_up" | "nearby" | "delivered" | "failed";

export interface TrackingProjection {
  orgName: string;
  reference: string;
  status: string;
  dropoff: { lat: number | null; lng: number | null; address: string };
  timeline: { key: TimelineKey; at: string }[];
  /** Only present while the order is actively moving; never after delivery. */
  rider: {
    name: string;
    position: { lat: number; lng: number; at: string } | null;
  } | null;
  etaMinutes: number | null;
  /** Client staleness threshold, so UI honesty matches server policy. */
  staleAfterMs: number;
}

export type TrackingLookup =
  | { kind: "ok"; projection: TrackingProjection }
  | { kind: "expired" }
  | { kind: "not_found" };

const ACTIVE_STATUSES = new Set(["assigned", "picked_up", "in_transit"]);

export async function getTrackingProjection(token: string): Promise<TrackingLookup> {
  // Signature check first — garbage tokens never touch Postgres.
  if (!verifyTrackingToken(token)) {
    return { kind: "not_found" };
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(
      "id,reference,status,dropoff_address,dropoff_lat,dropoff_lng,orgs(name),deliveries(assigned_at,picked_up_at,nearby_fired_at,delivered_at,failed_at,riders(name,last_position))",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  if (!order) {
    return { kind: "not_found" };
  }

  const delivery = order.deliveries ?? null;

  if (delivery?.delivered_at) {
    const expiresAt = Date.parse(delivery.delivered_at) + EXPIRY_HOURS_AFTER_DELIVERY * 3_600_000;
    if (Date.now() > expiresAt) {
      return { kind: "expired" };
    }
  }

  const timeline: { key: TimelineKey; at: string }[] = [];
  if (delivery?.assigned_at) timeline.push({ key: "assigned", at: delivery.assigned_at });
  if (delivery?.picked_up_at) timeline.push({ key: "picked_up", at: delivery.picked_up_at });
  if (delivery?.nearby_fired_at) timeline.push({ key: "nearby", at: delivery.nearby_fired_at });
  if (delivery?.delivered_at) timeline.push({ key: "delivered", at: delivery.delivered_at });
  if (delivery?.failed_at) timeline.push({ key: "failed", at: delivery.failed_at });

  // Rider is projected only while the order is actively moving: name +
  // position, nothing else. No phone, no id, ever.
  let rider: TrackingProjection["rider"] = null;
  if (delivery?.riders && ACTIVE_STATUSES.has(order.status)) {
    const raw = delivery.riders.last_position as
      | { lat?: unknown; lng?: unknown; at?: unknown }
      | null;
    const position =
      raw &&
      typeof raw.lat === "number" &&
      typeof raw.lng === "number" &&
      typeof raw.at === "string"
        ? { lat: raw.lat, lng: raw.lng, at: raw.at }
        : null;
    rider = { name: delivery.riders.name, position };
  }

  // ETA only when there is a fresh rider position and a dropoff to route to.
  let etaMinutes: number | null = null;
  if (
    rider?.position &&
    order.dropoff_lat !== null &&
    order.dropoff_lng !== null &&
    (order.status === "picked_up" || order.status === "in_transit") &&
    Date.now() - Date.parse(rider.position.at) < ETA_POSITION_MAX_AGE_MS
  ) {
    etaMinutes = await estimateEtaMinutes(rider.position, {
      lat: order.dropoff_lat,
      lng: order.dropoff_lng,
    });
  }

  return {
    kind: "ok",
    projection: {
      orgName: order.orgs?.name ?? "Delivery",
      reference: order.reference ?? "",
      status: order.status,
      dropoff: {
        lat: order.dropoff_lat,
        lng: order.dropoff_lng,
        address: order.dropoff_address ?? "",
      },
      timeline,
      rider,
      etaMinutes,
      staleAfterMs: INGEST_LIMITS.staleAfterMs,
    },
  };
}

// Domain types. Mirrors docs/SPEC.md section 3 (Database schema).
// Regenerate DB types with: supabase gen types typescript --linked > src/types/database.ts

export type Role = "owner" | "dispatcher" | "admin";
export type RiderStatus = "offline" | "available" | "on_delivery";

export type OrderStatus =
  | "pending"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled";

export type DeliveryEventType =
  | "assigned"
  | "picked_up"
  | "nearby"
  | "delivered"
  | "failed"
  | "note";

export type Actor = "rider" | "dispatcher" | "system";
export type Channel = "whatsapp" | "sms";

/** The complete SIMON integration surface. Add nothing without a paying customer asking. */
export type WebhookEvent =
  | "order.assigned"
  | "order.picked_up"
  | "order.delivered"
  | "order.failed"
  | "cash.collected";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Position extends LatLng {
  accuracy: number;
  at: string; // ISO
}

/** A single GPS sample captured on the rider device. */
export interface LocationPoint extends LatLng {
  accuracy: number;
  speed: number | null;
  heading: number | null;
  captured_at: string; // ISO, device clock — server timestamp is authoritative
}

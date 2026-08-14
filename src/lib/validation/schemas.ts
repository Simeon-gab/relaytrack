import { z } from "zod";

// Zod at every API boundary. SPEC.md section 0, rule 5.

export const locationPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
  speed: z.number().nonnegative().nullable(),
  heading: z.number().min(0).max(360).nullable(),
  captured_at: z.string().datetime(),
});

export const locationBatchSchema = z.object({
  delivery_id: z.string().uuid().nullable(),
  points: z.array(locationPointSchema).min(1).max(50),
});

export type LocationBatch = z.infer<typeof locationBatchSchema>;

// ---- Phase 2: dispatch order workflow ----

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(20).regex(/^\+?[\d\s()-]+$/, "Invalid phone number"),
  address: z.string().trim().min(3).max(500),
  reference: z.string().trim().max(100).optional(),
  codAmount: z.number().nonnegative().max(99_999_999).nullable(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const assignRiderSchema = z.object({
  orderId: z.string().uuid(),
  riderId: z.string().uuid(),
});

export const transitionOrderSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["picked_up", "in_transit", "delivered", "failed", "cancelled"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

// Ingest guardrails — SPEC.md section 2.
export const INGEST_LIMITS = {
  maxClockSkewMs: 10 * 60 * 1000,
  maxAccuracyMeters: 100,
  maxImpliedSpeedKmh: 150,
  nearbyRadiusMeters: 500,
  staleAfterMs: 90 * 1000, // tracking page shows "last seen" past this
} as const;

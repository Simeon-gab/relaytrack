import { z } from "zod";
import type { Enums } from "@/types/database";
import type { LatLng } from "@/types/domain";
import type { TrackSample } from "@/lib/geo/exceptions";

/** Shapes the dispatch page passes from server to the live map (client). */

export interface LiveRider {
  id: string;
  name: string;
  status: Enums<"rider_status">;
  /** Parsed riders.last_position, null until the first accepted ping. */
  position: TrackSample | null;
  /** Accuracy of the last ping (metres) — >100m never reaches the map. */
  accuracy: number | null;
  /** Dropoff of the active delivery, when the order has coordinates. */
  dropoff: LatLng | null;
}

export interface OrderPin {
  id: string;
  reference: string | null;
  status: Enums<"order_status">;
  customerName: string | null;
  lat: number;
  lng: number;
}

/**
 * riders.last_position is jsonb — written only by the ingest handler, but
 * parse rather than cast at this boundary (SPEC rule 5).
 */
export const lastPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  at: z.string(),
});

export function parseLastPosition(value: unknown): z.infer<typeof lastPositionSchema> | null {
  const parsed = lastPositionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Rider status transitions. Same Postgres state machine as dispatch —
// RLS restricts the rider to their own deliveries, and transition_order
// derives actor='rider' from the session. Zod at the boundary (rule 5).

const riderTransitionSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["picked_up", "in_transit", "delivered", "failed"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type RiderActionResult = { ok: true } | { ok: false; error: string };

export async function riderTransition(input: unknown): Promise<RiderActionResult> {
  const parsed = riderTransitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_order", {
    p_order: parsed.data.orderId,
    p_status: parsed.data.status,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/rider");
  return { ok: true };
}

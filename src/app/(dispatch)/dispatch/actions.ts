"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateTrackingToken } from "@/lib/tracking-token";
import {
  createOrderSchema,
  assignRiderSchema,
  transitionOrderSchema,
} from "@/lib/validation/schemas";

// Server actions are an API boundary: session-authenticated (middleware +
// getUser), Zod-validated (SPEC rule 5), and every write goes through the
// caller's RLS — org scoping is enforced in Postgres, not here.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireOrgMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, orgId: null } as const;
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return { supabase, orgId: membership?.org_id ?? null } as const;
}

export async function createOrder(input: unknown): Promise<ActionResult> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { supabase, orgId } = await requireOrgMembership();
  if (!orgId) return { ok: false, error: "Not a member of any organisation" };

  const { customerName, phone, address, reference, codAmount, notes } = parsed.data;

  // Reuse the customer by phone within the org; create otherwise.
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("org_id", orgId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  let customerId = existing?.id;
  if (!customerId) {
    const { data: created, error: customerError } = await supabase
      .from("customers")
      .insert({ org_id: orgId, name: customerName, phone, default_address: address })
      .select("id")
      .single();
    if (customerError) return { ok: false, error: customerError.message };
    customerId = created.id;
  }

  const { error: orderError } = await supabase.from("orders").insert({
    org_id: orgId,
    customer_id: customerId,
    reference: reference || null,
    dropoff_address: address,
    cod_amount: codAmount,
    notes: notes || null,
    tracking_token: generateTrackingToken(),
  });
  if (orderError) return { ok: false, error: orderError.message };

  revalidatePath("/dispatch");
  return { ok: true };
}

export async function assignRider(input: unknown): Promise<ActionResult> {
  const parsed = assignRiderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_rider", {
    p_order: parsed.data.orderId,
    p_rider: parsed.data.riderId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dispatch");
  return { ok: true };
}

export async function transitionOrder(input: unknown): Promise<ActionResult> {
  const parsed = transitionOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_order", {
    p_order: parsed.data.orderId,
    p_status: parsed.data.status,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dispatch");
  return { ok: true };
}

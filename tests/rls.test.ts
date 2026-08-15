import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/types/database";

/**
 * Org isolation is the gate on every phase (SPEC.md section 0, definition of done).
 * A user in org A must not be able to read a single row belonging to org B —
 * on any table, through any client path. Runs against the live project with
 * throwaway orgs/users, cleaned up afterwards.
 */

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase env in .env.local");

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = `Rls-test-${randomBytes(8).toString("hex")}!`;
const runId = randomBytes(4).toString("hex");
const email = (name: string) => `rls-${runId}-${name}@rls-test.relaytrack.dev`;

type Ctx = {
  orgA: string;
  orgB: string;
  users: Record<string, string>; // name -> auth user id
  riderA1: string; // rider row ids
  riderA2: string;
  orderA: string;
  deliveryA: string;
};
const ctx: Ctx = {
  orgA: "",
  orgB: "",
  users: {},
  riderA1: "",
  riderA2: "",
  orderA: "",
  deliveryA: "",
};

async function createUser(name: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(name),
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  ctx.users[name] = data.user.id;
  return data.user.id;
}

async function signIn(name: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: email(name),
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

beforeAll(async () => {
  // Two orgs
  const { data: orgs, error: orgErr } = await admin
    .from("orgs")
    .insert([
      { name: "RLS Test Org A", slug: `rls-a-${runId}` },
      { name: "RLS Test Org B", slug: `rls-b-${runId}` },
    ])
    .select("id, slug");
  if (orgErr) throw orgErr;
  ctx.orgA = orgs.find((o) => o.slug.startsWith("rls-a"))?.id ?? "";
  ctx.orgB = orgs.find((o) => o.slug.startsWith("rls-b"))?.id ?? "";

  // Owners + rider users
  const [ownerA, ownerB, riderA1User, riderA2User] = await Promise.all([
    createUser("owner-a"),
    createUser("owner-b"),
    createUser("rider-a1"),
    createUser("rider-a2"),
  ]);

  const { error: memErr } = await admin.from("org_members").insert([
    { org_id: ctx.orgA, user_id: ownerA, role: "owner" },
    { org_id: ctx.orgB, user_id: ownerB, role: "owner" },
  ]);
  if (memErr) throw memErr;

  // Two riders in org A
  const { data: riders, error: riderErr } = await admin
    .from("riders")
    .insert([
      { org_id: ctx.orgA, user_id: riderA1User, name: "Rider A1", phone: "+2340000000001" },
      { org_id: ctx.orgA, user_id: riderA2User, name: "Rider A2", phone: "+2340000000002" },
    ])
    .select("id, name");
  if (riderErr) throw riderErr;
  ctx.riderA1 = riders.find((r) => r.name === "Rider A1")?.id ?? "";
  ctx.riderA2 = riders.find((r) => r.name === "Rider A2")?.id ?? "";

  // Customer + order + delivery for rider A1, plus a location point
  const { data: customer, error: custErr } = await admin
    .from("customers")
    .insert({ org_id: ctx.orgA, name: "Customer A", phone: "+2340000000009" })
    .select("id")
    .single();
  if (custErr) throw custErr;

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .insert({
      org_id: ctx.orgA,
      customer_id: customer.id,
      dropoff_address: "1 Test St",
      tracking_token: `rls-${runId}-token`,
      status: "assigned",
    })
    .select("id")
    .single();
  if (orderErr) throw orderErr;
  ctx.orderA = order.id;

  const { data: delivery, error: delErr } = await admin
    .from("deliveries")
    .insert({ org_id: ctx.orgA, order_id: order.id, rider_id: ctx.riderA1 })
    .select("id")
    .single();
  if (delErr) throw delErr;
  ctx.deliveryA = delivery.id;

  const { error: locErr } = await admin.from("rider_locations").insert({
    org_id: ctx.orgA,
    rider_id: ctx.riderA1,
    delivery_id: delivery.id,
    lat: 6.4281,
    lng: 3.4219,
    accuracy: 12,
    captured_at: new Date().toISOString(),
  });
  if (locErr) throw locErr;
}, 120_000);

afterAll(async () => {
  // org delete cascades every child table
  if (ctx.orgA) await admin.from("orgs").delete().eq("id", ctx.orgA);
  if (ctx.orgB) await admin.from("orgs").delete().eq("id", ctx.orgB);
  await Promise.all(
    Object.values(ctx.users).map((id) => admin.auth.admin.deleteUser(id)),
  );
}, 120_000);

describe("RLS org isolation", () => {
  it("org A user cannot read org B rows", async () => {
    const asOwnerB = await signIn("owner-b");

    // Reads: every org-A row must be invisible, table by table.
    const { data: orgRows } = await asOwnerB.from("orgs").select("id");
    expect(orgRows?.map((r) => r.id)).not.toContain(ctx.orgA);

    const { data: orderRows } = await asOwnerB.from("orders").select("id, org_id");
    expect(orderRows?.some((r) => r.org_id === ctx.orgA)).toBe(false);

    const { data: riderRows } = await asOwnerB.from("riders").select("id, org_id");
    expect(riderRows?.some((r) => r.org_id === ctx.orgA)).toBe(false);

    const { data: locRows } = await asOwnerB.from("rider_locations").select("id, org_id");
    expect(locRows?.some((r) => r.org_id === ctx.orgA)).toBe(false);

    // Targeted read of a known org-A pk: RLS must return empty, not the row.
    const { data: direct } = await asOwnerB.from("orders").select("id").eq("id", ctx.orderA);
    expect(direct).toEqual([]);

    // Cross-org write must be rejected outright.
    const { error: writeError } = await asOwnerB.from("orders").insert({
      org_id: ctx.orgA,
      customer_id: ctx.orderA, // any uuid — must die on RLS before FK matters
      dropoff_address: "intrusion",
      tracking_token: `rls-${runId}-intrusion`,
    });
    expect(writeError).not.toBeNull();
  });

  it("rider cannot read another rider's deliveries or locations", async () => {
    const asRiderA2 = await signIn("rider-a2");

    // Rider A1's delivery is invisible to rider A2 (same org, different rider).
    const { data: deliveries } = await asRiderA2.from("deliveries").select("id");
    expect(deliveries).toEqual([]);

    // Riders table: only own row visible, never colleagues'.
    const { data: riders } = await asRiderA2.from("riders").select("id");
    expect(riders?.map((r) => r.id)).toEqual([ctx.riderA2]);

    // Location history is dashboard-only (org members); riders read none.
    const { data: locations } = await asRiderA2.from("rider_locations").select("id");
    expect(locations).toEqual([]);

    // Positive control: rider A1 does see their own delivery — the empty
    // results above prove filtering, not a broken table.
    const asRiderA1 = await signIn("rider-a1");
    const { data: ownDeliveries } = await asRiderA1.from("deliveries").select("id, rider_id");
    expect(ownDeliveries).toEqual([{ id: ctx.deliveryA, rider_id: ctx.riderA1 }]);
  });

  it("realtime rider changes never reach another org (Phase 4)", async () => {
    // Phase 4 broadcasts `riders` over Realtime for the dispatch map. The
    // publication is global, so isolation rests entirely on RLS being applied
    // per subscriber — prove it on the wire, not just at query time.
    const asOwnerA = await signIn("owner-a");
    const asOwnerB = await signIn("owner-b");
    for (const client of [asOwnerA, asOwnerB]) {
      const { data } = await client.auth.getSession();
      if (data.session) await client.realtime.setAuth(data.session.access_token);
    }

    const subscribed = (channel: RealtimeChannel): Promise<void> =>
      new Promise((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            reject(new Error(`Realtime subscribe failed: ${status}`));
        });
      });

    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];
    const listen = (client: SupabaseClient<Database>, name: string, sink: unknown[]) =>
      client.channel(name).on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "riders" },
        (payload) => sink.push(payload),
      );
    const chanA = listen(asOwnerA, `rls-rt-a-${runId}`, eventsA);
    const chanB = listen(asOwnerB, `rls-rt-b-${runId}`, eventsB);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      await Promise.all([subscribed(chanA), subscribed(chanB)]);
      // SUBSCRIBED confirms the channel join; the postgres_changes binding
      // registers a beat later. Settle, then poke until the positive control
      // hears something — first fan-out on a fresh subscription can be slow.
      await sleep(3_000);
      for (let attempt = 0; attempt < 10 && eventsA.length === 0; attempt++) {
        // Simulate a ping landing: the ingest handler updates last_position.
        const { error } = await admin
          .from("riders")
          .update({
            last_position: { lat: 6.43, lng: 3.42, accuracy: 10, at: new Date().toISOString() },
          })
          .eq("id", ctx.riderA1);
        expect(error).toBeNull();
        await sleep(3_000);
      }

      // Both directions: org A hears its rider (positive control — without
      // this, an empty eventsB would also pass on a dead channel), org B
      // hears nothing despite identical subscriptions.
      expect(eventsA.length).toBeGreaterThan(0);
      await sleep(5_000);
      expect(eventsB).toEqual([]);
    } finally {
      await asOwnerA.removeChannel(chanA);
      await asOwnerB.removeChannel(chanB);
    }
  }, 60_000);

  it.todo("expired tracking token is rejected (Phase 5)");
  // "unsigned location ingest POST rejected with 401" lives in tests/ingest.test.ts (Phase 3).
  it.todo("replayed webhook timestamp is rejected by the receiver (Phase 8)");
});

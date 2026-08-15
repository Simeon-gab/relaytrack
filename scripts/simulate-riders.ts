/**
 * Phase 4 acceptance harness: drive two simulated riders through the real
 * ingest endpoint so the dispatch map can be verified live (SPEC section 5:
 * "two simulated riders move live on the map without refresh; exceptions
 * fire and clear correctly").
 *
 * Every point goes through POST /api/ingest/location with a real per-rider
 * JWT — the sim exercises the same authenticated pipeline as the PWA, not a
 * database side door. Setup (assign + transition to in_transit) uses the
 * service role; the SQL functions record actor='system' for those events.
 *
 * Run (dev server must be up):
 *   npm run simulate                      # both riders drive to their dropoffs
 *   npm run simulate -- --scenario=stall     # rider 2 stops moving (stalled >10min)
 *   npm run simulate -- --scenario=offline   # rider 2 goes silent (offline >5min)
 *   npm run simulate -- --scenario=offroute  # rider 2 turns away (off-route)
 *   npm run simulate -- --minutes=20         # run longer than the default 15
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import type { Database } from "../src/types/database";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const riderSecret = process.env.RIDER_JWT_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
if (!url || !serviceKey || !riderSecret) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or RIDER_JWT_SECRET");
}

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Scenario = "normal" | "stall" | "offline" | "offroute";
const scenario: Scenario = (() => {
  const arg = process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1];
  if (arg === "stall" || arg === "offline" || arg === "offroute" || arg === "normal") return arg;
  if (arg) throw new Error(`Unknown scenario: ${arg}`);
  return "normal";
})();
const minutes = Number(process.argv.find((a) => a.startsWith("--minutes="))?.split("=")[1] ?? 15);

const SPEED_MPS = 7; // ~25 km/h through Lagos traffic
const PING_MS = 5_000; // capture cadence
const POST_MS = 10_000; // batch cadence (2 points per batch)

interface Sim {
  riderId: string;
  name: string;
  deliveryId: string;
  token: string;
  pos: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  /** Points captured but not yet posted. */
  pending: { lat: number; lng: number; captured_at: string }[];
  arrived: boolean;
}

function moveToward(
  pos: { lat: number; lng: number },
  target: { lat: number; lng: number },
  meters: number,
  away = false,
): { lat: number; lng: number } {
  const dLat = target.lat - pos.lat;
  const dLng = target.lng - pos.lng;
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((pos.lat * Math.PI) / 180);
  const distM = Math.hypot(dLat * mPerLat, dLng * mPerLng);
  if (distM === 0) return pos;
  const step = Math.min(meters, distM) / distM;
  const sign = away ? -meters / distM : step;
  return { lat: pos.lat + dLat * sign, lng: pos.lng + dLng * sign };
}

/** Small jitter so the trail looks like GPS, not geometry (±8m). */
function jitter(pos: { lat: number; lng: number }): { lat: number; lng: number } {
  return {
    lat: pos.lat + ((Math.random() - 0.5) * 16) / 111_320,
    lng: pos.lng + ((Math.random() - 0.5) * 16) / 111_320,
  };
}

async function mintToken(riderId: string, orgId: string): Promise<string> {
  return new SignJWT({ rider_id: riderId, org_id: orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(riderId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(riderSecret));
}

async function post(sim: Sim): Promise<void> {
  if (sim.pending.length === 0) return;
  const points = sim.pending.splice(0, 50).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    accuracy: 8 + Math.random() * 20,
    speed: sim.arrived ? 0 : SPEED_MPS,
    heading: null,
    captured_at: p.captured_at,
  }));
  const res = await fetch(`${appUrl}/api/ingest/location`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sim.token}` },
    body: JSON.stringify({ delivery_id: sim.deliveryId, points }),
  });
  const body: unknown = await res.json().catch(() => null);
  console.log(`  ${sim.name}: POST ${res.status} ${JSON.stringify(body)}`);
}

async function transition(orderId: string, status: "picked_up" | "in_transit"): Promise<void> {
  const { error } = await admin.rpc("transition_order", { p_order: orderId, p_status: status });
  if (error) throw new Error(`transition_order(${status}) failed: ${error.message}`);
}

async function setup(): Promise<Sim[]> {
  const { data: org } = await admin.from("orgs").select("id").eq("slug", "demo").single();
  if (!org) throw new Error("Demo org not found — run `npm run seed` first");

  const { data: riders } = await admin
    .from("riders")
    .select("id,name")
    .eq("org_id", org.id)
    .eq("active", true)
    .order("name")
    .limit(2);
  if (!riders || riders.length < 2) throw new Error("Need 2 riders — run `npm run seed`");

  // Start positions well away from the dropoffs so there is movement to watch.
  const starts = [
    { lat: 6.4550, lng: 3.3941 }, // near Onikan, driving to VI
    { lat: 6.5905, lng: 3.3625 }, // Maryland, driving to Ikeja
  ];

  const sims: Sim[] = [];
  for (const [i, rider] of riders.entries()) {
    // Reuse the rider's active delivery if one exists; otherwise assign a
    // pending order and walk it to in_transit through the real state machine.
    const { data: active } = await admin
      .from("deliveries")
      .select("id,orders!inner(id,status,dropoff_lat,dropoff_lng)")
      .eq("rider_id", rider.id)
      .in("orders.status", ["assigned", "picked_up", "in_transit"])
      .limit(1)
      .maybeSingle();

    let orderId: string;
    let dropoff: { lat: number; lng: number } | null = null;
    if (active) {
      orderId = active.orders.id;
      if (active.orders.dropoff_lat != null && active.orders.dropoff_lng != null) {
        dropoff = { lat: active.orders.dropoff_lat, lng: active.orders.dropoff_lng };
      }
      if (active.orders.status === "assigned") {
        await transition(orderId, "picked_up");
        await transition(orderId, "in_transit");
      } else if (active.orders.status === "picked_up") {
        await transition(orderId, "in_transit");
      }
    } else {
      const { data: pending } = await admin
        .from("orders")
        .select("id,dropoff_lat,dropoff_lng")
        .eq("org_id", org.id)
        .eq("status", "pending")
        .not("dropoff_lat", "is", null)
        .limit(10);
      const order = pending?.[i];
      if (!order) throw new Error("Not enough pending orders with coordinates — run `npm run seed`");
      orderId = order.id;
      dropoff = { lat: order.dropoff_lat as number, lng: order.dropoff_lng as number };
      const { error } = await admin.rpc("assign_rider", { p_order: orderId, p_rider: rider.id });
      if (error) throw new Error(`assign_rider failed: ${error.message}`);
      await transition(orderId, "picked_up");
      await transition(orderId, "in_transit");
    }
    if (!dropoff) throw new Error(`Order ${orderId} has no dropoff coordinates`);

    const { data: delivery } = await admin
      .from("deliveries")
      .select("id")
      .eq("order_id", orderId)
      .single();
    if (!delivery) throw new Error("Delivery row missing after assignment");

    sims.push({
      riderId: rider.id,
      name: rider.name,
      deliveryId: delivery.id,
      token: await mintToken(rider.id, org.id),
      pos: starts[i] ?? starts[0]!,
      dropoff,
      pending: [],
      arrived: false,
    });
    console.log(`${rider.name}: in_transit, dropoff ${dropoff.lat.toFixed(4)},${dropoff.lng.toFixed(4)}`);
  }
  return sims;
}

async function main(): Promise<void> {
  const sims = await setup();
  const startMs = Date.now();
  const endMs = startMs + minutes * 60_000;
  console.log(`\nScenario: ${scenario} — driving for up to ${minutes} min. Ctrl+C to stop.\n`);

  let lastPost = 0;
  let offrouteFlipped = false;

  while (Date.now() < endMs) {
    const now = Date.now();
    const elapsedMin = (now - startMs) / 60_000;

    for (const [i, sim] of sims.entries()) {
      const isVictim = i === 1 && scenario !== "normal";
      const stepM = SPEED_MPS * (PING_MS / 1_000);

      if (isVictim && scenario === "offline" && elapsedMin >= 1) {
        continue; // radio silence — offline alert should fire at the 6min mark
      }
      if (isVictim && scenario === "stall" && elapsedMin >= 1) {
        // Parked: keeps pinging the same spot. Stalled fires after ~11 min.
        sim.pending.push({ ...jitter(sim.pos), captured_at: new Date(now).toISOString() });
        continue;
      }
      if (isVictim && scenario === "offroute" && !offrouteFlipped) {
        // Turn away once we're within 1.5km of the drop; the >500m retreat
        // trips the heuristic a couple of minutes later.
        const mPerLat = 111_320;
        const dist = Math.hypot(
          (sim.dropoff.lat - sim.pos.lat) * mPerLat,
          (sim.dropoff.lng - sim.pos.lng) * mPerLat * Math.cos((sim.pos.lat * Math.PI) / 180),
        );
        if (dist < 1_500) offrouteFlipped = true;
      }

      const away = isVictim && scenario === "offroute" && offrouteFlipped;
      if (!sim.arrived || away) {
        sim.pos = moveToward(sim.pos, sim.dropoff, stepM, away);
        if (!away) {
          const remaining = moveToward(sim.pos, sim.dropoff, Number.MAX_SAFE_INTEGER);
          if (remaining.lat === sim.pos.lat && remaining.lng === sim.pos.lng) sim.arrived = true;
        }
      }
      sim.pending.push({ ...jitter(sim.pos), captured_at: new Date(now).toISOString() });
    }

    if (now - lastPost >= POST_MS) {
      lastPost = now;
      await Promise.all(sims.map((sim) => post(sim)));
    }
    await new Promise((resolve) => setTimeout(resolve, PING_MS));
  }
  await Promise.all(sims.map((sim) => post(sim)));
  console.log("\nSimulation finished.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

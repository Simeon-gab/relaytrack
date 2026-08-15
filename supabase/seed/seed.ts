/**
 * Seed: demo org + 2 riders + 5 orders (SPEC.md section 3, migration rules).
 * For local dev and the Loom demo. Idempotent: re-running wipes and recreates
 * the demo org's data (auth users are reused, never duplicated).
 *
 * Run: npm run seed
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "../../src/types/database";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG_SLUG = "demo";
const PASSWORD = process.env.SEED_PASSWORD ?? "RelayTrack-Demo1!";

const USERS = [
  { email: "owner@demo.relaytrack.dev", role: "owner" as const },
  { email: "dispatcher@demo.relaytrack.dev", role: "dispatcher" as const },
];
const RIDERS = [
  { email: "rider.tunde@demo.relaytrack.dev", name: "Tunde Adeyemi", phone: "+2348012340001" },
  { email: "rider.chika@demo.relaytrack.dev", name: "Chika Obi", phone: "+2348012340002" },
];
// Coordinates included so the demo orders pin on the Phase 4 dispatch map.
// Real orders get coords from geocoding (Phase 5, alongside ETA).
const CUSTOMERS = [
  { name: "Mrs. Balogun", phone: "+2348098765001", default_address: "12 Adeola Odeku St, Victoria Island, Lagos", lat: 6.4281, lng: 3.4219 },
  { name: "Emeka Electronics", phone: "+2348098765002", default_address: "45 Awolowo Rd, Ikoyi, Lagos", lat: 6.4432, lng: 3.4245 },
  { name: "Fatima Yusuf", phone: "+2348098765003", default_address: "3 Allen Ave, Ikeja, Lagos", lat: 6.6018, lng: 3.3515 },
];

function trackingToken(): string {
  return randomBytes(24).toString("base64url");
}

async function ensureUser(email: string, withPassword: boolean): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(withPassword ? { password: PASSWORD } : {}),
  });
  if (!error) return created.user.id;

  // Already exists — find it. Demo scale, one page is plenty.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw new Error(`Could not create or find user ${email}: ${error.message}`);
  if (withPassword) {
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  }
  return existing.id;
}

async function main(): Promise<void> {
  // Wipe previous demo org — org_id cascades take all child rows with it.
  const { data: existingOrg } = await admin.from("orgs").select("id").eq("slug", ORG_SLUG).maybeSingle();
  if (existingOrg) {
    const { error } = await admin.from("orgs").delete().eq("id", existingOrg.id);
    if (error) throw error;
    console.log("Removed previous demo org.");
  }

  const { data: org, error: orgError } = await admin
    .from("orgs")
    .insert({ name: "Hungkee Demo", slug: ORG_SLUG })
    .select("id")
    .single();
  if (orgError) throw orgError;
  console.log(`Org created: ${org.id}`);

  for (const u of USERS) {
    const userId = await ensureUser(u.email, true);
    const { error } = await admin
      .from("org_members")
      .insert({ org_id: org.id, user_id: userId, role: u.role });
    if (error) throw error;
    console.log(`  ${u.role}: ${u.email}`);
  }

  const riderIds: string[] = [];
  for (const r of RIDERS) {
    const userId = await ensureUser(r.email, false); // riders sign in by magic link
    const { data: rider, error } = await admin
      .from("riders")
      .insert({ org_id: org.id, user_id: userId, name: r.name, phone: r.phone })
      .select("id")
      .single();
    if (error) throw error;
    riderIds.push(rider.id);
    console.log(`  rider: ${r.name} (${r.email})`);
  }

  const customerIds: string[] = [];
  for (const { lat: _lat, lng: _lng, ...c } of CUSTOMERS) {
    const { data: customer, error } = await admin
      .from("customers")
      .insert({ org_id: org.id, ...c })
      .select("id")
      .single();
    if (error) throw error;
    customerIds.push(customer.id);
  }

  const orders = [
    { customer: 0, reference: "HK-1001", cod: 45000 },
    { customer: 1, reference: "HK-1002", cod: null },
    { customer: 2, reference: "HK-1003", cod: 12500 },
    { customer: 0, reference: "HK-1004", cod: null },
    { customer: 1, reference: "HK-1005", cod: 89900 },
  ];
  for (const o of orders) {
    const customerId = customerIds[o.customer];
    if (!customerId) throw new Error("Seed customer index out of range");
    const { error } = await admin.from("orders").insert({
      org_id: org.id,
      customer_id: customerId,
      reference: o.reference,
      dropoff_address: CUSTOMERS[o.customer]?.default_address ?? "Lagos",
      dropoff_lat: CUSTOMERS[o.customer]?.lat ?? null,
      dropoff_lng: CUSTOMERS[o.customer]?.lng ?? null,
      cod_amount: o.cod,
      tracking_token: trackingToken(),
    });
    if (error) throw error;
  }
  console.log(`  ${orders.length} orders created.`);

  console.log("\nSeed complete. Dashboard login:");
  console.log(`  ${USERS[0]?.email} / ${PASSWORD}`);
  console.log(`  ${USERS[1]?.email} / ${PASSWORD}`);
  console.log("Riders sign in by magic link at /rider/login.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

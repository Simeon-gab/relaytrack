import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import type { Database } from "../src/types/database";

/**
 * Location ingest acceptance (SPEC Phase 3): unsigned/spoofed POSTs are
 * rejected with 401; validated batches land in rider_locations and update
 * riders.last_position; garbage points (bad accuracy, future clocks,
 * impossible speed) are discarded. Calls the real route handler against the
 * live project with a throwaway org, cleaned up afterwards.
 */

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const riderJwtSecret = process.env.RIDER_JWT_SECRET ?? "";
if (!url || !serviceKey || !riderJwtSecret) throw new Error("Missing env in .env.local");

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Route handler imported directly — same code path as production.
import { POST } from "../src/app/api/ingest/location/route";

const runId = randomBytes(4).toString("hex");
const ctx = { orgId: "", riderId: "" };

function ingestRequest(body: unknown, token?: string): Request {
  return new Request("http://localhost/api/ingest/location", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function mint(claims: Record<string, unknown>, secret: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

function point(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lat: 6.5244,
    lng: 3.3792,
    accuracy: 15,
    speed: 6.2,
    heading: 90,
    captured_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .insert({ name: "Ingest Test Org", slug: `ingest-${runId}` })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  ctx.orgId = org.id;

  const { data: rider, error: riderErr } = await admin
    .from("riders")
    .insert({ org_id: org.id, name: "Ingest Rider", phone: "+2340000000099" })
    .select("id")
    .single();
  if (riderErr) throw riderErr;
  ctx.riderId = rider.id;
});

afterAll(async () => {
  if (ctx.orgId) await admin.from("orgs").delete().eq("id", ctx.orgId);
});

describe("location ingest auth", () => {
  it("rejects an unsigned POST with 401", async () => {
    const res = await POST(ingestRequest({ delivery_id: null, points: [point()] }));
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret with 401", async () => {
    const forged = await mint(
      { rider_id: ctx.riderId, org_id: ctx.orgId },
      "wrong-secret-entirely",
    );
    const res = await POST(
      ingestRequest({ delivery_id: null, points: [point()] }, forged),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a valid signature naming a nonexistent rider with 401", async () => {
    const token = await mint(
      { rider_id: "00000000-0000-0000-0000-000000000000", org_id: ctx.orgId },
      riderJwtSecret,
    );
    const res = await POST(
      ingestRequest({ delivery_id: null, points: [point()] }, token),
    );
    expect(res.status).toBe(401);
  });
});

describe("location ingest validation + storage", () => {
  it("stores valid points and updates last_position; discards garbage", async () => {
    const token = await mint(
      { rider_id: ctx.riderId, org_id: ctx.orgId },
      riderJwtSecret,
    );
    const base = Date.now();
    const good1 = point({ captured_at: new Date(base - 30_000).toISOString() });
    // ~90m north 20s later => ~16 km/h. Plausible.
    const good2 = point({
      lat: 6.5252,
      captured_at: new Date(base - 10_000).toISOString(),
    });
    const badAccuracy = point({ accuracy: 250, captured_at: new Date(base - 25_000).toISOString() });
    const futureClock = point({ captured_at: new Date(base + 60 * 60_000).toISOString() });
    // Lagos -> ~55km away 1s after good2 => thousands of km/h. Spoof.
    const teleport = point({
      lat: 7.0,
      lng: 3.9,
      captured_at: new Date(base - 9_000).toISOString(),
    });

    const res = await POST(
      ingestRequest(
        { delivery_id: null, points: [good1, badAccuracy, good2, futureClock, teleport] },
        token,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; discarded: number };
    expect(body.accepted).toBe(2);
    expect(body.discarded).toBe(3);

    const { data: rows } = await admin
      .from("rider_locations")
      .select("lat,lng,accuracy")
      .eq("rider_id", ctx.riderId);
    expect(rows).toHaveLength(2);

    const { data: rider } = await admin
      .from("riders")
      .select("last_position")
      .eq("id", ctx.riderId)
      .single();
    const lastPosition = rider?.last_position as { lat: number; at: string } | null;
    expect(lastPosition?.lat).toBeCloseTo(6.5252, 4);
  });

  it("accepts old captured_at values (offline buffer replay must not be dropped)", async () => {
    const token = await mint(
      { rider_id: ctx.riderId, org_id: ctx.orgId },
      riderJwtSecret,
    );
    // 40 minutes old — a buffered point after airplane mode.
    // Placed near last_position so the speed check passes.
    const buffered = point({
      lat: 6.5253,
      captured_at: new Date(Date.now() - 40 * 60_000).toISOString(),
    });
    const res = await POST(ingestRequest({ delivery_id: null, points: [buffered] }, token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(1);
  });
});

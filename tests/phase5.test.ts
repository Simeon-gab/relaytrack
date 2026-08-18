import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import type { Database } from "../src/types/database";

/**
 * Phase 5 acceptance (SPEC section 5):
 *  - each status transition queues exactly one notification (trigger on
 *    delivery_events, exercised through the real assign/transition functions)
 *  - nearby fires once at <500m, through the real ingest route
 *  - WhatsApp failure falls back to SMS (unit-level rules + cron route)
 *  - customer link projection: valid token resolves, garbage token does not,
 *    24h-post-delivery expiry enforced, rider phone never exposed
 */

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const riderJwtSecret = process.env.RIDER_JWT_SECRET ?? "";
if (!url || !serviceKey || !riderJwtSecret) throw new Error("Missing env in .env.local");

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

import { POST as ingestPost } from "../src/app/api/ingest/location/route";
import { GET as trackGet } from "../src/app/api/track/[token]/route";
import { GET as cronGet } from "../src/app/api/cron/notifications/route";
import { generateTrackingToken } from "../src/lib/tracking-token";
import { processNotification, MAX_SMS_ATTEMPTS } from "../src/lib/notifications/process";
import { buildMessageText, type MessageContext } from "../src/lib/notifications/content";

const runId = randomBytes(4).toString("hex");

// Dropoff and a point ~200m away (well inside the 500m geofence), plus one
// ~5km out (well outside).
const DROPOFF = { lat: 6.45, lng: 3.4 };
const NEAR_POINT = { lat: 6.4518, lng: 3.4 }; // ~200m north
const FAR_POINT = { lat: 6.495, lng: 3.4 }; // ~5km north

const ctx = {
  orgId: "",
  riderId: "",
  customerId: "",
  orderId: "",
  deliveryId: "",
  trackingToken: "",
};

async function mintRiderToken(): Promise<string> {
  return new SignJWT({ rider_id: ctx.riderId, org_id: ctx.orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ctx.riderId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(riderJwtSecret));
}

function ingestRequest(body: unknown, token: string): Request {
  return new Request("http://localhost/api/ingest/location", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function notificationsFor(template: string) {
  const { data } = await admin
    .from("notifications")
    .select("id,channel,template,status,to_phone")
    .eq("order_id", ctx.orderId)
    .eq("template", template);
  return data ?? [];
}

beforeAll(async () => {
  const { data: org } = await admin
    .from("orgs")
    .insert({ name: `P5 Test ${runId}`, slug: `p5-test-${runId}` })
    .select("id")
    .single();
  if (!org) throw new Error("org insert failed");
  ctx.orgId = org.id;

  const { data: rider } = await admin
    .from("riders")
    .insert({ org_id: ctx.orgId, name: `P5 Rider ${runId}`, phone: "+2348000000001", active: true })
    .select("id")
    .single();
  if (!rider) throw new Error("rider insert failed");
  ctx.riderId = rider.id;

  const { data: customer } = await admin
    .from("customers")
    .insert({ org_id: ctx.orgId, name: `P5 Customer ${runId}`, phone: "+2348000000002" })
    .select("id")
    .single();
  if (!customer) throw new Error("customer insert failed");
  ctx.customerId = customer.id;

  ctx.trackingToken = generateTrackingToken();
  const { data: order } = await admin
    .from("orders")
    .insert({
      org_id: ctx.orgId,
      customer_id: ctx.customerId,
      reference: `P5-${runId}`,
      dropoff_address: "1 Test Close, Lagos",
      dropoff_lat: DROPOFF.lat,
      dropoff_lng: DROPOFF.lng,
      status: "pending",
      tracking_token: ctx.trackingToken,
    })
    .select("id")
    .single();
  if (!order) throw new Error("order insert failed");
  ctx.orderId = order.id;
}, 30_000);

afterAll(async () => {
  if (ctx.orgId) await admin.from("orgs").delete().eq("id", ctx.orgId);
}, 30_000);

describe("notification fallback rules (unit)", () => {
  const msgCtx: MessageContext = {
    orgName: "Hungkee",
    reference: "HK-1",
    trackingUrl: "https://x/t/abc",
  };
  const okSend = async () => ({ ok: true, response: { id: "msg-1" } });
  const failSend = async () => ({ ok: false, response: { error: "provider down" } });

  it("whatsapp success -> sent, no fallback", async () => {
    const out = await processNotification(
      { id: "n1", channel: "whatsapp", template: "assigned", to_phone: "+234", attempts: 0 },
      msgCtx,
      { sendWhatsApp: okSend, sendSms: failSend, buildText: buildMessageText },
    );
    expect(out.status).toBe("sent");
    expect(out.enqueueSmsFallback).toBe(false);
  });

  it("whatsapp failure -> failed + SMS fallback enqueued (acceptance: WA falls back to SMS)", async () => {
    const out = await processNotification(
      { id: "n2", channel: "whatsapp", template: "assigned", to_phone: "+234", attempts: 0 },
      msgCtx,
      { sendWhatsApp: failSend, sendSms: okSend, buildText: buildMessageText },
    );
    expect(out.status).toBe("failed");
    expect(out.enqueueSmsFallback).toBe(true);
  });

  it("sms transient failure retries, then fails for good at max attempts", async () => {
    const first = await processNotification(
      { id: "n3", channel: "sms", template: "delivered", to_phone: "+234", attempts: 0 },
      msgCtx,
      { sendWhatsApp: failSend, sendSms: failSend, buildText: buildMessageText },
    );
    expect(first.status).toBe("queued");
    const last = await processNotification(
      { id: "n3", channel: "sms", template: "delivered", to_phone: "+234", attempts: MAX_SMS_ATTEMPTS - 1 },
      msgCtx,
      { sendWhatsApp: failSend, sendSms: failSend, buildText: buildMessageText },
    );
    expect(last.status).toBe("failed");
    expect(last.enqueueSmsFallback).toBe(false);
  });

  it("every SMS stays in the GSM-7 alphabet and fits one 160-char segment", () => {
    // Any character outside GSM-7 (em-dash, smart quotes, naira sign) forces
    // the whole message into UCS-2: the segment limit drops 160 -> 70 and the
    // send costs multiple segments. These fire on every delivery, so a stray
    // punctuation character is a real recurring cost, not a cosmetic issue.
    const GSM =
      "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
    const realistic: MessageContext = {
      orgName: "Hungkee",
      reference: "HK-1042",
      // Longest realistic link: full signed token on the deployed domain.
      trackingUrl: "https://relaytrack.vercel.app/t/kG9Wu65X5NJ9iE5R.5IxUQfHnZ-aGcv3rbdMN8M",
    };
    for (const template of ["assigned", "picked_up", "nearby", "delivered"] as const) {
      const text = buildMessageText(template, realistic);
      const offending = [...text].filter((ch) => !GSM.includes(ch));
      expect(offending, `${template} has non-GSM-7 chars: ${offending.join(" ")}`).toEqual([]);
      expect(text.length, `${template} spills into a second SMS segment`).toBeLessThanOrEqual(160);
    }
  });

  it("every template's text carries org, reference and tracking link", () => {
    for (const template of ["assigned", "picked_up", "nearby", "delivered"] as const) {
      const text = buildMessageText(template, msgCtx);
      expect(text).toContain("Hungkee");
      expect(text).toContain("HK-1");
      expect(text).toContain("https://x/t/abc");
    }
  });
});

describe("exactly one notification per transition (trigger)", () => {
  it("assign -> picked_up -> in_transit -> delivered queue one each (none for in_transit)", async () => {
    const { error: assignError } = await admin.rpc("assign_rider", {
      p_order: ctx.orderId,
      p_rider: ctx.riderId,
    });
    expect(assignError).toBeNull();
    const { data: delivery } = await admin
      .from("deliveries")
      .select("id")
      .eq("order_id", ctx.orderId)
      .single();
    if (!delivery) throw new Error("delivery missing");
    ctx.deliveryId = delivery.id;

    expect(await notificationsFor("assigned")).toHaveLength(1);

    await admin.rpc("transition_order", { p_order: ctx.orderId, p_status: "picked_up" });
    expect(await notificationsFor("picked_up")).toHaveLength(1);

    await admin.rpc("transition_order", { p_order: ctx.orderId, p_status: "in_transit" });
    // in_transit is not a customer-facing template; nothing new queued.
    const { data: all } = await admin
      .from("notifications")
      .select("template")
      .eq("order_id", ctx.orderId);
    expect(all?.map((n) => n.template).sort()).toEqual(["assigned", "picked_up"]);
  }, 30_000);
});

describe("geofence: nearby fires once at <500m (ingest route)", () => {
  it("far point does not fire; near point fires exactly once; repeat stays once", async () => {
    const token = await mintRiderToken();

    const far = await ingestPost(
      ingestRequest(
        {
          delivery_id: ctx.deliveryId,
          points: [{ ...FAR_POINT, accuracy: 10, speed: 6, heading: null, captured_at: new Date().toISOString() }],
        },
        token,
      ),
    );
    expect(far.status).toBe(200);
    expect(await notificationsFor("nearby")).toHaveLength(0);

    // Small pause so the near point's implied speed from FAR_POINT stays sane
    // is unnecessary — 5km in 0s would be discarded. Send near point with a
    // captured_at far enough after the far point.
    const nearAt = new Date(Date.now() + 3 * 60_000);
    const near = await ingestPost(
      ingestRequest(
        {
          delivery_id: ctx.deliveryId,
          points: [{ ...NEAR_POINT, accuracy: 10, speed: 6, heading: null, captured_at: nearAt.toISOString() }],
        },
        token,
      ),
    );
    expect(near.status).toBe(200);
    expect(await notificationsFor("nearby")).toHaveLength(1);

    const again = await ingestPost(
      ingestRequest(
        {
          delivery_id: ctx.deliveryId,
          points: [
            {
              ...NEAR_POINT,
              accuracy: 10,
              speed: 6,
              heading: null,
              captured_at: new Date(nearAt.getTime() + 10_000).toISOString(),
            },
          ],
        },
        token,
      ),
    );
    expect(again.status).toBe(200);
    expect(await notificationsFor("nearby")).toHaveLength(1);

    const { data: events } = await admin
      .from("delivery_events")
      .select("id")
      .eq("delivery_id", ctx.deliveryId)
      .eq("type", "nearby");
    expect(events).toHaveLength(1);
  }, 30_000);
});

describe("customer tracking projection", () => {
  it("valid token resolves; rider phone never appears anywhere in the payload", async () => {
    const res = await trackGet(new Request("http://localhost/api/track/x"), {
      params: Promise.resolve({ token: ctx.trackingToken }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { status: string; rider: { name: string } | null; timeline: unknown[] };
    expect(body.status).toBe("in_transit");
    expect(body.rider?.name).toContain("P5 Rider");
    expect(body.timeline.length).toBeGreaterThanOrEqual(2);
    // The rider's phone must not leak through any field.
    expect(raw).not.toContain("+2348000000001");
  });

  it("garbage and forged tokens are rejected before touching the DB", async () => {
    for (const bad of ["nonsense", "abc.def", `${ctx.trackingToken.split(".")[0]}.AAAAAAAAAAAAAAAAAAAAAA`]) {
      const res = await trackGet(new Request("http://localhost/api/track/x"), {
        params: Promise.resolve({ token: bad }),
      });
      expect(res.status).toBe(404);
    }
  });

  it("link expires 24h after delivery", async () => {
    await admin.rpc("transition_order", { p_order: ctx.orderId, p_status: "delivered" });
    expect(await notificationsFor("delivered")).toHaveLength(1);

    // Fresh delivery: still live.
    const live = await trackGet(new Request("http://localhost/api/track/x"), {
      params: Promise.resolve({ token: ctx.trackingToken }),
    });
    expect(live.status).toBe(200);

    // Age the delivery 25h: expired.
    const aged = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await admin.from("deliveries").update({ delivered_at: aged }).eq("id", ctx.deliveryId);
    const expired = await trackGet(new Request("http://localhost/api/track/x"), {
      params: Promise.resolve({ token: ctx.trackingToken }),
    });
    expect(expired.status).toBe(410);
  }, 30_000);
});

describe("cron sweep (route)", () => {
  it("rejects calls without CRON_SECRET", async () => {
    const res = await cronGet(new Request("http://localhost/api/cron/notifications"));
    expect(res.status).toBe(401);
  });

  it("sweeps this order's queued whatsapp rows into failed + SMS fallback (providers unconfigured)", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("CRON_SECRET missing from .env.local");

    // Drain enough batches to cover any concurrent demo-org backlog.
    for (let i = 0; i < 8; i++) {
      const res = await cronGet(
        new Request("http://localhost/api/cron/notifications", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      expect(res.status).toBe(200);
      const { data: remaining } = await admin
        .from("notifications")
        .select("id")
        .eq("order_id", ctx.orderId)
        .eq("channel", "whatsapp")
        .eq("status", "queued");
      if ((remaining ?? []).length === 0) break;
    }

    const { data: rows } = await admin
      .from("notifications")
      .select("channel,template,status")
      .eq("order_id", ctx.orderId);
    const whatsapp = (rows ?? []).filter((r) => r.channel === "whatsapp");
    const sms = (rows ?? []).filter((r) => r.channel === "sms");

    // Every whatsapp attempt failed (no provider configured in dev)...
    expect(whatsapp.length).toBeGreaterThanOrEqual(4);
    for (const row of whatsapp) expect(row.status).toBe("failed");
    // ...and each produced exactly one SMS fallback per template.
    const smsTemplates = sms.map((r) => r.template).sort();
    expect(smsTemplates).toEqual(["assigned", "delivered", "nearby", "picked_up"]);
  }, 60_000);
});

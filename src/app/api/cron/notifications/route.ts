import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { buildMessageText, isNotificationTemplate, type MessageContext } from "@/lib/notifications/content";
import { sendWhatsApp, sendTermiiSms } from "@/lib/notifications/providers";
import { processNotification, type OutboxRow } from "@/lib/notifications/process";

/**
 * Notification outbox sweep (SPEC section 2). Runs from Vercel Cron; sends
 * are never fired inline from status transitions, so a provider outage never
 * blocks a delivery status update.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` — no other
 * caller is accepted (SPEC rule 3: every inbound endpoint authenticated).
 *
 * Sweep order is oldest-first so a backlog drains in the order events
 * happened. Batch cap keeps each invocation inside serverless limits; the
 * next minute's run picks up the rest.
 */

const SWEEP_LIMIT = 25;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${requireEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data: rows, error } = await admin
    .from("notifications")
    .select("id,org_id,channel,template,to_phone,attempts,order_id,orders(reference,tracking_token,orgs(name))")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(SWEEP_LIMIT);
  if (error) {
    return NextResponse.json({ error: "Sweep query failed" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  let fallbacks = 0;

  for (const row of rows ?? []) {
    if (!isNotificationTemplate(row.template)) {
      // Unknown template (future enum drift): park it as failed, visibly.
      await admin
        .from("notifications")
        .update({
          status: "failed",
          attempts: row.attempts + 1,
          provider_response: { error: `unknown template: ${row.template}` },
        })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    const ctx: MessageContext = {
      orgName: row.orders?.orgs?.name ?? "Your order",
      reference: row.orders?.reference ?? "",
      trackingUrl: `${appUrl}/t/${row.orders?.tracking_token ?? ""}`,
    };
    const outboxRow: OutboxRow = {
      id: row.id,
      channel: row.channel,
      template: row.template,
      to_phone: row.to_phone,
      attempts: row.attempts,
    };

    const outcome = await processNotification(outboxRow, ctx, {
      sendWhatsApp,
      sendSms: sendTermiiSms,
      buildText: buildMessageText,
    });

    await admin
      .from("notifications")
      .update({
        status: outcome.status,
        attempts: row.attempts + 1,
        provider_response: outcome.response as never,
        ...(outcome.status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      })
      .eq("id", row.id);

    if (outcome.status === "sent") sent += 1;
    else if (outcome.status === "failed") failed += 1;
    else requeued += 1;

    if (outcome.enqueueSmsFallback) {
      // Exactly one customer message per transition: enqueue the SMS only if
      // no SMS row already exists for this order+template (sweep re-runs,
      // manual retries and races all funnel through this guard).
      const { data: existing } = await admin
        .from("notifications")
        .select("id")
        .eq("order_id", row.order_id)
        .eq("template", row.template)
        .eq("channel", "sms")
        .limit(1)
        .maybeSingle();
      if (!existing) {
        await admin.from("notifications").insert({
          org_id: row.org_id,
          order_id: row.order_id,
          channel: "sms",
          template: row.template,
          to_phone: row.to_phone,
        });
        fallbacks += 1;
      }
    }
  }

  return NextResponse.json({ processed: rows?.length ?? 0, sent, failed, requeued, fallbacks });
}

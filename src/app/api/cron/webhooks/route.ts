import { NextResponse } from "next/server";

/**
 * Webhook outbox delivery (Vercel Cron, every minute). SPEC.md section 2.
 * Auth: require CRON_SECRET.
 * Signs with X-Signature: HMAC-SHA256(timestamp + body). Max 5 attempts,
 * exponential backoff. Events: order.assigned, order.picked_up,
 * order.delivered, order.failed, cash.collected. This is the entire
 * SIMON integration surface — add nothing else.
 * Phase 8.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Not implemented (Phase 8)" }, { status: 501 });
}

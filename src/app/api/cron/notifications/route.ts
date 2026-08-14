import { NextResponse } from "next/server";

/**
 * Notification outbox sweep (Vercel Cron, every minute). SPEC.md section 2.
 * Auth: require CRON_SECRET. WhatsApp primary, Termii SMS fallback.
 * Sends are never fired inline from status transitions — a provider outage
 * must not block a delivery status update.
 * Phase 5.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Not implemented (Phase 5)" }, { status: 501 });
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

/**
 * Customer tracking tokens (orders.tracking_token). Format: `<id>.<sig>` where
 * sig = HMAC-SHA256(id, TRACKING_TOKEN_SECRET), truncated. Signature check
 * happens before any DB lookup so the public /t/[token] route can reject
 * garbage without touching Postgres. 24h-post-delivery expiry is enforced
 * against deliveries.delivered_at at read time (Phase 5), not in the token.
 */

const SIG_LENGTH = 22; // base64url chars (~16 bytes) — plenty against forgery

function sign(id: string): string {
  return createHmac("sha256", requireEnv("TRACKING_TOKEN_SECRET"))
    .update(id)
    .digest("base64url")
    .slice(0, SIG_LENGTH);
}

export function generateTrackingToken(): string {
  const id = randomBytes(12).toString("base64url");
  return `${id}.${sign(id)}`;
}

export function verifyTrackingToken(token: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(id);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

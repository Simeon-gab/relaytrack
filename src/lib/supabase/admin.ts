import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Service-role client — BYPASSES RLS.
 *
 * Only three legitimate call sites exist (SPEC.md section 3, RLS summary):
 *   1. /api/ingest/location — after per-rider JWT validation
 *   2. Cron sweeps (notifications, webhook outbox) — after CRON_SECRET check
 *   3. Tracking-page projection — after signed-token validation
 *
 * Every use must be preceded by explicit token/JWT validation in the same
 * function. The tracking page and ingest endpoint have no Supabase user
 * session — they authenticate by signed token instead. Do not "simplify"
 * this into an anon-role table read.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

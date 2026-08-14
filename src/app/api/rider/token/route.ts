import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mintRiderToken } from "@/lib/rider/jwt";

/**
 * Mints the per-rider ingest JWT. Session-authenticated: only a signed-in
 * user with a linked, active rider row gets a token. No anonymous path.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // RLS: a rider can only ever see their own row.
  const { data: rider } = await supabase
    .from("riders")
    .select("id,org_id,active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rider || !rider.active) {
    return NextResponse.json({ error: "No active rider profile" }, { status: 403 });
  }

  const { token, expiresInSeconds } = await mintRiderToken({
    riderId: rider.id,
    orgId: rider.org_id,
  });
  return NextResponse.json({ token, expires_in: expiresInSeconds });
}

import { NextResponse } from "next/server";
import { getTrackingProjection } from "@/lib/tracking/projection";

/**
 * Polling endpoint behind the customer tracking page. Authenticated by the
 * signed tracking token itself (capability URL) — signature verified before
 * any DB read, same projection as the page, nothing else exposed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const result = await getTrackingProjection(token);
  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.kind === "expired") {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }
  return NextResponse.json(result.projection, {
    headers: { "cache-control": "no-store" },
  });
}

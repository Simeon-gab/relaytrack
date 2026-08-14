import { SignJWT, jwtVerify } from "jose";
import { requireEnv } from "@/lib/env";

/**
 * Per-rider signed JWTs for the location ingest endpoint (SPEC rule 3).
 * Minted only for a session-authenticated rider by /api/rider/token;
 * verified by /api/ingest/location. Short-lived — the PWA refreshes it.
 */

const TOKEN_TTL_SECONDS = 60 * 60;

function secret(): Uint8Array {
  return new TextEncoder().encode(requireEnv("RIDER_JWT_SECRET"));
}

export interface RiderClaims {
  riderId: string;
  orgId: string;
}

export async function mintRiderToken(claims: RiderClaims): Promise<{
  token: string;
  expiresInSeconds: number;
}> {
  const token = await new SignJWT({ rider_id: claims.riderId, org_id: claims.orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.riderId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret());
  return { token, expiresInSeconds: TOKEN_TTL_SECONDS };
}

export async function verifyRiderToken(token: string): Promise<RiderClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const riderId = payload.rider_id;
    const orgId = payload.org_id;
    if (typeof riderId !== "string" || typeof orgId !== "string") return null;
    return { riderId, orgId };
  } catch {
    return null;
  }
}

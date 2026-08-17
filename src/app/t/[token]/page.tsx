import { notFound } from "next/navigation";
import { getTrackingProjection } from "@/lib/tracking/projection";
import { TrackingLive } from "./tracking-live";

/**
 * Public customer tracking page (SPEC section 2, surface 3). No login —
 * authenticated by the signed token, validated server-side before any data
 * is fetched. Light theme, the ORG's brand moment: their name up top,
 * RelayTrack only as a small "powered by" footer (SPEC section 4).
 */

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getTrackingProjection(token);

  if (result.kind === "not_found") {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col p-6">
      {result.kind === "expired" ? (
        <>
          <h1 className="font-display text-xl">Tracking link expired</h1>
          <p className="mt-2 text-sm text-neutral-500">
            This delivery was completed more than 24 hours ago, so its tracking
            link is no longer active.
          </p>
        </>
      ) : (
        <>
          <header className="mb-6">
            <h1 className="font-display text-2xl">{result.projection.orgName}</h1>
            {result.projection.reference ? (
              <p className="mt-1 text-sm text-neutral-500">
                Order {result.projection.reference}
                {result.projection.dropoff.address
                  ? ` · ${result.projection.dropoff.address}`
                  : ""}
              </p>
            ) : null}
          </header>
          <TrackingLive token={token} initial={result.projection} />
        </>
      )}

      <footer className="mt-auto pt-10 text-center text-xs text-neutral-300">
        Powered by RelayTrack
      </footer>
    </main>
  );
}

// Public customer tracking page. No auth — validated by signed token, server-side only.
// Read-only projection: never expose rider phone, other orders, or raw table rows.
// Phase 5.

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // TODO Phase 5: validateTrackingToken(token) -> order projection or notFound()
  void token;
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="font-display text-xl">Tracking</h1>
      <p className="mt-2 text-sm opacity-60">
        Live map, status timeline, ETA, honest freshness label. Phase 5.
      </p>
    </main>
  );
}

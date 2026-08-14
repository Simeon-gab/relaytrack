import { createClient } from "@/lib/supabase/server";

// Phase 1: proves auth + RLS — the rider sees only their own rider row and
// delivery count. The real delivery list / GPS / ePOD UI is Phase 3 + 6.
export default async function RiderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware guarantees a session here; user is non-null.
  const { data: rider } = await supabase
    .from("riders")
    .select("id,name,status")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const { count } = rider
    ? await supabase
        .from("deliveries")
        .select("id", { count: "exact", head: true })
        .eq("rider_id", rider.id)
    : { count: null };

  return (
    <main className="p-6">
      <h1 className="font-display text-xl">Rider</h1>
      {rider ? (
        <div className="mt-4 rounded border border-neutral-200 p-4">
          <p className="text-lg font-medium">{rider.name}</p>
          <p className="mt-1 text-sm opacity-60">
            Status: {rider.status} · Deliveries assigned: {count ?? 0}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm opacity-60">
          Signed in, but no rider profile is linked to this account. Ask your
          dispatcher to invite you.
        </p>
      )}
      <p className="mt-4 text-sm opacity-60">
        Delivery list, GPS streaming and ePOD arrive in Phase 3 + 6.
      </p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button type="submit" className="rounded border border-neutral-300 px-4 py-2 text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}

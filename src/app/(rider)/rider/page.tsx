import { createClient } from "@/lib/supabase/server";
import { DeliveryCard, type RiderDelivery } from "./delivery-card";
import { Tracker } from "./tracker";

// Phase 3: the rider's working screen. Thumb-first, one primary action per
// delivery. GPS streams only while a delivery is in transit (battery rule).
export default async function RiderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rider } = await supabase
    .from("riders")
    .select("id,name,status")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!rider) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="font-display text-xl">Rider</h1>
        <p className="mt-4 text-sm opacity-60">
          Signed in, but no rider profile is linked to this account. Ask your
          dispatcher to invite you.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="rounded border border-neutral-300 px-4 py-2 text-sm">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  const { data } = await supabase
    .from("deliveries")
    .select(
      "id,assigned_at,picked_up_at,delivered_at,failed_at,orders(id,reference,status,dropoff_address,cod_amount,notes)",
    )
    .eq("rider_id", rider.id)
    .order("assigned_at", { ascending: false })
    .limit(20);

  const deliveries: RiderDelivery[] = (data ?? []).filter(
    (d): d is RiderDelivery => d.orders !== null,
  );
  const active = deliveries.filter((d) =>
    ["assigned", "picked_up", "in_transit"].includes(d.orders.status),
  );
  const done = deliveries.filter(
    (d) => !["assigned", "picked_up", "in_transit"].includes(d.orders.status),
  );
  const inTransit = active.find((d) => d.orders.status === "in_transit");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pb-16">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-xl">{rider.name}</h1>
          <p className="text-sm opacity-60">
            {active.length} active deliver{active.length === 1 ? "y" : "ies"}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded border border-neutral-300 px-3 py-1.5 text-sm">
            Sign out
          </button>
        </form>
      </header>

      <Tracker activeDeliveryId={inTransit?.id ?? null} />

      {active.length === 0 ? (
        <p className="rounded border border-neutral-200 p-6 text-center text-sm opacity-60">
          No deliveries assigned right now. New jobs appear here automatically.
        </p>
      ) : (
        active.map((d) => <DeliveryCard key={d.id} delivery={d} />)
      )}

      {done.length > 0 ? (
        <section>
          <h2 className="mt-2 text-sm font-medium opacity-60">Earlier</h2>
          <div className="mt-2 flex flex-col gap-2">
            {done.map((d) => (
              <DeliveryCard key={d.id} delivery={d} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

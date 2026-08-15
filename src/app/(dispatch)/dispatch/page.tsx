import { createClient } from "@/lib/supabase/server";
import { DispatchMap } from "@/components/map/dispatch-map";
import { NewOrderForm } from "./new-order-form";
import { OrderCard } from "./order-card";
import type { QueueOrder, RiderOption, CustomerOption } from "./queue-types";
import { parseLastPosition, type LiveRider, type OrderPin } from "./map-types";
import type { TrackSample } from "@/lib/geo/exceptions";

// Phase 4: live ops screen — map is the surface (70% of viewport), order
// queue in the left rail, exceptions overlay the map (SPEC section 4).

const TRACK_WINDOW_MINUTES = 15;
const ACTIVE_ORDER_STATUSES = ["pending", "assigned", "picked_up", "in_transit"] as const;

export default async function DispatchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id,orgs(name)")
    .eq("user_id", user?.id ?? "")
    .limit(1)
    .maybeSingle();
  const orgId = membership?.org_id ?? null;

  const trackCutoff = new Date(Date.now() - TRACK_WINDOW_MINUTES * 60_000).toISOString();

  const [ordersRes, ridersRes, customersRes, deliveriesRes, locationsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,reference,status,dropoff_address,dropoff_lat,dropoff_lng,cod_amount,created_at,customers(name,phone),deliveries(id,riders(id,name))",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("riders")
      .select("id,name,status,last_position")
      .eq("active", true)
      .order("name"),
    supabase
      .from("customers")
      .select("name,phone,default_address")
      .order("created_at", { ascending: false })
      .limit(200),
    // Dropoff of each rider's active delivery — feeds the off-route heuristic.
    supabase
      .from("deliveries")
      .select("rider_id,orders!inner(status,dropoff_lat,dropoff_lng)")
      .in("orders.status", ["assigned", "picked_up", "in_transit"]),
    // Recent movement history so stalled/off-route judge from real data on
    // first paint, not from an empty client-side buffer. Time-bounded — this
    // table grows fastest (SPEC section 3).
    supabase
      .from("rider_locations")
      .select("rider_id,lat,lng,accuracy,captured_at")
      .gte("captured_at", trackCutoff)
      .lte("accuracy", 100)
      .order("captured_at", { ascending: true })
      .limit(2000),
  ]);

  const orders: QueueOrder[] = ordersRes.data ?? [];
  const riderOptions: RiderOption[] = (ridersRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const customers: CustomerOption[] = customersRes.data ?? [];

  const dropoffByRider = new Map<string, { lat: number; lng: number }>();
  for (const d of deliveriesRes.data ?? []) {
    const { dropoff_lat, dropoff_lng } = d.orders;
    if (dropoff_lat != null && dropoff_lng != null) {
      dropoffByRider.set(d.rider_id, { lat: dropoff_lat, lng: dropoff_lng });
    }
  }

  const initialTracks: Record<string, TrackSample[]> = {};
  for (const point of locationsRes.data ?? []) {
    (initialTracks[point.rider_id] ??= []).push({
      lat: point.lat,
      lng: point.lng,
      at: point.captured_at,
    });
  }

  const initialRiders: LiveRider[] = (ridersRes.data ?? []).map((r) => {
    const position = parseLastPosition(r.last_position);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      position: position ? { lat: position.lat, lng: position.lng, at: position.at } : null,
      accuracy: position?.accuracy ?? null,
      dropoff: dropoffByRider.get(r.id) ?? null,
    };
  });

  const orderPins: OrderPin[] = orders
    .filter(
      (o): o is QueueOrder & { dropoff_lat: number; dropoff_lng: number } =>
        (ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status) &&
        o.dropoff_lat != null &&
        o.dropoff_lng != null,
    )
    .map((o) => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      customerName: o.customers?.name ?? null,
      lat: o.dropoff_lat,
      lng: o.dropoff_lng,
    }));

  return (
    <main className="flex h-screen overflow-hidden">
      {/* Left rail: queue + order entry. ~30% — the map owns the rest. */}
      <aside className="flex w-[30%] min-w-[340px] max-w-[420px] flex-col border-r border-neutral-800">
        <header className="flex items-baseline justify-between border-b border-neutral-800 p-4">
          <div>
            <h1 className="font-display text-lg">Dispatch</h1>
            <p className="text-sm text-neutral-400">
              {membership?.orgs?.name ?? "No organisation"}
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300"
            >
              Sign out
            </button>
          </form>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <details className="mb-4 rounded border border-neutral-800">
            <summary className="cursor-pointer select-none p-3 text-sm text-neutral-200">
              New order
            </summary>
            <div className="border-t border-neutral-800 p-3">
              <NewOrderForm customers={customers} />
            </div>
          </details>

          <section aria-label="Order queue" className="flex flex-col gap-3">
            {orders.length === 0 ? (
              <p className="rounded border border-neutral-800 p-6 text-sm text-neutral-400">
                No orders yet — create your first order above.
              </p>
            ) : (
              orders.map((order) => (
                <OrderCard key={order.id} order={order} riders={riderOptions} />
              ))
            )}
          </section>
        </div>
      </aside>

      <section aria-label="Live map" className="min-w-0 flex-1">
        {orgId ? (
          <DispatchMap
            orgId={orgId}
            initialRiders={initialRiders}
            initialTracks={initialTracks}
            orderPins={orderPins}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-neutral-400">No organisation membership.</p>
          </div>
        )}
      </section>
    </main>
  );
}

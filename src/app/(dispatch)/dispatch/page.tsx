import { createClient } from "@/lib/supabase/server";
import { NewOrderForm } from "./new-order-form";
import { OrderCard } from "./order-card";
import type { QueueOrder, RiderOption, CustomerOption } from "./queue-types";

// Phase 2: order queue + CRUD. The live map takes over this layout in Phase 4.
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

  const [ordersRes, ridersRes, customersRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,reference,status,dropoff_address,cod_amount,created_at,customers(name,phone),deliveries(id,riders(id,name))",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("riders").select("id,name").eq("active", true).order("name"),
    supabase
      .from("customers")
      .select("name,phone,default_address")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const orders: QueueOrder[] = ordersRes.data ?? [];
  const riders: RiderOption[] = ridersRes.data ?? [];
  const customers: CustomerOption[] = customersRes.data ?? [];

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-xl">Dispatch</h1>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <NewOrderForm customers={customers} />

        <section aria-label="Order queue" className="flex flex-col gap-3">
          {orders.length === 0 ? (
            <p className="rounded border border-neutral-800 p-6 text-sm text-neutral-400">
              No orders yet — create your first order on the left.
            </p>
          ) : (
            orders.map((order) => (
              <OrderCard key={order.id} order={order} riders={riders} />
            ))
          )}
        </section>
      </div>
    </main>
  );
}

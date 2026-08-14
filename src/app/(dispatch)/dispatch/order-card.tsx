"use client";

import { useState, useTransition } from "react";
import { assignRider, transitionOrder } from "./actions";
import type { QueueOrder, RiderOption } from "./queue-types";
import type { Enums } from "@/types/database";

type OrderStatus = Enums<"order_status">;

// Status → visual. Amber only for in-flight, green only for delivered,
// red only for failed (SPEC section 4: never decorative red).
const badgeClass: Record<OrderStatus, string> = {
  pending: "border-neutral-600 text-neutral-300",
  assigned: "border-neutral-400 text-neutral-100",
  picked_up: "border-transit text-transit",
  in_transit: "border-transit text-transit",
  delivered: "border-success text-success",
  failed: "border-danger text-danger",
  cancelled: "border-neutral-700 text-neutral-500",
};

const buttonClass =
  "rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

export function OrderCard({
  order,
  riders,
}: {
  order: QueueOrder;
  riders: RiderOption[];
}) {
  const [riderId, setRiderId] = useState("");
  const [failReason, setFailReason] = useState("");
  const [showFail, setShowFail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong");
      else {
        setShowFail(false);
        setFailReason("");
      }
    });
  }

  const transition = (status: "picked_up" | "in_transit" | "delivered" | "cancelled") =>
    run(() => transitionOrder({ orderId: order.id, status }));

  return (
    <article className="rounded border border-neutral-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {order.customers?.name ?? "Unknown customer"}
            {order.reference ? (
              <span className="ml-2 text-sm font-normal text-neutral-400">
                {order.reference}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-sm text-neutral-400">
            {order.dropoff_address}
          </p>
          <p className="mt-0.5 text-sm text-neutral-500">
            {order.customers?.phone}
            {order.cod_amount != null ? (
              <span className="ml-2 font-display text-neutral-300">
                COD ₦{Number(order.cod_amount).toLocaleString()}
              </span>
            ) : null}
            {order.deliveries?.riders ? (
              <span className="ml-2">· {order.deliveries.riders.name}</span>
            ) : null}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 font-display text-xs ${badgeClass[order.status]}`}
        >
          {order.status.replace("_", " ")}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {order.status === "pending" ? (
          <>
            <select
              aria-label="Assign rider"
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200"
            >
              <option value="">Select rider…</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !riderId}
              onClick={() => run(() => assignRider({ orderId: order.id, riderId }))}
              className={buttonClass}
            >
              Assign
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("cancelled")}
              className={buttonClass}
            >
              Cancel
            </button>
          </>
        ) : null}

        {order.status === "assigned" ? (
          <>
            <button type="button" disabled={pending} onClick={() => transition("picked_up")} className={buttonClass}>
              Picked up
            </button>
            <button type="button" disabled={pending} onClick={() => setShowFail((v) => !v)} className={buttonClass}>
              Fail…
            </button>
            <button type="button" disabled={pending} onClick={() => transition("cancelled")} className={buttonClass}>
              Cancel
            </button>
          </>
        ) : null}

        {order.status === "picked_up" || order.status === "in_transit" ? (
          <>
            {order.status === "picked_up" ? (
              <button type="button" disabled={pending} onClick={() => transition("in_transit")} className={buttonClass}>
                In transit
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => transition("delivered")} className={buttonClass}>
              Delivered
            </button>
            <button type="button" disabled={pending} onClick={() => setShowFail((v) => !v)} className={buttonClass}>
              Fail…
            </button>
          </>
        ) : null}
      </div>

      {showFail ? (
        <div className="mt-2 flex gap-2">
          <input
            aria-label="Failure reason"
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
            placeholder="Failure reason (required)"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <button
            type="button"
            disabled={pending || failReason.trim().length === 0}
            onClick={() =>
              run(() =>
                transitionOrder({
                  orderId: order.id,
                  status: "failed",
                  reason: failReason.trim(),
                }),
              )
            }
            className="rounded border border-danger px-3 py-1.5 text-sm text-danger disabled:opacity-50"
          >
            Confirm fail
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </article>
  );
}

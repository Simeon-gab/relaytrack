"use client";

import { useState, useTransition } from "react";
import { riderTransition } from "./actions";
import type { Enums } from "@/types/database";

export interface RiderDelivery {
  id: string;
  assigned_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  orders: {
    id: string;
    reference: string | null;
    status: Enums<"order_status">;
    dropoff_address: string;
    cod_amount: number | null;
    notes: string | null;
  };
}

// Thumb-first: one big primary action per state, min 56px targets.
const primaryButton =
  "min-h-14 w-full rounded bg-base px-4 text-lg font-medium text-white disabled:opacity-50";

export function DeliveryCard({ delivery }: { delivery: RiderDelivery }) {
  const order = delivery.orders;
  const [error, setError] = useState<string | null>(null);
  const [showFail, setShowFail] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [pending, startTransition] = useTransition();

  function transition(status: "picked_up" | "in_transit" | "delivered" | "failed") {
    setError(null);
    startTransition(async () => {
      const result = await riderTransition({
        orderId: order.id,
        status,
        ...(status === "failed" ? { reason: failReason.trim() } : {}),
      });
      if (!result.ok) setError(result.error);
      else {
        setShowFail(false);
        setFailReason("");
      }
    });
  }

  const isActive = ["assigned", "picked_up", "in_transit"].includes(order.status);

  return (
    <article
      className={`rounded border p-4 ${isActive ? "border-neutral-300" : "border-neutral-200 opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-medium leading-snug">{order.dropoff_address}</p>
        <span className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 font-display text-xs">
          {order.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-1 text-sm opacity-70">
        {order.reference ?? "No reference"}
        {order.cod_amount != null ? (
          <span className="ml-2 font-display font-medium">
            Collect ₦{Number(order.cod_amount).toLocaleString()}
          </span>
        ) : null}
      </p>
      {order.notes ? <p className="mt-1 text-sm opacity-70">{order.notes}</p> : null}

      {isActive ? (
        <div className="mt-4 flex flex-col gap-2">
          {order.status === "assigned" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("picked_up")}
              className={primaryButton}
            >
              Picked up
            </button>
          ) : null}
          {order.status === "picked_up" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("in_transit")}
              className={primaryButton}
            >
              Start delivery
            </button>
          ) : null}
          {order.status === "in_transit" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("delivered")}
              className={`${primaryButton} bg-success`}
            >
              Delivered
            </button>
          ) : null}

          {order.status !== "assigned" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowFail((v) => !v)}
              className="min-h-11 rounded border border-neutral-300 px-4 text-sm"
            >
              Can&apos;t deliver…
            </button>
          ) : null}

          {showFail ? (
            <div className="flex flex-col gap-2">
              <input
                aria-label="Failure reason"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                placeholder="What went wrong? (required)"
                className="rounded border border-neutral-300 px-3 py-3"
              />
              <button
                type="button"
                disabled={pending || failReason.trim().length === 0}
                onClick={() => transition("failed")}
                className="min-h-11 rounded border border-danger px-4 text-sm text-danger disabled:opacity-50"
              >
                Mark as failed
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </article>
  );
}

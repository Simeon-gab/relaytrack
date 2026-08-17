"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, LngLatBounds } from "maplibre-gl";
import type { TrackingProjection } from "@/lib/tracking/projection";

/**
 * Live portion of the customer tracking page. Polls the projection endpoint
 * every 10s — the customer page has no Supabase session, so Realtime is not
 * an option here (SPEC section 3: tracking never touches tables directly);
 * a 10s poll of the token-authenticated projection is the honest equivalent.
 *
 * Map rules match the dispatch surface (src/components/map/README.md):
 * interpolated marker movement, and past 90s of silence the dot stops
 * pretending — "last seen Xm ago" instead (freshness honesty, SPEC sec 2).
 */

const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 10_000;
const ANIMATE_MS = 900;
const TICK_MS = 5_000;

const STATUS_HEADLINE: Record<string, string> = {
  pending: "Order received",
  assigned: "A rider has been assigned",
  picked_up: "Your order has been picked up",
  in_transit: "Your order is on its way",
  delivered: "Delivered",
  failed: "Delivery failed",
  cancelled: "Order cancelled",
};

const TIMELINE_LABEL: Record<string, string> = {
  assigned: "Rider assigned",
  picked_up: "Picked up",
  nearby: "Rider nearby",
  delivered: "Delivered",
  failed: "Delivery failed",
};

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export function TrackingLive({ token, initial }: { token: string; initial: TrackingProjection }) {
  const [projection, setProjection] = useState<TrackingProjection>(initial);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const riderMarkerRef = useRef<{ marker: Marker; dot: HTMLSpanElement; label: HTMLSpanElement } | null>(null);
  const animationRef = useRef<number | null>(null);

  // Poll the projection. Stop entirely once the order reaches a terminal
  // state — nothing left to move.
  useEffect(() => {
    const terminal = ["delivered", "failed", "cancelled"].includes(projection.status);
    if (terminal) return;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/track/${token}`, { cache: "no-store" });
          if (res.status === 410) {
            setExpired(true);
            return;
          }
          if (!res.ok) return;
          setProjection((await res.json()) as TrackingProjection);
        } catch {
          // network blip — next poll retries
        }
      })();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [token, projection.status]);

  // Freshness label ticker.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Map bootstrap.
  useEffect(() => {
    if (!containerRef.current) return;
    const hasDrop = initial.dropoff.lat !== null && initial.dropoff.lng !== null;
    const center: [number, number] = hasDrop
      ? [initial.dropoff.lng as number, initial.dropoff.lat as number]
      : [3.3792, 6.5244];
    const map = new MapLibreMap({
      container: containerRef.current,
      style: LIGHT_STYLE_URL,
      center,
      zoom: 13,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => {
      if (hasDrop) {
        const pin = document.createElement("div");
        pin.className = "rt-order-pin rt-light";
        pin.style.setProperty("--pin-color", "#16a34a");
        new Marker({ element: pin })
          .setLngLat([initial.dropoff.lng as number, initial.dropoff.lat as number])
          .addTo(map);
      }
      setMapReady(true);
    });
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      riderMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rider marker follows the projection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const position = projection.rider?.position ?? null;
    if (!position) return;

    const stale = now - Date.parse(position.at) > projection.staleAfterMs;
    const target: [number, number] = [position.lng, position.lat];

    let riderMarker = riderMarkerRef.current;
    if (!riderMarker) {
      const el = document.createElement("div");
      el.className = "rt-rider rt-light";
      const dot = document.createElement("span");
      dot.className = "rt-rider-dot";
      const label = document.createElement("span");
      label.className = "rt-rider-label";
      el.append(dot, label);
      riderMarker = { marker: new Marker({ element: el }).setLngLat(target).addTo(map), dot, label };
      riderMarkerRef.current = riderMarker;

      if (projection.dropoff.lat !== null && projection.dropoff.lng !== null) {
        const bounds = new LngLatBounds();
        bounds.extend(target);
        bounds.extend([projection.dropoff.lng, projection.dropoff.lat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
    }

    riderMarker.dot.style.backgroundColor = stale ? "#737373" : "#d97706";
    riderMarker.marker.getElement().classList.toggle("rt-stale", stale);
    riderMarker.label.textContent = projection.rider?.name ?? "";

    const current = riderMarker.marker.getLngLat();
    if (stale) {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      riderMarker.marker.setLngLat(target);
    } else if (current.lng !== target[0] || current.lat !== target[1]) {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      const from: [number, number] = [current.lng, current.lat];
      const start = performance.now();
      const step = (t: number): void => {
        const progress = Math.min(1, (t - start) / ANIMATE_MS);
        riderMarker.marker.setLngLat([
          from[0] + (target[0] - from[0]) * progress,
          from[1] + (target[1] - from[1]) * progress,
        ]);
        animationRef.current = progress < 1 ? requestAnimationFrame(step) : null;
      };
      animationRef.current = requestAnimationFrame(step);
    }
  }, [projection, mapReady, now]);

  if (expired) {
    return (
      <p className="rounded border border-neutral-200 p-6 text-sm text-neutral-500">
        This tracking link has expired.
      </p>
    );
  }

  const position = projection.rider?.position ?? null;
  const positionAgeMs = position ? now - Date.parse(position.at) : null;
  const isStale = positionAgeMs !== null && positionAgeMs > projection.staleAfterMs;
  const active = ["assigned", "picked_up", "in_transit"].includes(projection.status);

  return (
    <div className="flex flex-col gap-4">
      {/* Status headline + ETA */}
      <div>
        <p className="font-display text-lg">
          {STATUS_HEADLINE[projection.status] ?? projection.status}
        </p>
        {projection.etaMinutes !== null && active ? (
          <p className="text-sm text-neutral-500">
            Estimated arrival in about {projection.etaMinutes} min
          </p>
        ) : null}
      </div>

      {/* Live map — skeleton while loading, never a spinner (SPEC section 4). */}
      {active || projection.status === "delivered" ? (
        <div className="relative h-72 overflow-hidden rounded border border-neutral-200">
          <div ref={containerRef} className="h-full w-full" />
          {!mapReady ? (
            <div className="absolute inset-0 animate-pulse bg-neutral-100">
              <div className="absolute left-3 top-3 h-3 w-32 rounded bg-neutral-200" />
            </div>
          ) : null}
          {/* Freshness honesty */}
          {active ? (
            <div className="absolute left-3 top-3 z-10 rounded bg-white/90 px-2 py-1 text-xs text-neutral-600 shadow-sm">
              {position === null
                ? "Waiting for rider location…"
                : isStale
                  ? `Last seen ${formatAge(positionAgeMs ?? 0)}`
                  : "Live"}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Status timeline */}
      <ol className="flex flex-col gap-2" aria-label="Delivery timeline">
        {projection.timeline.length === 0 ? (
          <li className="text-sm text-neutral-400">Waiting for updates…</li>
        ) : (
          projection.timeline.map((entry) => (
            <li key={entry.key} className="flex items-baseline gap-3">
              <span
                className={`inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${
                  entry.key === "failed" ? "bg-danger" : entry.key === "delivered" ? "bg-success" : "bg-transit"
                }`}
              />
              <span className="text-sm">{TIMELINE_LABEL[entry.key] ?? entry.key}</span>
              <time
                className="ml-auto text-xs text-neutral-400"
                title={new Date(entry.at).toLocaleString()}
                dateTime={entry.at}
              >
                {formatAge(now - Date.parse(entry.at))}
              </time>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

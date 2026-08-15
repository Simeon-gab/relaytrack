"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  NavigationControl,
  type ErrorEvent as MapErrorEvent,
} from "maplibre-gl";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  deriveExceptions,
  pruneTrack,
  type RiderException,
  type TrackSample,
} from "@/lib/geo/exceptions";
import {
  parseLastPosition,
  type LiveRider,
  type OrderPin,
} from "@/app/(dispatch)/dispatch/map-types";
import type { Enums } from "@/types/database";

/**
 * Dispatch live map (SPEC section 5, Phase 4).
 *
 * Provider: MapLibre GL + OpenFreeMap (OSM) tiles — free, keyless, no billing
 * account to protect. Deviation from SPEC section 2 (Google) recorded in
 * PROGRESS.md decisions log; Google remains the paid upgrade path and this
 * component is the only file that knows which map SDK is underneath.
 *
 * Realtime subscription on `riders` (RLS-scoped by org on the wire) drives
 * marker movement — no polling, no refresh. Client rules from
 * src/components/map/README.md:
 *  - interpolate markers between pings (no teleporting dots)
 *  - discard accuracy > 100m before the map (server filters too — belt and braces)
 *  - last ping > 90s old: stop animating, show "last seen Xm" instead
 * Exceptions are re-derived every tick from the observed track, so they fire
 * AND clear without any stored alert state.
 */

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const LAGOS: [number, number] = [3.3792, 6.5244]; // lng, lat
const TRACK_WINDOW_MS = 15 * 60_000;
const STALE_AFTER_MS = 90_000;
const TICK_MS = 5_000;
const ANIMATE_MS = 900;
const MAX_ACCURACY_M = 100;

const STATUS_COLOR: Record<Enums<"rider_status">, string> = {
  on_delivery: "#D97706",
  available: "#16A34A",
  offline: "#6b7280",
};

const ORDER_COLOR: Record<string, string> = {
  pending: "#737373",
  assigned: "#e5e5e5",
  picked_up: "#D97706",
  in_transit: "#D97706",
};

const EXCEPTION_TITLE: Record<RiderException["type"], string> = {
  offline: "Rider offline",
  stalled: "Rider stalled",
  off_route: "Off route",
};

/** Realtime payload boundary — parse, never cast (SPEC rule 5). */
const riderChangeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["offline", "available", "on_delivery"]),
  last_position: z.unknown().nullable().optional(),
});

interface RiderLive {
  meta: LiveRider;
  samples: TrackSample[];
}

interface RiderMarker {
  marker: Marker;
  dot: HTMLSpanElement;
  label: HTMLSpanElement;
}

function buildRiderMarker(map: MapLibreMap, at: [number, number]): RiderMarker {
  const el = document.createElement("div");
  el.className = "rt-rider";
  const dot = document.createElement("span");
  dot.className = "rt-rider-dot";
  const label = document.createElement("span");
  label.className = "rt-rider-label";
  el.append(dot, label);
  const marker = new Marker({ element: el }).setLngLat(at).addTo(map);
  return { marker, dot, label };
}

function addOrderPin(map: MapLibreMap, pin: OrderPin): Marker {
  const el = document.createElement("div");
  el.className = "rt-order-pin";
  // MapLibre owns the element's inline transform (positioning), so the
  // rotated diamond is a ::before that reads this custom property.
  el.style.setProperty("--pin-color", ORDER_COLOR[pin.status] ?? "#737373");
  el.title = [pin.reference ?? "Order", pin.customerName, pin.status].filter(Boolean).join(" · ");
  return new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map);
}

export function DispatchMap({
  orgId,
  initialRiders,
  initialTracks,
  orderPins,
}: {
  orgId: string;
  initialRiders: LiveRider[];
  initialTracks: Record<string, TrackSample[]>;
  orderPins: OrderPin[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, RiderMarker>>(new Map());
  const animationsRef = useRef<Map<string, number>>(new Map());
  const ridersRef = useRef<Map<string, RiderLive>>(new Map());

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<RiderException[]>([]);
  const [riderCount, setRiderCount] = useState({ online: 0, total: initialRiders.length });

  // Seed / merge server state. Runs again after revalidatePath (assignments,
  // transitions) — keep the fresher of server vs live-observed position.
  useEffect(() => {
    const riders = ridersRef.current;
    const seen = new Set<string>();
    for (const rider of initialRiders) {
      seen.add(rider.id);
      const existing = riders.get(rider.id);
      const history = (initialTracks[rider.id] ?? []).filter((s) => samplesOk(s));
      if (!existing) {
        const samples = [...history];
        if (rider.position) pushSample(samples, rider.position);
        riders.set(rider.id, { meta: rider, samples });
      } else {
        existing.meta = {
          ...rider,
          position: newest(existing.meta.position, rider.position),
        };
        if (rider.position) pushSample(existing.samples, rider.position);
      }
    }
    for (const id of [...riders.keys()]) if (!seen.has(id)) riders.delete(id);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRiders, initialTracks]);

  // Map bootstrap.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: LAGOS,
      zoom: 11.5,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      for (const pin of orderPins) addOrderPin(map, pin);

      const bounds = new LngLatBounds();
      let hasPoint = false;
      for (const pin of orderPins) {
        bounds.extend([pin.lng, pin.lat]);
        hasPoint = true;
      }
      for (const { meta } of ridersRef.current.values()) {
        if (meta.position) {
          bounds.extend([meta.position.lng, meta.position.lat]);
          hasPoint = true;
        }
      }
      if (hasPoint) map.fitBounds(bounds, { padding: 80, maxZoom: 14 });

      setReady(true);
      refresh();
    });
    map.on("error", (event: MapErrorEvent) => {
      // Tile hiccups are routine; only surface a failure to render at all.
      if (!mapRef.current || mapRef.current.isStyleLoaded()) return;
      setMapError(event.error?.message ?? "Map failed to load");
    });

    return () => {
      for (const handle of animationsRef.current.values()) cancelAnimationFrame(handle);
      animationsRef.current.clear();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: riders table changes for this org only.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`riders-live-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "riders", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const parsed = riderChangeSchema.safeParse(payload.new);
          if (!parsed.success) return;
          const riders = ridersRef.current;
          const existing = riders.get(parsed.data.id);
          const position = parseLastPosition(parsed.data.last_position ?? null);
          const sample: TrackSample | null =
            position && position.accuracy <= MAX_ACCURACY_M
              ? { lat: position.lat, lng: position.lng, at: position.at }
              : null;

          if (!existing) {
            riders.set(parsed.data.id, {
              meta: {
                id: parsed.data.id,
                name: parsed.data.name,
                status: parsed.data.status,
                position: sample,
                accuracy: position?.accuracy ?? null,
                dropoff: null,
              },
              samples: sample ? [sample] : [],
            });
          } else {
            existing.meta.name = parsed.data.name;
            existing.meta.status = parsed.data.status;
            if (sample) {
              existing.meta.position = newest(existing.meta.position, sample);
              existing.meta.accuracy = position?.accuracy ?? existing.meta.accuracy;
              pushSample(existing.samples, sample);
            }
          }
          refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Tick: staleness + exception derivation (fire AND clear).
  useEffect(() => {
    const interval = setInterval(refresh, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function samplesOk(sample: TrackSample): boolean {
    return Number.isFinite(sample.lat) && Number.isFinite(sample.lng);
  }

  function newest(a: TrackSample | null, b: TrackSample | null): TrackSample | null {
    if (!a) return b;
    if (!b) return a;
    return Date.parse(b.at) > Date.parse(a.at) ? b : a;
  }

  function pushSample(samples: TrackSample[], sample: TrackSample): void {
    const last = samples[samples.length - 1];
    if (last && last.at === sample.at && last.lat === sample.lat) return;
    samples.push(sample);
    samples.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  }

  /** Re-derive everything visual from ridersRef. Cheap at ≤50 riders. */
  function refresh(): void {
    const now = Date.now();
    const riders = ridersRef.current;
    const map = mapRef.current;

    const nextExceptions: RiderException[] = [];
    let online = 0;

    for (const rider of riders.values()) {
      rider.samples = pruneTrack(rider.samples, now, TRACK_WINDOW_MS);
      const { meta } = rider;
      if (meta.status !== "offline") online += 1;

      nextExceptions.push(
        ...deriveExceptions(
          {
            riderId: meta.id,
            riderName: meta.name,
            status: meta.status,
            samples: rider.samples,
            dropoff: meta.dropoff,
          },
          now,
        ),
      );

      if (!map || !meta.position) continue;
      const ageMs = now - Date.parse(meta.position.at);
      const stale = ageMs > STALE_AFTER_MS;
      const target: [number, number] = [meta.position.lng, meta.position.lat];

      let riderMarker = markersRef.current.get(meta.id);
      if (!riderMarker) {
        riderMarker = buildRiderMarker(map, target);
        markersRef.current.set(meta.id, riderMarker);
      }
      riderMarker.dot.style.backgroundColor = stale ? "#6b7280" : STATUS_COLOR[meta.status];
      riderMarker.marker.getElement().classList.toggle("rt-stale", stale);
      riderMarker.label.textContent = stale
        ? `${meta.name} · last seen ${Math.max(1, Math.round(ageMs / 60_000))}m`
        : meta.name;

      const current = riderMarker.marker.getLngLat();
      if (stale) {
        // Honesty over animation: stale riders never glide.
        cancelAnimation(meta.id);
        riderMarker.marker.setLngLat(target);
      } else if (current.lng !== target[0] || current.lat !== target[1]) {
        animateMarker(meta.id, riderMarker.marker, [current.lng, current.lat], target);
      }
    }

    setExceptions(dedupeExceptions(nextExceptions));
    setRiderCount({ online, total: riders.size });
  }

  function cancelAnimation(riderId: string): void {
    const handle = animationsRef.current.get(riderId);
    if (handle !== undefined) cancelAnimationFrame(handle);
    animationsRef.current.delete(riderId);
  }

  /** Linear interpolation between pings — smooth movement, no teleports. */
  function animateMarker(
    riderId: string,
    marker: Marker,
    from: [number, number],
    to: [number, number],
  ): void {
    cancelAnimation(riderId);
    const start = performance.now();
    const step = (t: number): void => {
      const progress = Math.min(1, (t - start) / ANIMATE_MS);
      marker.setLngLat([
        from[0] + (to[0] - from[0]) * progress,
        from[1] + (to[1] - from[1]) * progress,
      ]);
      if (progress < 1) {
        animationsRef.current.set(riderId, requestAnimationFrame(step));
      } else {
        animationsRef.current.delete(riderId);
      }
    };
    animationsRef.current.set(riderId, requestAnimationFrame(step));
  }

  function dedupeExceptions(list: RiderException[]): RiderException[] {
    const seen = new Set<string>();
    return list.filter((e) => {
      const key = `${e.riderId}:${e.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const showEmptyState = useMemo(
    () => ready && riderCount.total === 0 && orderPins.length === 0,
    [ready, riderCount.total, orderPins.length],
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {!ready && !mapError ? (
        // Skeleton, never a spinner, on map surfaces (SPEC section 4).
        <div className="absolute inset-0 animate-pulse bg-neutral-900">
          <div className="absolute left-4 top-4 h-4 w-40 rounded bg-neutral-800" />
          <div className="absolute left-4 top-12 h-3 w-24 rounded bg-neutral-800" />
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-base">
          <p className="text-sm text-neutral-400">{mapError}</p>
        </div>
      ) : null}

      {/* Exceptions: red-bordered stack, top-right (SPEC section 4). */}
      <div
        aria-live="polite"
        aria-label="Exception alerts"
        className="absolute right-4 top-4 z-10 flex w-72 flex-col gap-2"
      >
        {exceptions.map((e) => (
          <div
            key={`${e.riderId}:${e.type}`}
            className="rounded border border-danger bg-base/90 p-3 backdrop-blur"
          >
            <p className="font-display text-xs uppercase tracking-wide text-danger">
              {EXCEPTION_TITLE[e.type]}
            </p>
            <p className="mt-0.5 text-sm text-neutral-100">{e.riderName}</p>
            <p className="text-xs text-neutral-400">{e.detail}</p>
          </div>
        ))}
      </div>

      {/* Compact legend + live count, bottom-left. */}
      {ready ? (
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded border border-neutral-800 bg-base/90 px-3 py-2 text-xs text-neutral-400 backdrop-blur">
          <span className="font-display text-neutral-200">
            {riderCount.online}/{riderCount.total} riders online
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-success" /> available
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-transit" /> on delivery
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45 bg-neutral-400" /> order
          </span>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="absolute inset-x-0 top-1/3 z-10 mx-auto w-fit rounded border border-neutral-800 bg-base/90 px-4 py-3 text-sm text-neutral-400">
          No riders online — invite your first rider from /admin.
        </div>
      ) : null}
    </div>
  );
}

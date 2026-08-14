"use client";

import { useEffect, useRef, useState } from "react";
import {
  bufferPoint,
  peekBatch,
  deleteBatch,
  pendingCount,
} from "@/lib/rider/buffer";
import { INGEST_LIMITS } from "@/lib/validation/schemas";

/**
 * GPS capture + sync for the active delivery (SPEC section 2 pipeline):
 * watchPosition (high accuracy) throttled to one point per 10s while a
 * delivery is in transit; every point buffered in IndexedDB first; batch
 * POST to /api/ingest/location every 15s or at 10 buffered points,
 * whichever first; buffer drained oldest-first on reconnect. Screen wake
 * lock held while tracking (PWA background GPS is unreliable — the UI says
 * keep the app open).
 */

const CAPTURE_INTERVAL_MS = 10_000;
const SYNC_INTERVAL_MS = 15_000;
const SYNC_POINT_THRESHOLD = 10;
const BATCH_LIMIT = 50;

type TrackerState =
  | { kind: "idle" }
  | { kind: "tracking"; buffered: number; lastSyncAt: number | null }
  | { kind: "error"; message: string };

export function Tracker({ activeDeliveryId }: { activeDeliveryId: string | null }) {
  const [state, setState] = useState<TrackerState>({ kind: "idle" });
  const tokenRef = useRef<string | null>(null);
  const lastCaptureRef = useRef(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!activeDeliveryId) {
      setState({ kind: "idle" });
      return;
    }
    if (!("geolocation" in navigator)) {
      setState({ kind: "error", message: "This phone has no GPS support." });
      return;
    }

    let cancelled = false;
    let wakeLock: WakeLockSentinel | null = null;

    async function refreshBufferedCount() {
      const count = await pendingCount();
      if (!cancelled) {
        setState((prev) => ({
          kind: "tracking",
          buffered: count,
          lastSyncAt: prev.kind === "tracking" ? prev.lastSyncAt : null,
        }));
      }
    }

    async function getToken(): Promise<string | null> {
      if (tokenRef.current) return tokenRef.current;
      try {
        const res = await fetch("/api/rider/token");
        if (!res.ok) return null;
        const data = (await res.json()) as { token: string };
        tokenRef.current = data.token;
        return data.token;
      } catch {
        return null;
      }
    }

    async function sync(force: boolean) {
      if (syncingRef.current || cancelled) return;
      syncingRef.current = true;
      try {
        const count = await pendingCount();
        if (count === 0 || (!force && count < SYNC_POINT_THRESHOLD)) return;
        const token = await getToken();
        if (!token) return;

        // Drain oldest-first until empty or a request fails.
        for (;;) {
          const { keys, points } = await peekBatch(BATCH_LIMIT);
          if (points.length === 0) break;
          const res = await fetch("/api/ingest/location", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              delivery_id: points[0]?.delivery_id ?? null,
              points: points.map(({ delivery_id: _unused, ...p }) => p),
            }),
          });
          if (res.status === 401) {
            tokenRef.current = null; // expired — re-mint next round
            break;
          }
          if (!res.ok) break; // offline/server issue: keep the buffer intact
          await deleteBatch(keys);
          if (!cancelled) {
            setState({
              kind: "tracking",
              buffered: await pendingCount(),
              lastSyncAt: Date.now(),
            });
          }
        }
      } finally {
        syncingRef.current = false;
      }
    }

    function onPosition(position: GeolocationPosition) {
      const nowMs = Date.now();
      if (nowMs - lastCaptureRef.current < CAPTURE_INTERVAL_MS) return;
      lastCaptureRef.current = nowMs;
      const { coords, timestamp } = position;
      // Client-side accuracy filter (spec: discard > 100 m before buffering).
      if (coords.accuracy > INGEST_LIMITS.maxAccuracyMeters) return;
      void bufferPoint({
        delivery_id: activeDeliveryId,
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        speed: coords.speed,
        heading: coords.heading,
        captured_at: new Date(timestamp).toISOString(),
      }).then(async () => {
        await refreshBufferedCount();
        if ((await pendingCount()) >= SYNC_POINT_THRESHOLD) void sync(false);
      });
    }

    const watchId = navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        if (!cancelled && err.code === err.PERMISSION_DENIED) {
          setState({
            kind: "error",
            message: "Location permission is off. Allow location to track this delivery.",
          });
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    const syncTimer = setInterval(() => void sync(true), SYNC_INTERVAL_MS);
    const onOnline = () => void sync(true);
    window.addEventListener("online", onOnline);

    async function acquireWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Not supported / not allowed — the "keep app open" note covers it.
      }
    }
    void acquireWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);

    void refreshBufferedCount();
    void sync(true);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      clearInterval(syncTimer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      void wakeLock?.release().catch(() => undefined);
      // Final flush so a just-delivered order syncs its tail points.
      void sync(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDeliveryId]);

  if (state.kind === "idle") return null;

  if (state.kind === "error") {
    return (
      <p className="rounded border border-danger/50 bg-danger/10 p-3 text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <div className="rounded border border-success/40 bg-success/10 p-3 text-sm">
      <p className="font-medium">
        Tracking on — keep this app open while delivering.
      </p>
      <p className="mt-1 opacity-70">
        {state.buffered} point{state.buffered === 1 ? "" : "s"} waiting to sync
        {state.lastSyncAt
          ? ` · last synced ${new Date(state.lastSyncAt).toLocaleTimeString()}`
          : " · not synced yet"}
      </p>
    </div>
  );
}

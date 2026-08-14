# Phase 3 field tests (require a physical phone)

Two Phase 3 acceptance criteria cannot be verified from a dev machine. Run
both on the cheapest Android you can get hold of (ideally the same model
Hungkee's riders carry) against the production URL, and record the results
here. Phase 3 is not fully accepted until both sections are filled in.

## 1. Airplane-mode test — zero points lost

Goal: with airplane mode toggled mid-delivery, zero points are lost after
reconnect (SPEC Phase 3 acceptance).

1. Sign in as a rider (magic link) at `https://relaytrack.vercel.app/rider`.
2. Have dispatch assign an order; tap **Picked up**, then **Start delivery**.
   The green "Tracking on" banner appears with a buffered-points counter.
3. Walk/ride for ~2 minutes with network on. Note the counter syncing
   (buffered count drops to 0 every ~15s).
4. Enable **airplane mode**. Keep the app open and keep moving ~5 minutes.
   The buffered counter should climb (~6 points/min of movement).
5. Disable airplane mode. Within ~15s (or immediately on the `online` event)
   the buffer should drain to 0.
6. Verify in dispatch/SQL: `select count(*) from rider_locations where
   rider_id = ... and captured_at between <t_airplane_on> and <t_airplane_off>`
   — the offline window must be fully populated (one point per ~10s of
   movement, minus any accuracy>100m discards).

| Date | Device | Offline window | Points buffered | Points stored | Result |
|---|---|---|---|---|---|
| | | | | | |

## 2. Battery test — 1 hour of active tracking

Goal: document (not necessarily pass a threshold) the battery cost of 1 hour
of active tracking (SPEC Phase 3 acceptance).

1. Full-charge the phone, screen brightness ~50%, no other apps in foreground.
2. Start a delivery (**Start delivery**) and keep the app open — the wake
   lock keeps the screen on, which is the realistic worst case.
3. Record battery % at 0, 15, 30, 45, 60 minutes.
4. Note whether the wake lock held (screen stayed on) and whether tracking
   survived any accidental screen-off (known PWA limitation — SPEC section 2).

| Date | Device | 0 min | 15 | 30 | 45 | 60 | Wake lock held? | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

If drain is unacceptable (>25%/hr on the pilot device), the knobs are:
capture interval (10s → 15s), `enableHighAccuracy: false` fallback, and only
then the Phase 9 Capacitor conversation.

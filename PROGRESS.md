# PROGRESS

Update this at the end of every Claude Code session. Phase definitions and acceptance criteria live in `docs/SPEC.md` section 5.

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ Done (2026-08-14) | Live at https://relaytrack.vercel.app — all 4 shells verified, build clean, Next upgraded to 15.5.23 (CVE backport) |
| 1 | Schema + auth + RLS | ✅ Done (2026-08-14) | 11 tables + RLS live, org-isolation + rider-isolation tests pass, seed populates demo org. Awaiting Gabriel's confirmation before Phase 2 |
| 2 | Orders + dispatch CRUD | ✅ Done (2026-08-14) | Full lifecycle verified via UI + DB audit trail. Transitions are atomic Postgres functions (SECURITY INVOKER). Awaiting Gabriel's confirmation before Phase 3 |
| 3 | Rider PWA + location ingest | 🟨 Code complete (2026-08-14) | Auth/validation/storage tests pass; rider lifecycle verified with actor=rider. **Field tests pending on a real phone** — see docs/phase3-field-tests.md (airplane-mode zero-loss + 1hr battery) |
| 4 | Dispatcher live map | ✅ Done (2026-08-17) | Acceptance confirmed on screen by Gabriel: tiles render, both simulated riders live via realtime (no refresh), order pins + legend + pan/zoom working. Exceptions verified fire AND clear on real data (stalled + offline fired during sim gaps, cleared when pings resumed) + 16 unit tests. Realtime org-isolation proven on the wire (positive control). Build + 24 tests green. Root-caused a week of black-map pain to a maplibre-gl v6 frustum regression — see decisions log 2026-08-17 |
| 5 | Tracking page + notifications | 🟨 Code complete (2026-08-17) | All 35 tests pass incl. 11 Phase 5 (exactly-one notification per transition via delivery_events trigger; nearby fires once <500m through real ingest; WA→SMS fallback via cron route; token validity/forgery/24h-expiry/no-phone-leak). Live-verified on sim: /t/[token] shows rider + OSRM ETA, geofence fired on real movement and queued the nearby notification. **Pending for acceptance:** Termii sender-ID approval + API key in env (real SMS send), per-minute cron (Gabriel setting up cron-job.org), and Gabriel's on-screen look at the tracking page. WhatsApp channel decision: SMS-first pilot; Termii-WhatsApp or Meta-direct later |
| 6 | ePOD + COD | ⬜ Not started | |
| 7 | EOD reconciliation + admin | ⬜ Not started | |
| 8 | Webhook outbox + hardening | ⬜ Not started | |
| 9 | Capacitor wrapper | 🚫 Blocked by pilot | Only if PWA GPS fails on Hungkee's Androids |

## Decisions log

Record anything that deviates from the spec, with the reason. The spec is expected to be corrected by reality — but the correction must be written down here.

| Date | Decision | Reason |
|---|---|---|
| 2026-08-14 | Spec amended (Gabriel): QR chain of custody added to Phase 6 (pickup scan + drop scan gating ePOD, reverse-scan as opt-in org setting); multi-leg `tracking_mode` (gps/carrier_api/checkpoint) added to the door-frame list; control tower / carrier APIs explicitly a v2 non-goal | Binds the physical package to the delivery — kills "wrong item" and "never delivered" disputes. Checkpoint scans are the tracking method for legs without GPS. |
| 2026-08-14 | `pods.delivery_id unique` (spec section 3) implemented as partial unique indexes: one root POD per delivery + each POD superseded at most once | Spec contradicts itself — a plain unique on delivery_id would make the "corrections insert superseding row" flow impossible. This keeps immutability AND the correction chain. |
| 2026-08-14 | RLS helper functions live in a `private` schema, not `public` | Supabase security advisor: SECURITY DEFINER helpers in `public` are callable by anon via the REST RPC API. `private` keeps them usable by policies but off the API. |
| 2026-08-15 | Map provider is MapLibre GL + OpenFreeMap (OSM) tiles, not Google Maps (spec section 2) | Free and keyless — no billing account to protect, no key to leak. Only `src/components/map/dispatch-map.tsx` knows which SDK is underneath, so Google stays a contained paid upgrade path. Corollary: Phase 5 geocoding/ETA must come from the OSM family (LocationIQ / Geoapify / Nominatim + OSRM) so tiles and ETAs agree — never mixed with Google. See src/components/map/README.md |
| 2026-08-17 | maplibre-gl pinned to v5 (^5.24.0), down from ^6.3.0 | v6 (all releases 6.0–6.4 tested) produces a degenerate camera frustum on the pilot dev machine (Win11 / Intel Iris Xe / Chrome): every frustum corner collapses to the camera point, so coveringTiles culls every tile — blank map, no errors, `load` never fires. Reproduced with a minimal v6 map outside the app; identical setup on v5.24.0 loads instantly. Root-cause probes: GPU healthy (D3D11 renders fine), math natives intact, transform matrices self-consistent — the defect is in v6's new culling path. Revisit v6 after an upstream fix; consider filing the repro |
| 2026-08-14 | Cron schedules in vercel.json set to daily (`0 0 * * *`) instead of every minute (spec section 2) | Vercel Hobby plan rejects sub-daily crons. Routes are 501 stubs until Phases 5/8 anyway. Must revert to `* * * * *` (requires Pro) before Phase 5 acceptance — outbox sweep cadence is load-bearing for notifications. |

## Planned follow-ups

- UI polish pass across all surfaces after the phased build-out (Gabriel, 2026-08-17) — functional first, then make it look the part

## Open questions

- Working name "RelayTrack" — domain/trademark availability not yet checked
- Pricing bands in SPEC.md section 1 are hypotheses, not validated
- PWA background GPS reliability on the specific Android devices Hungkee's riders use
- Dispatch tab backgrounded >5min: Chrome throttles timers, the realtime heartbeat can starve and the socket drops (markers honestly flip to "last seen Xm"). Unverified whether realtime-js auto-recovers on refocus — check during the Phase 4 eyeball test by tabbing away 10min and back; if it stays dead, add a visibilitychange rejoin guard

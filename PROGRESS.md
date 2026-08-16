# PROGRESS

Update this at the end of every Claude Code session. Phase definitions and acceptance criteria live in `docs/SPEC.md` section 5.

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ Done (2026-08-14) | Live at https://relaytrack.vercel.app — all 4 shells verified, build clean, Next upgraded to 15.5.23 (CVE backport) |
| 1 | Schema + auth + RLS | ✅ Done (2026-08-14) | 11 tables + RLS live, org-isolation + rider-isolation tests pass, seed populates demo org. Awaiting Gabriel's confirmation before Phase 2 |
| 2 | Orders + dispatch CRUD | ✅ Done (2026-08-14) | Full lifecycle verified via UI + DB audit trail. Transitions are atomic Postgres functions (SECURITY INVOKER). Awaiting Gabriel's confirmation before Phase 3 |
| 3 | Rider PWA + location ingest | 🟨 Code complete (2026-08-14) | Auth/validation/storage tests pass; rider lifecycle verified with actor=rider. **Field tests pending on a real phone** — see docs/phase3-field-tests.md (airplane-mode zero-loss + 1hr battery) |
| 4 | Dispatcher live map | 🟨 Code complete (2026-08-16) | Build + all 24 tests pass (16 exception fire/clear cases; realtime org-isolation proven on the wire with positive control). 12-min two-rider sim drove the real authenticated ingest pipeline end-to-end (103 pts/rider stored, last_position current, markers rendered with live labels). **Eyeballs-on-screen check pending** — machine display was asleep during the session, so Chrome froze the tab and suspended rendering; run `npm run dev` + `npm run simulate` with the screen on to watch the markers move (scenarios: `--scenario=stall\|offline\|offroute`) |
| 5 | Tracking page + notifications | ⬜ Not started | |
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
| 2026-08-14 | Cron schedules in vercel.json set to daily (`0 0 * * *`) instead of every minute (spec section 2) | Vercel Hobby plan rejects sub-daily crons. Routes are 501 stubs until Phases 5/8 anyway. Must revert to `* * * * *` (requires Pro) before Phase 5 acceptance — outbox sweep cadence is load-bearing for notifications. |

## Open questions

- Working name "RelayTrack" — domain/trademark availability not yet checked
- Pricing bands in SPEC.md section 1 are hypotheses, not validated
- PWA background GPS reliability on the specific Android devices Hungkee's riders use

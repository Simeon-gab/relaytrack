# PROGRESS

Update this at the end of every Claude Code session. Phase definitions and acceptance criteria live in `docs/SPEC.md` section 5.

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ Done (2026-08-14) | Live at https://relaytrack.vercel.app — all 4 shells verified, build clean, Next upgraded to 15.5.23 (CVE backport) |
| 1 | Schema + auth + RLS | ✅ Done (2026-08-14) | 11 tables + RLS live, org-isolation + rider-isolation tests pass, seed populates demo org. Awaiting Gabriel's confirmation before Phase 2 |
| 2 | Orders + dispatch CRUD | ✅ Done (2026-08-14) | Full lifecycle verified via UI + DB audit trail. Transitions are atomic Postgres functions (SECURITY INVOKER). Awaiting Gabriel's confirmation before Phase 3 |
| 3 | Rider PWA + location ingest | 🟨 Code complete (2026-08-14) | Auth/validation/storage tests pass; rider lifecycle verified with actor=rider. **Field tests pending on a real phone** — see docs/phase3-field-tests.md (airplane-mode zero-loss + 1hr battery) |
| 4 | Dispatcher live map | ✅ Done (2026-08-17) | Acceptance confirmed on screen by Gabriel: tiles render, both simulated riders live via realtime (no refresh), order pins + legend + pan/zoom working. Exceptions verified fire AND clear on real data (stalled + offline fired during sim gaps, cleared when pings resumed) + 16 unit tests. Realtime org-isolation proven on the wire (positive control). Build + 24 tests green. Root-caused a week of black-map pain to a maplibre-gl v6 frustum regression — see decisions log 2026-08-17 |
| 5 | Tracking page + notifications | 🟨 Code complete (2026-08-17) | All 39 tests pass incl. 15 Phase 5 (exactly-one notification per transition via delivery_events trigger; nearby fires once <500m through real ingest; WA→SMS fallback via cron route; token validity/forgery/24h-expiry/no-phone-leak). Live-verified on sim: /t/[token] shows rider + OSRM ETA, geofence fired on real movement and queued the nearby notification. WhatsApp channel decision: SMS-first pilot; Termii-WhatsApp or Meta-direct later. **Cron is live (2026-08-20):** cron-job.org sweeps `/api/cron/notifications` every minute, 200 OK. That 200 also proves the production env is complete — `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `APP_URL` all resolve on the deployed build, since any one missing would 500. **Remaining for acceptance:** Termii sender ID (blocked on a CAC certificate — see decisions log 2026-08-20) and Gabriel's on-screen look at the tracking page |
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
| 2026-08-18 | `NEXT_PUBLIC_APP_URL` renamed to `APP_URL`; the cron route now `requireEnv`s it instead of falling back to `http://localhost:3000` | It is only ever read server-side, so the `NEXT_PUBLIC_` prefix bought nothing and baked the value in at build time (a domain change meant a rebuild). Worse, the localhost fallback failed silently — with the var unset in Vercel, the first real Termii SMS would have sent a customer a link to our own laptop. Now it fails loudly at the first sweep instead. |
| 2026-08-18 | SMS one-segment guarantee moved from tests into `buildMessageText` — org name and reference are sanitized to GSM-7 (extension chars counted as 2 septets) and the org name is trimmed to whatever the 160-char budget leaves, on a word boundary, dropped entirely below 6 chars | The tests only proved the org we happened to pick fits. Org names and references are free text typed by the org: one naira sign drops the limit to 70 and puts every notification for that org at three segments, and a 32-char name spilled to 174. Reference and tracking link are never cut — a wrong order number is a support ticket and a cut link is a dead link, both worse than a second segment. Sized against the longest status clause so the name renders identically across all four messages. |
| 2026-08-18 | Cron sweep's missing-org-name fallback changed from `"Your order"` to `""` | The placeholder rendered as "your Your order order HK-1042". The message reads correctly with no name at all, and the "Powered by RelayTrack" sign-off still identifies the sender. |
| 2026-08-20 | Notification sweep hosted on cron-job.org at `* * * * *`, not Vercel Cron. The two `vercel.json` cron entries are to be deleted rather than left firing a duplicate daily sweep | Vercel Hobby caps cron at once a day; every-minute needs Pro ($20/mo) for a job cron-job.org runs free. Authenticates with the same `Authorization: Bearer ${CRON_SECRET}` header the route already required, so no code change. |
| 2026-08-20 | Sweep interval is 1 minute, not the 5 minutes proposed | Three of the four templates (assigned/picked_up/delivered) are informational and would tolerate 5min. `nearby` would not: it is geofence-triggered at `nearbyRadiusMeters: 500`, which is ~1-3 minutes of riding, so a 5-minute sweep (avg 2.5min latency) commonly lands "arriving soon" after the rider has knocked — worse than not sending, since it trains customers to ignore it. If Vercel invocation quota ever pinches, the fix is 3min sweep + ~1.5km radius together, never a slower sweep alone. |
| 2026-08-20 | Notification timing stays event-driven — no `due_at`/scheduled-send column | The geofence crossing IS the "due now" decision and cannot be wrong, whereas a send-time computed from an ETA inherits the ETA's error (a 30-minute Lagos estimate can be 12 or 50). Everything queued is due immediately by construction; the cron adds only transport latency. |
| 2026-08-14 | Cron schedules in vercel.json set to daily (`0 0 * * *`) instead of every minute (spec section 2) | Vercel Hobby plan rejects sub-daily crons. Routes are 501 stubs until Phases 5/8 anyway. Must revert to `* * * * *` (requires Pro) before Phase 5 acceptance — outbox sweep cadence is load-bearing for notifications. |

## Planned follow-ups

- UI polish pass across all surfaces after the phased build-out (Gabriel, 2026-08-17) — functional first, then make it look the part
- Delete the two cron entries in `vercel.json` (Claude was blocked from removing the file) — they still fire a duplicate daily sweep alongside cron-job.org
- Rotate `CRON_SECRET` — the value was pasted into a Claude Code session on 2026-08-20. Set a new one in Vercel, update the cron-job.org header, redeploy
- Cron 200s take ~2.3s, consistent with a cold start on nearly every invocation. Harmless now; re-check once real sends are flowing

## Open questions

- Working name "RelayTrack" — domain/trademark availability not yet checked
- Pricing bands in SPEC.md section 1 are hypotheses, not validated
- PWA background GPS reliability on the specific Android devices Hungkee's riders use
- Dispatch tab backgrounded >5min: Chrome throttles timers, the realtime heartbeat can starve and the socket drops (markers honestly flip to "last seen Xm"). Unverified whether realtime-js auto-recovers on refocus — check during the Phase 4 eyeball test by tabbing away 10min and back; if it stays dead, add a visibilitychange rejoin guard

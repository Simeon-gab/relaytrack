# PROGRESS

Update this at the end of every Claude Code session. Phase definitions and acceptance criteria live in `docs/SPEC.md` section 5.

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ Done (2026-08-14) | Live at https://relaytrack.vercel.app — all 4 shells verified, build clean, Next upgraded to 15.5.23 (CVE backport) |
| 1 | Schema + auth + RLS | ✅ Done (2026-08-14) | 11 tables + RLS live, org-isolation + rider-isolation tests pass, seed populates demo org. Awaiting Gabriel's confirmation before Phase 2 |
| 2 | Orders + dispatch CRUD | ✅ Done (2026-08-14) | Full lifecycle verified via UI + DB audit trail. Transitions are atomic Postgres functions (SECURITY INVOKER). Awaiting Gabriel's confirmation before Phase 3 |
| 3 | Rider PWA + location ingest | ⬜ Not started | **Make-or-break phase** — offline buffer + battery test |
| 4 | Dispatcher live map | ⬜ Not started | |
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
| 2026-08-14 | Cron schedules in vercel.json set to daily (`0 0 * * *`) instead of every minute (spec section 2) | Vercel Hobby plan rejects sub-daily crons. Routes are 501 stubs until Phases 5/8 anyway. Must revert to `* * * * *` (requires Pro) before Phase 5 acceptance — outbox sweep cadence is load-bearing for notifications. |

## Open questions

- Working name "RelayTrack" — domain/trademark availability not yet checked
- Pricing bands in SPEC.md section 1 are hypotheses, not validated
- PWA background GPS reliability on the specific Android devices Hungkee's riders use

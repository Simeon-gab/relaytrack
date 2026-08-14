# RelayTrack — Complete Build Specification

*Single source of truth for the RelayTrack build. Working name — verify availability before any outbound use. Version 0.1: written before code, expected to be corrected by the Hungkee pilot.*

---

## 0. Execution rules for Claude Code

Read this entire document before writing any code. Then summarize back: the product, the architecture decisions, and the scope of the phase you are about to execute. Flag anything ambiguous or contradictory. Do not write code until Gabriel confirms.

### Hard rules
1. **One phase at a time.** Execute only the current phase from section 5 (Build plan). Stop at its acceptance criteria and report before continuing.
2. **`org_id` on every table. No exceptions.** RLS policies scoped by org membership on every table. This is the SIMON integration contract — violating it is a build failure.
3. **Every inbound endpoint is authenticated.** No unauthenticated POST routes anywhere. Location ingest uses per-rider signed JWTs. Outbound webhooks are HMAC-signed with timestamp for replay protection. (This codebase does not repeat the SIMON WhatsApp webhook mistake.)
4. **Never invent scope.** If something isn't in section 1's v1 scope, don't build it. If a decision is ambiguous, ask — don't assume.
5. **TypeScript strict mode. No `any`.** Zod validation on every API boundary.
6. **Secrets** live in env vars only. Never commit keys. Use Supabase MCP for migrations; never run destructive SQL without confirmation.
7. **Environment:** PowerShell on Windows. Supabase MCP is connected. Deploy target Vercel.

### Definition of done (per phase)
- Acceptance criteria for the phase (section 5) pass
- `npm run build` succeeds with zero type errors
- RLS verified: a user from org A cannot read org B rows (write the test)
- Short summary of what was built + any deviations flagged

---

## 1. Product definition
*Working name. Validate availability before outbound use. One page. This is the source of truth until the pilot proves it wrong.*

---

### One-liner
Delivery operations software for businesses that deliver with their own riders — live tracking, dispute-proof delivery, and automatic customer updates, without a single "where is my order?" call.

### ICP (who buys)
- SME businesses in Nigeria (and later US/UK/CA/AU distributors) running **2–20 of their own riders**
- Verticals: gadget/electronics retail, pharmacies, food & FMCG, parts distributors
- Current state: dispatch runs on WhatsApp voice notes and phone calls; disputes settled by shouting
- Buyer: owner or ops manager. Not couriers, not marketplaces, not enterprise fleets.

### Problem (in the buyer's words)
1. "Rider says delivered, customer says no" — no proof, money lost
2. "Customers call all day asking where their order is" — staff time burned
3. "I don't know where my riders are or what's left undone" — zero visibility
4. "End of day, cash collected doesn't match deliveries" — COD reconciliation is manual

### v1 scope — the five paid modules
1. **ePOD (dispute killer):** photo + GPS stamp + timestamp on every drop, stored against the order. COD amount captured at handoff.
2. **Customer tracking link:** branded live-map page sent by WhatsApp/SMS. Smoothed position, honest "last seen X min ago", live ETA.
3. **Dispatcher dashboard:** all riders + all orders on one live map. Exception alerts: rider stalled, off-route, offline > N minutes.
4. **Automated notifications:** assigned → picked up → nearby (geofence) → delivered. WhatsApp primary, SMS (Termii) fallback.
5. **End-of-day reconciliation:** deliveries completed/failed (with reasons), COD collected vs expected, per-rider summary. The report the owner actually reads.

**Rider app:** PWA first (no app-store friction). GPS ping 5–15s while on delivery, offline buffer + auto-sync, battery-sane sampling, per-rider signed token auth on the ingest endpoint.

### Explicit non-goals (v1)
Route optimization · multi-depot · rider marketplace · native apps · payments processing · SIMON UI integration. Written down so we don't drift.

### Pricing (hypothesis — pilot will correct this)
- Per-rider/month: **₦7,500–₦15,000** local; **$25–$49** Western outbound
- Tiers gate rider count + history retention, never features
- Pilot (Hungkee): free for 60 days in exchange for weekly feedback calls + case-study rights

### SIMON contract (the door frame, not the door)
- `org_id` on every table from day one; multi-tenant schema identical to SIMON's target shape
- Emits signed webhooks: `order.assigned`, `order.picked_up`, `order.delivered`, `order.failed`, `cash.collected`
- That's the entire integration surface for now. Nothing else built until a paying customer asks.

### Pilot plan
1. Ship v1 core to Hungkee riders
2. 2 weeks live: watch what breaks (network gaps, battery, rider behavior)
3. Fix, then first paid customer outside Hungkee
4. RelayTrack Loom demo becomes an outbound asset alongside RelayOps

### Success metrics (60 days)
- ≥ 90% of deliveries have complete ePOD
- "Where is my order" calls down by half (owner-reported)
- COD reconciliation gap explained to zero at EOD
- 1 paying customer beyond Hungkee

### Loom demo skeleton (2 min)
Order comes in → assign rider → customer gets WhatsApp link → live map → geofence "nearby" ping → photo ePOD + COD capture → EOD report. Close on: "and every event can flow straight into your books."

---

## 2. Architecture

### Stack
Next.js App Router + TypeScript · Supabase (Postgres + RLS + Realtime + Auth) · Vercel · WhatsApp Cloud API (primary notifications) · Termii (SMS fallback) · Google Maps JS API (tiles, geocoding, ETA — single provider for everything).

No Redis, no MQTT, no queues in v1. At ≤50 riders per org (≤1 location write/sec/rider) Postgres + Supabase Realtime handles the full pipeline. Revisit only past ~200 concurrent riders platform-wide.

### Four surfaces (one Next.js app, route groups)
1. **`/rider`** — PWA. Rider logs in via magic link, sees assigned deliveries, taps "start", app streams GPS, captures ePOD + COD at drop.
2. **`/dispatch`** — dispatcher dashboard. Live map of all riders + orders, assignment, exception alerts. Supabase Auth (email/password), role `dispatcher`/`owner`.
3. **`/t/[token]`** — public customer tracking page. No login; unguessable signed token per order, expires 24h after delivery. Shows smoothed rider position, ETA, status timeline. Never exposes rider phone or other orders.
4. **`/admin`** — org settings, riders CRUD, EOD reports, CSV export.

### Location pipeline
```
Rider PWA (watchPosition, 10s interval while on active delivery)
  → buffer in IndexedDB (offline-first, always)
  → batch POST /api/ingest/location every 15s or 10 points (whichever first)
      auth: rider JWT · body: [{lat, lng, accuracy, speed, heading, captured_at}]
      server rejects: bad sig, stale batch (>10 min skew), impossible jumps (>150 km/h)
  → insert into rider_locations (history)
  → upsert riders.last_position (live state)
  → Supabase Realtime broadcasts riders table changes → dispatch map + tracking pages
```
- **Battery:** GPS only while a delivery is active. `watchPosition` with `enableHighAccuracy: true`, throttled to 10s. Stop on "delivered".
- **Smoothing:** client-side interpolation on map markers; discard points with accuracy > 100m.
- **Honesty:** if last ping > 90s old, tracking page shows "last seen X min ago" instead of a moving dot.

### Geofencing ("nearby" trigger)
Haversine check in the ingest handler: when distance(rider, dropoff) < 500m and status = `in_transit`, fire `order.nearby` once (flag on delivery row prevents re-fire). PostGIS not needed in v1.

### Notifications
Event-driven from delivery status transitions, via a `notifications` outbox table processed by a Vercel cron (every minute) — not fired inline, so a WhatsApp outage never blocks a status update.
- WhatsApp template messages: assigned, picked_up, nearby, delivered (with tracking link)
- Termii SMS fallback if WhatsApp send fails or customer has no WhatsApp
- All sends logged with provider response for the audit trail.

### ePOD
At drop: photo (compressed client-side ≤500KB, Supabase Storage, org-scoped bucket path), GPS point, device timestamp + server timestamp, COD amount collected (if COD), optional recipient name. Immutable once submitted — corrections create a new record referencing the old.

### SIMON contract (webhook outbox)
`webhook_outbox` table; cron delivers to configured endpoint with `X-Signature: HMAC-SHA256(timestamp + body)` and retries (max 5, exponential backoff). Events: `order.assigned`, `order.picked_up`, `order.delivered`, `order.failed`, `cash.collected`. Nothing else in v1.

### Auth model
- Riders: Supabase Auth magic-link, role `rider`, can only read/write own deliveries + own locations
- Dispatcher/owner/admin: role column on `org_members`
- Customer tracking: signed token in URL, validated server-side, read-only projection (no direct table access)

### Failure modes handled in v1 code
Network loss (IndexedDB buffer + sync) · app backgrounded/killed (resume on reopen, gap shown honestly) · GPS drift (accuracy filter) · clock skew (server timestamp authoritative) · spoofing (per-rider JWT + sanity checks) · WhatsApp outage (outbox retry + SMS fallback).

### Known v1 limitation (accepted)
PWA background GPS is unreliable when the phone screen locks, especially iOS. Mitigation: rider UX says "keep app open while delivering", wake-lock API where supported. If the Hungkee pilot proves this unacceptable on Android, Phase 9 (post-pilot) is a thin native wrapper (Capacitor) — do not build it preemptively.

---

## 3. Database schema

All tables: `id uuid pk default gen_random_uuid()`, `org_id uuid not null references orgs(id)`, `created_at timestamptz default now()`. RLS enabled on every table, scoped through `org_members`. Indexes listed are minimums.

### Core
**orgs** — name, slug, whatsapp_config jsonb, sms_config jsonb, webhook_url, webhook_secret (encrypted via Supabase Vault — not plaintext), settings jsonb

**org_members** — user_id (auth.users), org_id, role enum('owner','dispatcher','admin'), unique(user_id, org_id)

**riders** — org_id, user_id (auth.users, nullable until invited), name, phone, status enum('offline','available','on_delivery'), last_position jsonb {lat,lng,accuracy,at}, active boolean
Index: (org_id, status)

**customers** — org_id, name, phone, default_address text, notes
Index: (org_id, phone)

### Orders & deliveries
**orders** — org_id, customer_id, reference text (org-facing order no.), dropoff_address text, dropoff_lat, dropoff_lng, cod_amount numeric(12,2) null, notes, status enum('pending','assigned','picked_up','in_transit','delivered','failed','cancelled'), tracking_token text unique (signed, generated on create)
Index: (org_id, status), (tracking_token)

**deliveries** — org_id, order_id, rider_id, assigned_at, picked_up_at, nearby_fired_at, delivered_at, failed_at, failure_reason text, unique(order_id) in v1 (one active delivery per order)
Index: (org_id, rider_id, assigned_at desc)

**delivery_events** — org_id, delivery_id, type enum('assigned','picked_up','nearby','delivered','failed','note'), payload jsonb, actor enum('rider','dispatcher','system'), created_at
Append-only audit trail. Index: (delivery_id, created_at)

### Location
**rider_locations** — org_id, rider_id, delivery_id null, lat, lng, accuracy, speed, heading, captured_at (device), received_at (server)
Index: (rider_id, captured_at desc), (delivery_id, captured_at)
Retention: cron deletes rows older than plan's retention window (pilot: 90 days). This table grows fastest — never `select *` without a time bound.

### ePOD & cash
**pods** — org_id, delivery_id unique, photo_path text, lat, lng, captured_at (device), received_at (server), recipient_name text null, cod_collected numeric(12,2) null, immutable (no update policy; corrections insert superseding row with superseded_by)

### Messaging & integration
**notifications** — org_id, order_id, channel enum('whatsapp','sms'), template text, to_phone, status enum('queued','sent','failed'), provider_response jsonb, attempts int, sent_at
Index: (status, created_at) for the cron sweep

**webhook_outbox** — org_id, event_type text, payload jsonb, status enum('queued','delivered','failed'), attempts int, next_attempt_at, delivered_at
Index: (status, next_attempt_at)

### RLS summary
- `org_members` join gates everything for dashboard roles
- Riders: policy limits to rows where `rider_id` maps to their user_id (deliveries, rider_locations inserts, pods inserts); no read access to other riders
- Tracking page & location ingest never query as the anon role against tables directly — they go through route handlers using service role with explicit token/JWT validation. Document this in code comments so it's never "simplified" later.

### Migration rules
- Supabase MCP migrations, one per phase, reversible where possible
- Seed script: demo org + 2 riders + 5 orders for local dev and the Loom demo

---

## 4. Design system

Product personality: operational, trustworthy, fast. This is a tool people stare at while stressed — clarity beats decoration everywhere.

### System
- Typography: Inter (UI) + a single display weight for numbers/status (Space Grotesk). No script fonts.
- Palette: near-black `#0A0A0B` base, white surfaces, one accent — signal green `#16A34A` for delivered/success, amber `#D97706` for in-transit/warnings, red `#DC2626` for failed/exceptions only. Never decorative red.
- Dark mode default on `/dispatch` (control-room feel); light default on customer tracking page (consumer trust).
- Radius 8px, subtle borders over shadows, generous spacing. No gradients, no glassmorphism.

### Per surface
- **/rider (PWA):** thumb-first. One primary action per screen, min 56px touch targets, works one-handed on a bike in sunlight — high contrast, large text. Status changes are big single buttons: "Picked up" → "Delivered". ePOD flow: camera → amount → confirm, three taps max.
- **/dispatch:** map is 70% of viewport, left rail for order queue, exceptions surface as a red-bordered stack top-right. No dashboard-widget clutter — this is a live ops screen, not analytics.
- **/t/[token] (customer):** the org's name and logo prominent — this page is the client's brand moment, not RelayTrack's. Timeline of statuses, map, honest freshness label. RelayTrack appears only as a small "powered by" footer.
- **/admin:** plain, dense tables. Boring is correct here.

### Rules
- Skeleton loaders, never spinners on the map surfaces
- Empty states teach ("No riders online — invite your first rider")
- All timestamps in org's timezone, relative + absolute on hover

---

## 5. Build plan

One phase per Claude Code session. Do not start phase N+1 until phase N acceptance criteria pass and Gabriel confirms.

### Phase 0 — Scaffold
Next.js App Router + TS strict, Supabase client setup, route groups (/rider, /dispatch, /t, /admin), env template, Vercel config, base layout + design tokens from section 4.
**Accept:** builds clean, deploys to Vercel preview, all four route groups render placeholder shells.

### Phase 1 — Schema + auth + RLS
All migrations from section 3. Supabase Auth: dispatcher email/password, rider magic-link invite flow. RLS policies + the org-isolation test.
**Accept:** org A user provably cannot read org B data (test passes); rider can log in and sees only own rows; seed script populates demo org.

### Phase 2 — Orders + dispatch CRUD
Order create (manual entry + customer autocomplete), rider assignment, status transitions with delivery_events audit rows, order queue list in /dispatch.
**Accept:** full lifecycle pending→assigned→picked_up→delivered via UI, every transition writes an audit event, tracking_token generated on order create.

### Phase 3 — Rider PWA + location ingest
Rider delivery list, start/stop delivery, watchPosition capture, IndexedDB buffer, batch POST /api/ingest/location with rider JWT, server-side validation (sig, skew, accuracy, speed sanity), riders.last_position upsert. PWA manifest + wake lock.
**Accept:** with airplane mode toggled mid-delivery, zero points lost after reconnect; spoofed/unsigned POST rejected with 401; battery test — 1hr active tracking documented.

### Phase 4 — Dispatcher live map
Google Maps in /dispatch, Realtime subscription on riders, live markers with smoothing, order pins, exception alerts (offline >5min, stalled >10min, off-route heuristic).
**Accept:** two simulated riders move live on the map without refresh; exceptions fire and clear correctly.

### Phase 5 — Customer tracking page + notifications
/t/[token] page (validate token server-side, 24h post-delivery expiry), status timeline, live map with freshness honesty, ETA via Maps API. Notifications outbox + cron: WhatsApp templates, Termii fallback, geofence "nearby" trigger in the ingest handler.
**Accept:** customer link shows live movement; each status transition sends exactly one notification; WhatsApp failure falls back to SMS; nearby fires once at <500m.

### Phase 6 — ePOD + COD
Camera capture + client compression, Supabase Storage org-scoped upload, POD record (immutable), COD amount capture, POD visible on order detail + customer page after delivery.
**Accept:** delivered order without POD is impossible via UI; POD record cannot be mutated (policy test); photo ≤500KB.

### Phase 7 — EOD reconciliation + admin
EOD report: deliveries completed/failed with reasons, COD expected vs collected per rider, CSV export. Riders CRUD, org settings.
**Accept:** report matches seed-data ground truth exactly; CSV opens clean in Excel.

### Phase 8 — Webhook outbox + hardening
webhook_outbox cron with HMAC signing + timestamp + retries, rate limiting on public endpoints, security pass: headers, token expiry audit, dependency audit.
**Accept:** SIMON-side mock receiver verifies signature and rejects tampered payload + replayed timestamp; all failure modes listed in section 2 (Failure modes handled in v1 code) demonstrably handled.

### Phase 9 (post-pilot only, if PWA GPS fails on Hungkee's Androids)
Capacitor wrapper for background location. Do not build unless pilot data demands it.

---
**Kickoff prompt for Claude Code:**
"Read SPEC.md in this directory in full. Summarize the product, the architecture decisions, and Phase 0 scope in your own words. Flag anything ambiguous or contradictory. Do not write code until I confirm."

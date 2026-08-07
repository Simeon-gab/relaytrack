# RelayTrack

Delivery operations software for businesses that deliver with their own riders — live tracking, dispute-proof delivery (ePOD), automated customer notifications, and end-of-day reconciliation.

**Start here: [`docs/SPEC.md`](docs/SPEC.md).** It is the single source of truth for product scope, architecture, schema, design, and the phased build plan.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Maps + WhatsApp keys
npm run dev
```

## Surfaces

| Route | Who | Purpose |
|---|---|---|
| `/rider` | Riders (PWA) | Assigned deliveries, GPS streaming, ePOD + COD capture |
| `/dispatch` | Dispatchers | Live map, order queue, exception alerts |
| `/t/[token]` | Customers (public) | Live tracking page, status timeline, ETA |
| `/admin` | Owner/admin | Riders, org settings, EOD reports, CSV export |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (must pass with zero type errors) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest suite |
| `npm run test:rls` | Org-isolation test — must pass before any phase is done |
| `npm run seed` | Seed demo org, riders, orders |

## Working with Claude Code

`CLAUDE.md` loads automatically and points at the spec. Kick off a session with:

> Read `docs/SPEC.md` in full. Summarize the product, the architecture decisions, and the current phase scope in your own words. Flag anything ambiguous or contradictory. Do not write code until I confirm.

Track phase status in `PROGRESS.md`.

## Non-negotiables

- `org_id` on every table, RLS scoped by org membership
- No unauthenticated inbound endpoints, ever
- Outbound webhooks HMAC-signed with timestamp (replay protection)
- One build phase at a time, acceptance criteria before moving on

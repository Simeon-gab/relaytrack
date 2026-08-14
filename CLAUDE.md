# CLAUDE.md

**Read `docs/SPEC.md` in full before doing any work in this repo.** It is the single source of truth: product definition, architecture, database schema, design system, and the phased build plan with acceptance criteria.

## Non-negotiable rules (full version in SPEC.md section 0)

1. **One phase at a time.** Execute only the current phase from SPEC.md section 5. Stop at its acceptance criteria and report before continuing.
2. **`org_id` on every table. No exceptions.** RLS policies scoped by org membership on every table. This is the SIMON integration contract — violating it is a build failure.
3. **Every inbound endpoint is authenticated.** No unauthenticated POST routes anywhere. Location ingest uses per-rider signed JWTs. Outbound webhooks are HMAC-signed with a timestamp for replay protection.
4. **Never invent scope.** If it isn't in SPEC.md section 1 v1 scope, don't build it. If a decision is ambiguous, ask.
5. **TypeScript strict. No `any`.** Zod validation on every API boundary.
6. **Secrets in env vars only.** Never commit keys. Use Supabase MCP for migrations; never run destructive SQL without confirmation.

## Environment
PowerShell on Windows · Node 20+ · Supabase MCP connected · deploy target Vercel.

## Current phase
**Phase 0 — Scaffold.** See `docs/SPEC.md` section 5 and `PROGRESS.md`.

## Definition of done (per phase)
- Acceptance criteria for the phase pass
- `npm run build` succeeds with zero type errors
- RLS verified: a user from org A cannot read org B rows (test written)
- Short summary of what was built + any deviations flagged

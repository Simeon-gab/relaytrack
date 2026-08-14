# Supabase clients

Create three, keep them separate, never blur them:

- `client.ts` — browser client, anon key, RLS enforced. Used by dispatch/admin/rider UI.
- `server.ts` — server component / route handler client via `@supabase/ssr`, user session, RLS enforced.
- `admin.ts` — service-role client. **Only** for: location ingest, cron sweeps, and the tracking-page projection. Every use must be preceded by explicit token/JWT validation in the same function.

Why the service role exists here at all: the tracking page and the ingest endpoint have no Supabase user session. They authenticate by signed token instead. Document this in code comments so nobody "simplifies" it into an anon-role table read later. (SPEC.md section 3, RLS summary.)

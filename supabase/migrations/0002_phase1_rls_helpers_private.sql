-- Phase 1 follow-up: move RLS helper functions out of the PostgREST-exposed
-- `public` schema. Fixes security advisor lints 0028/0029 — the helpers were
-- callable via /rest/v1/rpc/* by anon. In `private` they are usable by RLS
-- policies (which reference them by identity) but not via the API.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, public.org_role[]) set schema private;
alter function public.is_own_rider(uuid) set schema private;
alter function public.is_own_delivery(uuid) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.is_own_rider(uuid),
  private.is_own_delivery(uuid)
to authenticated;

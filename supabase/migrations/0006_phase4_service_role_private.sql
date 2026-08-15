-- Phase 4 fix: service_role could not execute the state-machine functions.
-- assign_rider/transition_order are SECURITY INVOKER and derive the audit
-- actor via private.* helpers; service_role (which BYPASSRLS but is not
-- superuser) had no USAGE on the private schema, so any system-side caller
-- (simulation harness now; Phase 5 geofence/cron transitions later) failed
-- with "permission denied for schema private". Grant execute on exactly the
-- helper surface — the schema stays off the PostgREST API for anon.
grant usage on schema private to service_role;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.is_own_rider(uuid),
  private.is_own_delivery(uuid)
to service_role;

-- Phase 5: customer notifications + geofence "nearby".
--
-- 1. Notification enqueue is a trigger on delivery_events, NOT inline app
--    code: every transition path (assign_rider, transition_order, fire_nearby)
--    already writes exactly one audit event per transition, so piggybacking on
--    that insert gives "exactly one notification per status transition" for
--    free, atomically, no matter which surface caused the transition.
--    SECURITY DEFINER because the transitions run as authenticated users
--    (dispatcher or rider) and notifications has no insert policy for them —
--    writes stay system-side per SPEC section 3. Lives in private so it is
--    not callable via the REST RPC API.
--
-- 2. fire_nearby: the geofence trigger called by the location ingest handler
--    (service role) when a rider crosses <500m from the dropoff while the
--    order is in_transit. The update ... where nearby_fired_at is null guard
--    makes it fire exactly once even under concurrent batches.

create or replace function private.enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_phone text;
begin
  -- Only customer-facing transitions notify (SPEC section 2: assigned,
  -- picked_up, nearby, delivered). failed/note events are dispatcher business.
  if new.type not in ('assigned', 'picked_up', 'nearby', 'delivered') then
    return new;
  end if;

  select o.* into v_order
  from public.orders o
  join public.deliveries d on d.order_id = o.id
  where d.id = new.delivery_id;
  if not found then
    return new;
  end if;

  select c.phone into v_phone
  from public.customers c
  where c.id = v_order.customer_id;
  if v_phone is null or length(trim(v_phone)) = 0 then
    return new; -- no destination, nothing to queue
  end if;

  insert into public.notifications (org_id, order_id, channel, template, to_phone)
  values (new.org_id, v_order.id, 'whatsapp', new.type::text, v_phone);

  return new;
end;
$$;

drop trigger if exists delivery_events_enqueue_notification on public.delivery_events;
create trigger delivery_events_enqueue_notification
  after insert on public.delivery_events
  for each row execute function private.enqueue_notification();

-- Geofence: fire order.nearby exactly once. Returns true when this call was
-- the one that fired it. SECURITY INVOKER — only the service role calls this
-- (ingest handler), and it bypasses RLS anyway; keeping invoker means an
-- authenticated caller is still bound by their own row access.
create or replace function public.fire_nearby(p_delivery uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery public.deliveries%rowtype;
  v_status public.order_status;
begin
  -- Atomic claim: only one caller ever sees this row transition null -> now().
  update public.deliveries
  set nearby_fired_at = now()
  where id = p_delivery and nearby_fired_at is null
  returning * into v_delivery;
  if not found then
    return false;
  end if;

  select status into v_status from public.orders where id = v_delivery.order_id;
  if v_status <> 'in_transit' then
    -- Not eligible after all: release the claim so a later in_transit pass
    -- can still fire (e.g. batch raced the picked_up -> in_transit click).
    update public.deliveries set nearby_fired_at = null where id = p_delivery;
    return false;
  end if;

  insert into public.delivery_events (org_id, delivery_id, type, actor, payload)
  values (v_delivery.org_id, v_delivery.id, 'nearby', 'system', '{}'::jsonb);

  return true;
end;
$$;

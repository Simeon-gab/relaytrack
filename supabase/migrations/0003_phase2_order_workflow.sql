-- Phase 2: atomic order workflow (assignment + status transitions).
-- SECURITY INVOKER on purpose: RLS applies to every read/write inside, so a
-- caller can only operate on orders their org membership lets them see.
-- Each function is one transaction — a status change and its audit event
-- can never half-commit (the audit trail is the product).

create or replace function public.assign_rider(p_order uuid, p_rider uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_rider public.riders%rowtype;
  v_delivery_id uuid;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Order is %; only pending orders can be assigned', v_order.status;
  end if;

  select * into v_rider from public.riders where id = p_rider;
  if not found then
    raise exception 'Rider not found';
  end if;
  if v_rider.org_id <> v_order.org_id then
    raise exception 'Rider belongs to a different org';
  end if;
  if not v_rider.active then
    raise exception 'Rider is inactive';
  end if;

  insert into public.deliveries (org_id, order_id, rider_id)
  values (v_order.org_id, p_order, p_rider)
  returning id into v_delivery_id;

  update public.orders set status = 'assigned' where id = p_order;

  insert into public.delivery_events (org_id, delivery_id, type, actor, payload)
  values (
    v_order.org_id, v_delivery_id, 'assigned', 'dispatcher',
    jsonb_build_object('rider_id', p_rider, 'rider_name', v_rider.name)
  );

  return v_delivery_id;
end;
$$;

create or replace function public.transition_order(
  p_order uuid,
  p_status public.order_status,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_event public.delivery_event_type;
  v_allowed boolean;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;

  select * into v_delivery from public.deliveries where order_id = p_order;

  -- State machine. Assignment is its own path (assign_rider), so 'assigned'
  -- is never a target here.
  v_allowed := case v_order.status
    when 'pending'    then p_status in ('cancelled')
    when 'assigned'   then p_status in ('picked_up', 'failed', 'cancelled')
    when 'picked_up'  then p_status in ('in_transit', 'delivered', 'failed')
    when 'in_transit' then p_status in ('delivered', 'failed')
    else false
  end;
  if not v_allowed then
    raise exception 'Invalid transition: % -> %', v_order.status, p_status;
  end if;

  if p_status = 'failed' and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'A failure reason is required';
  end if;

  update public.orders set status = p_status where id = p_order;

  if v_delivery.id is not null then
    update public.deliveries set
      picked_up_at   = case when p_status = 'picked_up' then now() else picked_up_at end,
      delivered_at   = case when p_status = 'delivered' then now() else delivered_at end,
      failed_at      = case when p_status = 'failed'    then now() else failed_at end,
      failure_reason = case when p_status = 'failed'    then p_reason else failure_reason end
    where id = v_delivery.id;

    -- in_transit / cancelled have no dedicated event type in the spec enum;
    -- they audit as 'note' with the target status in the payload.
    v_event := case p_status
      when 'picked_up' then 'picked_up'::public.delivery_event_type
      when 'delivered' then 'delivered'::public.delivery_event_type
      when 'failed'    then 'failed'::public.delivery_event_type
      else 'note'::public.delivery_event_type
    end;

    insert into public.delivery_events (org_id, delivery_id, type, actor, payload)
    values (
      v_order.org_id, v_delivery.id, v_event, 'dispatcher',
      jsonb_build_object('to_status', p_status)
        || case when p_reason is not null
             then jsonb_build_object('reason', p_reason)
             else '{}'::jsonb
           end
    );
  end if;
end;
$$;

-- Authenticated only; anon has no business here (and RLS would blank it anyway).
revoke execute on function public.assign_rider(uuid, uuid) from public, anon;
revoke execute on function public.transition_order(uuid, public.order_status, text) from public, anon;
grant execute on function public.assign_rider(uuid, uuid) to authenticated;
grant execute on function public.transition_order(uuid, public.order_status, text) to authenticated;

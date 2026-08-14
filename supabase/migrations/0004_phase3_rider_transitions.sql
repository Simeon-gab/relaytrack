-- Phase 3: riders drive their own deliveries.
-- 1. transition_order derives the audit actor from who is calling (rider on
--    this delivery -> 'rider', org member -> 'dispatcher') instead of
--    trusting a parameter, and keeps riders.status in sync.
-- 2. RLS: riders may update orders on their own deliveries (needed for
--    status transitions) and their own rider row (status/last_position).
--    Dispatchers (any org member) may update riders — previously owner/admin
--    only, which would have blocked dispatcher-driven transitions.

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
  v_actor public.event_actor;
  v_allowed boolean;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;

  select * into v_delivery from public.deliveries where order_id = p_order;

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

    -- Rider availability follows the delivery.
    if p_status in ('picked_up', 'in_transit') then
      update public.riders set status = 'on_delivery' where id = v_delivery.rider_id;
    elsif p_status in ('delivered', 'failed') then
      update public.riders set status = 'available' where id = v_delivery.rider_id;
    end if;

    -- Actor is derived, never trusted from input.
    v_actor := case
      when exists (
        select 1 from public.riders r
        where r.id = v_delivery.rider_id and r.user_id = (select auth.uid())
      ) then 'rider'::public.event_actor
      when private.is_org_member(v_order.org_id) then 'dispatcher'::public.event_actor
      else 'system'::public.event_actor
    end;

    v_event := case p_status
      when 'picked_up' then 'picked_up'::public.delivery_event_type
      when 'delivered' then 'delivered'::public.delivery_event_type
      when 'failed'    then 'failed'::public.delivery_event_type
      else 'note'::public.delivery_event_type
    end;

    insert into public.delivery_events (org_id, delivery_id, type, actor, payload)
    values (
      v_order.org_id, v_delivery.id, v_event, v_actor,
      jsonb_build_object('to_status', p_status)
        || case when p_reason is not null
             then jsonb_build_object('reason', p_reason)
             else '{}'::jsonb
           end
    );
  end if;
end;
$$;

-- Riders may move orders on their own deliveries through the state machine.
create policy orders_update_rider on public.orders
  for update to authenticated
  using (
    exists (
      select 1 from public.deliveries d
      where d.order_id = orders.id and private.is_own_delivery(d.id)
    )
  )
  with check (
    exists (
      select 1 from public.deliveries d
      where d.order_id = orders.id and private.is_own_delivery(d.id)
    )
  );

-- Any org member may update riders (dispatchers set status during
-- transitions); a rider may update their own row (status/last_position).
drop policy riders_update on public.riders;
create policy riders_update on public.riders
  for update to authenticated
  using (private.is_org_member(org_id) or user_id = (select auth.uid()))
  with check (private.is_org_member(org_id) or user_id = (select auth.uid()));

-- Phase 1: schema + RLS. Mirrors docs/SPEC.md section 3 exactly.
-- Every table: id uuid pk, org_id (SIMON contract), created_at, RLS enabled.
-- Applied via Supabase MCP as migration `phase1_schema_auth_rls`.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'dispatcher', 'admin');
create type public.rider_status as enum ('offline', 'available', 'on_delivery');
create type public.order_status as enum
  ('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled');
create type public.delivery_event_type as enum
  ('assigned', 'picked_up', 'nearby', 'delivered', 'failed', 'note');
create type public.event_actor as enum ('rider', 'dispatcher', 'system');
create type public.notification_channel as enum ('whatsapp', 'sms');
create type public.notification_status as enum ('queued', 'sent', 'failed');
create type public.outbox_status as enum ('queued', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  whatsapp_config jsonb not null default '{}'::jsonb,
  sms_config jsonb not null default '{}'::jsonb,
  webhook_url text,
  webhook_secret_vault_id uuid,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on column public.orgs.webhook_secret_vault_id is
  'References vault.secrets(id). Webhook secret lives in Supabase Vault, never plaintext (SPEC section 3). Populated in Phase 8.';

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);
create index org_members_org_idx on public.org_members (org_id);

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text not null,
  status public.rider_status not null default 'offline',
  last_position jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index riders_org_status_idx on public.riders (org_id, status);
create index riders_user_idx on public.riders (user_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  phone text not null,
  default_address text,
  notes text,
  created_at timestamptz not null default now()
);
create index customers_org_phone_idx on public.customers (org_id, phone);

-- ---------------------------------------------------------------------------
-- Orders & deliveries
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  reference text,
  dropoff_address text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  cod_amount numeric(12,2),
  notes text,
  status public.order_status not null default 'pending',
  tracking_token text not null unique,
  created_at timestamptz not null default now()
);
create index orders_org_status_idx on public.orders (org_id, status);
create index orders_customer_idx on public.orders (customer_id);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid not null references public.riders(id),
  assigned_at timestamptz not null default now(),
  picked_up_at timestamptz,
  nearby_fired_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (order_id) -- one active delivery per order in v1
);
create index deliveries_org_rider_idx on public.deliveries (org_id, rider_id, assigned_at desc);
create index deliveries_rider_idx on public.deliveries (rider_id);

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  type public.delivery_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  actor public.event_actor not null,
  created_at timestamptz not null default now()
);
create index delivery_events_delivery_idx on public.delivery_events (delivery_id, created_at);
create index delivery_events_org_idx on public.delivery_events (org_id);

-- ---------------------------------------------------------------------------
-- Location (fastest-growing table — never select * without a time bound)
-- ---------------------------------------------------------------------------
create table public.rider_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  rider_id uuid not null references public.riders(id) on delete cascade,
  delivery_id uuid references public.deliveries(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision not null,
  speed double precision,
  heading double precision,
  captured_at timestamptz not null, -- device clock; server is authoritative
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index rider_locations_rider_idx on public.rider_locations (rider_id, captured_at desc);
create index rider_locations_delivery_idx on public.rider_locations (delivery_id, captured_at);
create index rider_locations_org_idx on public.rider_locations (org_id);

-- ---------------------------------------------------------------------------
-- ePOD & cash (immutable: no update/delete policies; corrections supersede)
-- ---------------------------------------------------------------------------
create table public.pods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id),
  photo_path text not null,
  lat double precision not null,
  lng double precision not null,
  captured_at timestamptz not null, -- device
  received_at timestamptz not null default now(), -- server
  recipient_name text,
  cod_collected numeric(12,2),
  superseded_by uuid references public.pods(id),
  created_at timestamptz not null default now()
);
-- Correction chain: a new POD points at the record it supersedes.
-- Exactly one root POD per delivery; each POD can be superseded at most once.
create unique index pods_one_root_per_delivery on public.pods (delivery_id)
  where superseded_by is null;
create unique index pods_supersedes_once on public.pods (superseded_by)
  where superseded_by is not null;
create index pods_org_idx on public.pods (org_id);
create index pods_delivery_idx on public.pods (delivery_id);

-- ---------------------------------------------------------------------------
-- Messaging & integration outboxes
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  channel public.notification_channel not null,
  template text not null,
  to_phone text not null,
  status public.notification_status not null default 'queued',
  provider_response jsonb,
  attempts int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_sweep_idx on public.notifications (status, created_at);
create index notifications_org_idx on public.notifications (org_id);
create index notifications_order_idx on public.notifications (order_id);

create table public.webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status public.outbox_status not null default 'queued',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index webhook_outbox_sweep_idx on public.webhook_outbox (status, next_attempt_at);
create index webhook_outbox_org_idx on public.webhook_outbox (org_id);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- SECURITY DEFINER so policy checks bypass RLS on the membership tables
-- themselves (no recursion). search_path pinned; all references qualified.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(check_org uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = check_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(check_org uuid, roles public.org_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = check_org
      and m.user_id = (select auth.uid())
      and m.role = any(roles)
  );
$$;

-- Rider identity: does this rider row belong to the signed-in user?
create or replace function public.is_own_rider(check_rider uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.riders r
    where r.id = check_rider and r.user_id = (select auth.uid())
  );
$$;

-- Is the signed-in user the rider on this delivery?
create or replace function public.is_own_delivery(check_delivery uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deliveries d
    join public.riders r on r.id = d.rider_id
    where d.id = check_delivery and r.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS. Enabled on EVERY table (SPEC rule 2). All policies target
-- `authenticated` only — anon has no policies, so anon reads/writes are
-- denied everywhere. The tracking page and location ingest NEVER touch these
-- tables as anon: they go through route handlers using the service role after
-- explicit token/JWT validation (SPEC section 3, RLS summary). Do not
-- "simplify" that into anon policies later.
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.riders enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_events enable row level security;
alter table public.rider_locations enable row level security;
alter table public.pods enable row level security;
alter table public.notifications enable row level security;
alter table public.webhook_outbox enable row level security;

-- orgs: members read; owner/admin update; create/delete is service-role only.
create policy orgs_select on public.orgs
  for select to authenticated using (public.is_org_member(id));
create policy orgs_update on public.orgs
  for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.org_role[]));

-- org_members: see own memberships + fellow members; only owners manage.
create policy org_members_select on public.org_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(org_id));
create policy org_members_insert on public.org_members
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));
create policy org_members_update on public.org_members
  for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

-- riders: org staff full read; riders see only their own row; owner/admin manage.
create policy riders_select on public.riders
  for select to authenticated
  using (public.is_org_member(org_id) or user_id = (select auth.uid()));
create policy riders_insert on public.riders
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy riders_update on public.riders
  for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy riders_delete on public.riders
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- customers: org members read/write. No rider access.
create policy customers_select on public.customers
  for select to authenticated using (public.is_org_member(org_id));
create policy customers_insert on public.customers
  for insert to authenticated with check (public.is_org_member(org_id));
create policy customers_update on public.customers
  for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- orders: org members read/write; a rider may read only orders on own deliveries.
create policy orders_select on public.orders
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or exists (
      select 1 from public.deliveries d
      where d.order_id = orders.id and public.is_own_delivery(d.id)
    )
  );
create policy orders_insert on public.orders
  for insert to authenticated with check (public.is_org_member(org_id));
create policy orders_update on public.orders
  for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- deliveries: org members full; riders read/update only their own.
create policy deliveries_select on public.deliveries
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_own_rider(rider_id));
create policy deliveries_insert on public.deliveries
  for insert to authenticated with check (public.is_org_member(org_id));
create policy deliveries_update on public.deliveries
  for update to authenticated
  using (public.is_org_member(org_id) or public.is_own_rider(rider_id))
  with check (public.is_org_member(org_id) or public.is_own_rider(rider_id));

-- delivery_events: append-only audit trail. No update/delete policies, ever.
create policy delivery_events_select on public.delivery_events
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_own_delivery(delivery_id));
create policy delivery_events_insert on public.delivery_events
  for insert to authenticated
  with check (public.is_org_member(org_id) or public.is_own_delivery(delivery_id));

-- rider_locations: org staff read; riders insert only their own points.
-- (Primary ingest path is the service role after JWT validation — this policy
-- is defense in depth, not the main door.) No update/delete.
create policy rider_locations_select on public.rider_locations
  for select to authenticated using (public.is_org_member(org_id));
create policy rider_locations_insert on public.rider_locations
  for insert to authenticated with check (public.is_own_rider(rider_id));

-- pods: immutable. Insert by the delivery's rider or org staff; no update/delete.
create policy pods_select on public.pods
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_own_delivery(delivery_id));
create policy pods_insert on public.pods
  for insert to authenticated
  with check (public.is_org_member(org_id) or public.is_own_delivery(delivery_id));

-- notifications: org members read the audit trail; writes are system-side
-- (service role via outbox cron). No rider access.
create policy notifications_select on public.notifications
  for select to authenticated using (public.is_org_member(org_id));

-- webhook_outbox: org members read delivery status; writes are system-side.
create policy webhook_outbox_select on public.webhook_outbox
  for select to authenticated using (public.is_org_member(org_id));

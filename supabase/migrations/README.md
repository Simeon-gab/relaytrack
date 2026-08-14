# Migrations

One migration per build phase. Apply via Supabase MCP. Reversible where possible. Never run destructive SQL without confirmation.

Naming: `NNNN_phase<N>_<what>.sql` — e.g. `0001_phase1_core_schema.sql`.

Every table, without exception:
- `id uuid primary key default gen_random_uuid()`
- `org_id uuid not null references orgs(id) on delete cascade`
- `created_at timestamptz not null default now()`
- `alter table ... enable row level security;` plus policies scoped through `org_members`

Full schema in `docs/SPEC.md` section 3. Do not improvise columns — update the spec first, note it in `PROGRESS.md`, then migrate.

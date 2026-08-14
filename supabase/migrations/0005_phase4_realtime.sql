-- Phase 4: dispatcher live map.
-- Broadcast riders table changes over Supabase Realtime (SPEC section 2,
-- Location pipeline). postgres_changes enforces RLS per subscriber, so a
-- dispatcher only ever receives rows their riders_select policy allows —
-- org isolation holds on the wire, not just at query time.
alter publication supabase_realtime add table public.riders;

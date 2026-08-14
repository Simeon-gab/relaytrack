# Notifications

Outbox pattern, not inline sends. Status transition writes a `notifications` row; the cron at `/api/cron/notifications` sweeps `status = queued`.

Order of attempts: WhatsApp Cloud API template → on failure, Termii SMS. Log every provider response for the audit trail.

Templates needed (register with Meta before Phase 5): `assigned`, `picked_up`, `nearby`, `delivered` — each carrying the tracking link.

Exactly one notification per status transition. The `nearby` event is guarded by `deliveries.nearby_fired_at` so it cannot re-fire as the rider circles the drop.

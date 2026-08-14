# Webhook outbox (SIMON contract)

Events: `order.assigned`, `order.picked_up`, `order.delivered`, `order.failed`, `cash.collected`. That is the whole surface for v1.

Signing: `X-Signature: HMAC-SHA256(timestamp + body)` plus `X-Timestamp`. Receivers must reject skew > 5 min — the Phase 8 acceptance test proves a replayed timestamp fails.

Delivery: cron sweep, max 5 attempts, exponential backoff via `next_attempt_at`. Secrets stored in Supabase Vault, never plaintext in `orgs`.

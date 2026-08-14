# Auth

- **Riders:** Supabase magic-link invite, role `rider`. Can read/write only own deliveries, own location inserts, own POD inserts. No read access to other riders.
- **Dispatcher / owner / admin:** Supabase email+password; role on `org_members`.
- **Rider location JWT:** short-lived, per-rider, signed with `RIDER_JWT_SECRET`, issued after rider login. This is what the ingest endpoint verifies — not the Supabase session.
- **Customer tracking token:** signed with `TRACKING_TOKEN_SECRET`, generated on order create, expires 24h after delivery.

# Seed data

`npm run seed` creates: one demo org, two riders, five orders across statuses, and one completed delivery with POD. Used for local dev, the RLS test, the EOD report ground-truth check, and the Loom demo recording.

Keep seed data realistic (Nigerian addresses, ₦ COD amounts) — it doubles as demo material.

Second org required: the org-isolation test needs org B to prove org A can't read it.

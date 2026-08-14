# Scripts

Utility scripts for development and the pilot.

Planned:
- `simulate-riders.ts` — replay GPS tracks against the ingest endpoint. Needed for the Phase 4 acceptance test (two riders moving live on the map without refresh) so you don't have to ride a motorcycle to test the dashboard.
- `battery-test.md` — procedure + results table for the Phase 3 one-hour active-tracking battery run on a real rider device.
- `mock-simon-receiver.ts` — verifies webhook signature and rejects tampered/replayed payloads. Phase 8 acceptance test.

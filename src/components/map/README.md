# Map components

Provider: **MapLibre GL + OpenFreeMap (OSM) tiles** — free, keyless, nothing
to bill and no key to leak. This deviates from SPEC section 2 (Google as the
single provider); the deviation and its reasoning are recorded in PROGRESS.md
(decisions log, 2026-08-15). Google remains the paid upgrade path: only the
map component knows which SDK is underneath, so switching back is contained.

The spec's underlying rule still holds: keep tiles, geocoding and routing/ETA
in ONE data family so coordinates and ETAs agree. With OSM tiles, Phase 5
geocoding/ETA must come from OSM-family services (LocationIQ / Geoapify /
Nominatim + OSRM), not mixed with Google.

Rules:
- Client-side interpolation to smooth marker movement between 10s pings.
- Discard samples with accuracy > 100m before they reach the map.
- If the last ping is older than 90s, stop animating and render "last seen X min ago". Honesty over a fake moving dot.
- Skeleton loaders, never spinners, on map surfaces.

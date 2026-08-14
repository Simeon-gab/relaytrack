# Map components

Single provider for tiles, geocoding and routing/ETA (Google Maps) — mixing providers causes coordinate and ETA mismatches. SPEC.md section 2.

Rules:
- Client-side interpolation to smooth marker movement between 10s pings.
- Discard samples with accuracy > 100m before they reach the map.
- If the last ping is older than 90s, stop animating and render "last seen X min ago". Honesty over a fake moving dot.
- Skeleton loaders, never spinners, on map surfaces.

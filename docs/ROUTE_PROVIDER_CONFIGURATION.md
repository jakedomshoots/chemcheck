# Live routing and geocoding

Chem Check uses `src/lib/routeProvider.ts` for address geocoding and driving-time estimates. The route optimizer requests one travel matrix for a day, caches geocodes in the browser for 30 days, and falls back to deterministic estimates when signal or a provider is unavailable.

## Recommended production setup

Use a same-origin `VITE_ROUTE_PROXY_URL` that keeps provider credentials on the server. The proxy should accept `q` for geocoding, or `from`/`to` (pairwise) and `locations` (matrix) for routing, and return the normalized response documented in `src/lib/routeProvider.ts`. Never put a private provider key in a `VITE_*` variable.

For a quick pilot, explicitly opt into OSRM routing and Nominatim geocoding:

```text
VITE_ROUTE_PROVIDER=osrm
VITE_ROUTE_GEOCODER_URL=https://nominatim.openstreetmap.org/search
VITE_ROUTE_ROUTER_URL=https://router.project-osrm.org/route/v1/driving
VITE_ROUTE_TIMEOUT_MS=6500
VITE_ROUTE_CACHE_TTL_MS=2592000000
```

Without an explicit provider, ChemCheck uses the deterministic offline fallback
so customer addresses are not sent to a public service. Public endpoints have
usage policies and rate limits. Set up a provider account or proxy before
adding more technicians or sending a large route. `VITE_ROUTE_PROVIDER=fallback`
is useful for demos, automated tests, and deliberately offline deployments.

`VITE_ROUTE_PUBLIC_KEY` is only for a provider-restricted public token (for example Mapbox). It is not a secret. Use a proxy for private keys.

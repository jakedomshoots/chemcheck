# Live routing and geocoding

Chem Check uses `src/lib/routeProvider.ts` for address geocoding and driving-time estimates. The route optimizer requests one travel matrix for a day, caches geocodes in the browser for 30 days, and never invents coordinates or drive times when a provider is unavailable.

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

Without an explicit provider, customer addresses are never sent to a public
service and the optimizer does not guess: stops keep their saved order, can be
reordered by hand, and no drive times are shown. Customers with stored
latitude/longitude show straight-line distances, labelled as such. Public
endpoints have usage policies and rate limits, so set up a provider account or
proxy before adding more technicians or sending a large route.

`VITE_ROUTE_PUBLIC_KEY` is only for a provider-restricted public token (for example Mapbox). It is not a secret. Use a proxy for private keys.

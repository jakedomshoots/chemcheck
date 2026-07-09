const MAPBOX_GEOCODING_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const MAPBOX_OPTIMIZATION_URL = 'https://api.mapbox.com/optimized-trips/v1/mapbox/driving';
const MAX_OPTIMIZATION_STOPS = 12;

function getToken() {
  return String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim();
}

function requestError(response, fallback) {
  return `${fallback} (${response.status})`;
}

function readCoordinates(feature) {
  const fromGeometry = feature?.geometry?.coordinates;
  if (Array.isArray(fromGeometry) && fromGeometry.length >= 2) {
    return { longitude: Number(fromGeometry[0]), latitude: Number(fromGeometry[1]) };
  }
  const fromProperties = feature?.properties?.coordinates;
  if (fromProperties && Number.isFinite(Number(fromProperties.longitude)) && Number.isFinite(Number(fromProperties.latitude))) {
    return { longitude: Number(fromProperties.longitude), latitude: Number(fromProperties.latitude) };
  }
  return null;
}

export function getMapboxRoutingReadiness() {
  const configured = Boolean(getToken());
  return {
    configured,
    provider: configured ? 'Mapbox' : null,
    message: configured
      ? 'Mapbox route optimization is available.'
      : 'Mapbox is not configured. Add VITE_MAPBOX_ACCESS_TOKEN to enable live geocoding and drive-time optimization.',
  };
}

export async function geocodeAddress(address, fetchImpl = fetch) {
  const token = getToken();
  if (!token) throw new Error('Mapbox routing is not configured.');
  const normalizedAddress = String(address || '').trim();
  if (!normalizedAddress) throw new Error('A service address is required for route optimization.');

  const url = new URL(MAPBOX_GEOCODING_URL);
  url.searchParams.set('q', normalizedAddress);
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', token);
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(requestError(response, 'Mapbox geocoding failed'));
  const payload = await response.json();
  const feature = Array.isArray(payload?.features) ? payload.features[0] : undefined;
  const coordinates = readCoordinates(feature);
  if (!coordinates || !Number.isFinite(coordinates.longitude) || !Number.isFinite(coordinates.latitude)) {
    throw new Error(`Mapbox could not locate “${normalizedAddress}”.`);
  }
  return {
    ...coordinates,
    formattedAddress: feature?.properties?.full_address || feature?.place_name || normalizedAddress,
  };
}

/**
 * Optimizes an open route: the first scheduled stop remains the start and the
 * final scheduled stop remains the end. Customer addresses leave the device
 * only after the explicit consent in Route Planner is checked.
 */
export async function optimizeMapboxRoute(customers, fetchImpl = fetch) {
  const token = getToken();
  if (!token) throw new Error('Mapbox routing is not configured.');
  if (!Array.isArray(customers) || customers.length < 2) {
    throw new Error('At least two scheduled stops are required for route optimization.');
  }
  if (customers.length > MAX_OPTIMIZATION_STOPS) {
    throw new Error(`Mapbox optimization supports up to ${MAX_OPTIMIZATION_STOPS} stops per route. Split this service day into route runs first.`);
  }

  const geocoded = [];
  for (const customer of customers) {
    const location = await geocodeAddress(customer.address, fetchImpl);
    geocoded.push({ customer, location });
  }

  const coordinatePath = geocoded
    .map(({ location }) => `${location.longitude},${location.latitude}`)
    .join(';');
  const url = new URL(`${MAPBOX_OPTIMIZATION_URL}/${coordinatePath}`);
  url.searchParams.set('source', 'first');
  url.searchParams.set('destination', 'last');
  url.searchParams.set('roundtrip', 'false');
  url.searchParams.set('overview', 'false');
  url.searchParams.set('steps', 'false');
  url.searchParams.set('access_token', token);

  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(requestError(response, 'Mapbox route optimization failed'));
  const payload = await response.json();
  const trip = Array.isArray(payload?.trips) ? payload.trips[0] : undefined;
  const waypoints = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  if (!trip || waypoints.length !== geocoded.length) {
    throw new Error('Mapbox did not return a complete route. Keep the saved order and try again.');
  }

  const ordered = waypoints
    .map((waypoint, inputIndex) => ({ inputIndex, waypoint, item: geocoded[inputIndex] }))
    .sort((a, b) => Number(a.waypoint.waypoint_index) - Number(b.waypoint.waypoint_index))
    .map(({ item }) => ({ ...item.customer, routeLocation: item.location }));

  return {
    customers: ordered,
    driveMinutes: Math.max(0, Math.round(Number(trip.duration || 0) / 60)),
    distanceMiles: Math.max(0, Number((Number(trip.distance || 0) / 1609.344).toFixed(1))),
  };
}

export const MAPBOX_MAX_OPTIMIZATION_STOPS = MAX_OPTIMIZATION_STOPS;

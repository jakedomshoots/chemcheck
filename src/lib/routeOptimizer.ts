// Route planning
//
// Orders a day's stops and reports travel between them ONLY when the data is
// real:
//   - With a configured map provider (VITE_ROUTE_PROVIDER / VITE_ROUTE_PROXY_URL)
//     addresses are geocoded and stops are ordered by nearest-neighbor on
//     live road travel times.
//   - Without one, addresses cannot be located, so stops keep the user's saved
//     order and no distances or drive times are shown. If every stop already
//     carries real coordinates, straight-line distances are reported (clearly
//     labelled, never converted to a drive time).
// Coordinates and drive times are never fabricated.

import { monitoring } from './monitoring';
import {
  routeProvider,
  straightLineMiles,
  type LocationSource,
  type ProviderLocation,
  type RouteProvider,
} from './routeProvider';

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  source?: LocationSource;
  provider?: string;
  precision?: string;
}

export interface Customer {
  id: number | string;
  name: string;
  address: string;
  location?: Location;
  serviceDay: string;
  priority: 'low' | 'medium' | 'high';
  estimatedDuration: number; // minutes
  /** User's saved stop order, when set. */
  sortOrder?: number;
  timeWindow?: {
    start: string; // HH:MM
    end: string;   // HH:MM
  };
  notes?: string;
}

export type TravelDataSource = 'road' | 'straight-line' | 'none';

export interface RouteStop {
  customer: Customer;
  /** Arrival/departure clock times; null when drive times are unknown. */
  arrivalTime: string | null;
  departureTime: string | null;
  /** Driving minutes from the previous stop (or start); null when unknown. */
  travelTime: number | null;
  /** Miles from the previous stop (road or straight-line, see travelSource); null when unknown. */
  distance: number | null;
  travelSource: TravelDataSource;
}

export interface OptimizedRoute {
  id: string;
  date: string;
  stops: RouteStop[];
  /** Null when distances are unknown. */
  totalDistance: number | null;
  /** Service time plus drive/wait time when drive times are known; service time only otherwise. */
  totalTime: number;
  /** Null when drive times are unknown. */
  totalTravelTime: number | null;
  totalServiceTime: number;
  totalWaitTime: number;
  startLocation?: Location;
  endLocation?: Location;
  /** 'nearest-neighbor' when reordered by travel data; 'saved-order' otherwise. */
  optimizationMethod: 'nearest-neighbor' | 'saved-order';
  /** Where travel figures came from. 'none' means no distances/ETAs should be shown. */
  travelDataSource: TravelDataSource;
  createdAt: string;
  provider?: string;
  geocoding?: { requested: number; remote: number; cached: number; unresolved: number };
  routing?: { remote: number; straightLine: number };
  warnings?: string[];
}

export interface RouteOptimizationOptions {
  startLocation?: Location | null;
  endLocation?: Location | null;
  startTime?: string; // HH:MM
  maxWorkingHours?: number;
  prioritizeTimeWindows?: boolean;
  prioritizeHighPriority?: boolean;
}

type UnknownCustomer = Customer | Record<string, unknown>;
type CustomerPriority = Customer['priority'];
type TravelResult = { distance: number; duration: number | null; source: 'road' | 'straight-line' };

class RouteOptimizer {
  private geocodeCache = new Map<string, Location>();
  private distanceCache = new Map<string, TravelResult>();
  private provider: RouteProvider = routeProvider;
  private diagnostics = this.createDiagnostics();

  /** Inject a business-owned proxy or a test provider. */
  setRouteProvider(provider: RouteProvider): void {
    this.provider = provider;
    this.distanceCache.clear();
    this.geocodeCache.clear();
  }

  getRouteProvider(): RouteProvider {
    return this.provider;
  }

  /** True when addresses can be geocoded and live drive times requested. */
  hasMapProvider(): boolean {
    return this.provider.name !== 'fallback';
  }

  private createDiagnostics() {
    return {
      requested: 0,
      remote: 0,
      cached: 0,
      unresolved: 0,
      routingRemote: 0,
      routingStraightLine: 0,
      warnings: [] as string[],
    };
  }

  // ============================================
  // Main entry point
  // ============================================

  async optimizeRoute(
    customers: UnknownCustomer[],
    date: string | Date,
    options: RouteOptimizationOptions = {}
  ): Promise<OptimizedRoute> {
    const startTime = performance.now();
    this.diagnostics = this.createDiagnostics();
    const normalizedCustomers = customers
      .map((customer) => this.normalizeCustomer(customer))
      .filter((customer): customer is Customer => customer !== null);

    try {
      const targetDay = this.getDayOfWeek(date);
      const dayCustomers = this.sortBySavedOrder(normalizedCustomers.filter(
        (customer) => this.normalizeDayName(customer.serviceDay) === targetDay
      ));

      if (dayCustomers.length === 0) {
        return this.buildRoute([], this.toDateString(date), options, 'saved-order', 'none');
      }

      const located = await this.ensureLocations(dayCustomers);
      const allLocated = located.every((customer) => customer.location);
      const startLocation = options.startLocation || undefined;

      let ordered = located;
      let method: OptimizedRoute['optimizationMethod'] = 'saved-order';
      let travelSource: TravelDataSource = 'none';

      if (allLocated) {
        await this.prefetchTravelMatrix(located, startLocation, options.endLocation || undefined);
        travelSource = await this.probeTravelSource(located, startLocation);
        // Only reorder on live road data. Straight-line distance ignores roads,
        // water and one-way streets, so the saved order is kept in that case.
        if (travelSource === 'road' && located.length > 1) {
          ordered = await this.nearestNeighbor(located, startLocation);
          method = 'nearest-neighbor';
        }
      } else if (this.hasMapProvider()) {
        this.diagnostics.warnings.push(
          'Some addresses could not be located, so your saved stop order is kept and travel estimates are hidden.'
        );
      }

      const route = await this.buildRoute(ordered, this.toDateString(date), options, method, travelSource);

      const duration = performance.now() - startTime;
      monitoring.recordMetric('route_optimization', duration, {
        method,
        travelSource,
        customerCount: dayCustomers.length,
      });

      return route;
    } catch (error) {
      monitoring.reportError({
        message: 'Route optimization failed',
        severity: 'medium',
        metadata: {
          date,
          customerCount: normalizedCustomers.length,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  // ============================================
  // Ordering
  // ============================================

  private sortBySavedOrder(customers: Customer[]): Customer[] {
    return customers
      .map((customer, index) => ({ customer, index }))
      .sort((a, b) => {
        const ao = a.customer.sortOrder;
        const bo = b.customer.sortOrder;
        if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
        if (ao !== undefined && bo === undefined) return -1;
        if (ao === undefined && bo !== undefined) return 1;
        return a.index - b.index;
      })
      .map(({ customer }) => customer);
  }

  private async nearestNeighbor(customers: Customer[], startLocation?: Location): Promise<Customer[]> {
    const unvisited = [...customers];
    const route: Customer[] = [];
    let currentLocation: Location | undefined = startLocation;

    if (!currentLocation) {
      // Begin at the user's first saved stop.
      const first = unvisited.shift()!;
      route.push(first);
      currentLocation = first.location!;
    }

    while (unvisited.length > 0) {
      const nearest = await this.findNearestCustomer(currentLocation, unvisited);
      route.push(nearest);
      unvisited.splice(unvisited.indexOf(nearest), 1);
      currentLocation = nearest.location!;
    }

    return route;
  }

  private async findNearestCustomer(location: Location, customers: Customer[]): Promise<Customer> {
    let nearest = customers[0];
    let best = this.travelCost(await this.getTravel(location, nearest.location!));

    for (const customer of customers.slice(1)) {
      const cost = this.travelCost(await this.getTravel(location, customer.location!));
      if (cost < best) {
        best = cost;
        nearest = customer;
      }
    }

    return nearest;
  }

  private travelCost(travel: TravelResult): number {
    return travel.duration ?? travel.distance;
  }

  // ============================================
  // Route details
  // ============================================

  private async buildRoute(
    customers: Customer[],
    date: string,
    options: RouteOptimizationOptions,
    method: OptimizedRoute['optimizationMethod'],
    travelSource: TravelDataSource
  ): Promise<OptimizedRoute> {
    const stops: RouteStop[] = [];
    const hasDistances = travelSource !== 'none';
    const hasDriveTimes = travelSource === 'road';
    let totalDistance = 0;
    let totalTime = 0;
    let totalTravelTime = 0;
    let totalServiceTime = 0;
    let totalWaitTime = 0;

    let currentLocation: Location | undefined = options.startLocation || undefined;
    let currentTime = this.parseTime(options.startTime || '08:00');

    for (const customer of customers) {
      let travelTime: number | null = null;
      let distance: number | null = null;
      let stopTravelSource: TravelDataSource = 'none';
      const serviceDuration = this.getEstimatedDuration(customer);

      if (hasDistances && currentLocation && customer.location) {
        const result = await this.getTravel(currentLocation, customer.location);
        distance = result.distance;
        totalDistance += result.distance;
        stopTravelSource = result.source;
        if (hasDriveTimes && result.duration !== null) {
          travelTime = result.duration;
          totalTime += travelTime;
          totalTravelTime += travelTime;
          currentTime += travelTime;
        }
      } else if (hasDistances && !currentLocation) {
        // First stop with no start location: nothing to travel from.
        distance = 0;
        travelTime = hasDriveTimes ? 0 : null;
        stopTravelSource = travelSource;
      }

      if (hasDriveTimes && customer.timeWindow) {
        const windowStart = this.parseTime(customer.timeWindow.start);
        if (currentTime < windowStart) {
          const waitTime = windowStart - currentTime;
          totalTime += waitTime;
          totalWaitTime += waitTime;
          currentTime = windowStart;
        }
      }

      const arrivalTime = hasDriveTimes ? this.formatTime(currentTime) : null;
      currentTime += serviceDuration;
      totalTime += serviceDuration;
      totalServiceTime += serviceDuration;
      const departureTime = hasDriveTimes ? this.formatTime(currentTime) : null;

      stops.push({ customer, arrivalTime, departureTime, travelTime, distance, travelSource: stopTravelSource });

      if (customer.location) currentLocation = customer.location;
    }

    return {
      id: `route_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      date,
      stops,
      totalDistance: hasDistances ? totalDistance : null,
      totalTime,
      totalTravelTime: hasDriveTimes ? totalTravelTime : null,
      totalServiceTime,
      totalWaitTime,
      startLocation: options.startLocation || undefined,
      endLocation: options.endLocation || undefined,
      optimizationMethod: method,
      travelDataSource: travelSource,
      createdAt: new Date().toISOString(),
      provider: this.provider.name,
      geocoding: {
        requested: this.diagnostics.requested,
        remote: this.diagnostics.remote,
        cached: this.diagnostics.cached,
        unresolved: this.diagnostics.unresolved,
      },
      routing: { remote: this.diagnostics.routingRemote, straightLine: this.diagnostics.routingStraightLine },
      warnings: [...new Set(this.diagnostics.warnings)],
    };
  }

  // ============================================
  // Geocoding & travel
  // ============================================

  private async ensureLocations(customers: Customer[]): Promise<Customer[]> {
    const result: Customer[] = [];
    for (const customer of customers) {
      if (customer.location) {
        result.push(customer);
        continue;
      }
      if (!this.hasMapProvider()) {
        // No provider: the location stays unknown. Never guess.
        result.push(customer);
        continue;
      }
      const location = await this.geocodeAddress(customer.address);
      result.push(location ? { ...customer, location } : customer);
    }
    return result;
  }

  /**
   * Resolve an address through the configured map provider. Returns null
   * when no provider is configured or the lookup fails — a location is
   * never invented.
   */
  async geocodeAddress(address: string): Promise<Location | null> {
    const normalizedAddress = (address || '').trim().toLowerCase();
    if (!normalizedAddress || !this.hasMapProvider()) return null;
    this.diagnostics.requested += 1;

    if (this.geocodeCache.has(normalizedAddress)) {
      const cached = this.geocodeCache.get(normalizedAddress)!;
      this.diagnostics.cached += 1;
      return { ...cached, source: cached.source || 'cache' };
    }

    try {
      const location = await this.provider.geocode(address);
      if (location.source === 'cache') this.diagnostics.cached += 1;
      else this.diagnostics.remote += 1;
      this.geocodeCache.set(normalizedAddress, location);
      return location;
    } catch {
      this.diagnostics.unresolved += 1;
      this.diagnostics.warnings.push(`Could not locate ${address || 'an address'} on the map.`);
      return null;
    }
  }

  private async getTravel(from: Location, to: Location): Promise<TravelResult> {
    const cacheKey = this.routeCacheKey(from, to);
    const cached = this.distanceCache.get(cacheKey);
    if (cached) return cached;

    let result: TravelResult;
    try {
      const estimate = await this.provider.estimateTravel(from as ProviderLocation, to as ProviderLocation);
      result = estimate.source === 'remote' && estimate.duration !== null
        ? { distance: estimate.distance, duration: estimate.duration, source: 'road' }
        : { distance: estimate.distance, duration: null, source: 'straight-line' };
    } catch {
      result = { distance: straightLineMiles(from, to), duration: null, source: 'straight-line' };
    }
    if (result.source === 'road') this.diagnostics.routingRemote += 1;
    else this.diagnostics.routingStraightLine += 1;
    this.distanceCache.set(cacheKey, result);
    return result;
  }

  /** Road data only counts when every leg came back from the live provider. */
  private async probeTravelSource(customers: Customer[], startLocation?: Location): Promise<TravelDataSource> {
    const points = [...(startLocation ? [startLocation] : []), ...customers.map((c) => c.location!)];
    if (points.length < 2) return this.hasMapProvider() ? 'road' : 'straight-line';
    for (let i = 1; i < points.length; i += 1) {
      const leg = await this.getTravel(points[i - 1], points[i]);
      if (leg.source !== 'road') {
        if (this.hasMapProvider()) {
          this.diagnostics.warnings.push('Live routing is unavailable; showing straight-line distances without drive times.');
        }
        return 'straight-line';
      }
    }
    return 'road';
  }

  private routeCacheKey(from: Location, to: Location): string {
    return `${from.latitude},${from.longitude}-${to.latitude},${to.longitude}`;
  }

  private async prefetchTravelMatrix(customers: Customer[], startLocation?: Location, endLocation?: Location): Promise<void> {
    const estimateMatrix = this.provider.estimateTravelMatrix;
    if (!estimateMatrix) return;
    const locations = [
      ...(startLocation ? [startLocation] : []),
      ...customers.map((customer) => customer.location!).filter(Boolean),
      ...(endLocation ? [endLocation] : []),
    ] as Location[];
    if (locations.length < 2) return;

    try {
      const matrix = await estimateMatrix.call(this.provider, locations as ProviderLocation[]);
      matrix.forEach((row, fromIndex) => row.forEach((estimate, toIndex) => {
        if (!estimate || fromIndex === toIndex) return;
        const result: TravelResult = estimate.source === 'remote' && estimate.duration !== null
          ? { distance: estimate.distance, duration: estimate.duration, source: 'road' }
          : { distance: estimate.distance, duration: null, source: 'straight-line' };
        this.distanceCache.set(this.routeCacheKey(locations[fromIndex], locations[toIndex]), result);
      }));
    } catch {
      // Pairwise requests remain available if a provider matrix is unavailable.
    }
  }

  // ============================================
  // Utility Functions
  // ============================================

  private normalizeDayName(day: string | null | undefined): string {
    if (!day) return '';
    switch (day.trim().toLowerCase()) {
      case 'sun':
      case 'sunday':
        return 'Sunday';
      case 'mon':
      case 'monday':
        return 'Monday';
      case 'tue':
      case 'tues':
      case 'tuesday':
        return 'Tuesday';
      case 'wed':
      case 'weds':
      case 'wednesday':
        return 'Wednesday';
      case 'thu':
      case 'thur':
      case 'thurs':
      case 'thursday':
        return 'Thursday';
      case 'fri':
      case 'friday':
        return 'Friday';
      case 'sat':
      case 'saturday':
        return 'Saturday';
      default:
        return '';
    }
  }

  private normalizePriority(priority: unknown): CustomerPriority {
    if (priority === 'high' || priority === 'medium' || priority === 'low') {
      return priority;
    }
    return 'medium';
  }

  private normalizeCustomer(customer: UnknownCustomer): Customer | null {
    const customerRecord = customer as Record<string, unknown>;
    const idCandidate = customerRecord.id ?? customerRecord._id;
    const numericId = Number(idCandidate);
    const id = Number.isFinite(numericId)
      ? numericId
      : typeof idCandidate === 'string' && idCandidate.trim()
        ? idCandidate.trim()
        : null;

    if (id === null) {
      return null;
    }

    const name =
      (typeof customerRecord.name === 'string' && customerRecord.name) ||
      (typeof customerRecord.full_name === 'string' && customerRecord.full_name) ||
      `Customer ${id}`;
    const address = typeof customerRecord.address === 'string' ? customerRecord.address : '';

    // Real coordinates only: a stored location object or latitude/longitude fields.
    const rawLocation = customerRecord.location as Record<string, unknown> | undefined;
    const latitude = Number(rawLocation?.latitude ?? rawLocation?.lat ?? customerRecord.latitude ?? customerRecord.lat);
    const longitude = Number(rawLocation?.longitude ?? rawLocation?.lng ?? customerRecord.longitude ?? customerRecord.lng);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      && !(latitude === 0 && longitude === 0);
    const location: Location | undefined = hasCoordinates
      ? { latitude, longitude, address, source: 'provided' }
      : undefined;

    const normalizedServiceDay = this.normalizeDayName(
      (customerRecord.serviceDay as string | undefined) ??
      (customerRecord.service_day as string | undefined)
    );

    if (!normalizedServiceDay) {
      return null;
    }

    const sortOrderRaw = Number(customerRecord.sortOrder ?? customerRecord.sort_order);

    return {
      id,
      name,
      address,
      location,
      serviceDay: normalizedServiceDay,
      priority: this.normalizePriority(customerRecord.priority),
      estimatedDuration: this.getEstimatedDuration(customerRecord),
      sortOrder: customerRecord.sortOrder != null || customerRecord.sort_order != null
        ? (Number.isFinite(sortOrderRaw) ? sortOrderRaw : undefined)
        : undefined,
      timeWindow: this.normalizeTimeWindow(
        (customerRecord.timeWindow as Record<string, unknown> | undefined) ??
        (customerRecord.time_window as Record<string, unknown> | undefined)
      ),
      notes: typeof customerRecord.notes === 'string' ? customerRecord.notes : undefined,
    };
  }

  private normalizeTimeWindow(windowValue?: Record<string, unknown>): Customer['timeWindow'] | undefined {
    if (!windowValue) return undefined;
    const start = typeof windowValue.start === 'string' ? windowValue.start : '';
    const end = typeof windowValue.end === 'string' ? windowValue.end : '';
    if (!start || !end) return undefined;
    return { start, end };
  }

  private getEstimatedDuration(customer: Partial<Customer> | Record<string, unknown>): number {
    const record = customer as Record<string, unknown>;
    const durationCandidates = [
      record.estimatedDuration,
      record.estimated_duration,
      record.average_duration_minutes,
      record.avg_duration_minutes,
      record.typical_duration_minutes,
      record.duration,
      Number(record.duration_ms) / 60000,
    ];

    for (const candidate of durationCandidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(180, Math.max(10, parsed));
      }
    }

    const gallons = Number(record.pool_gallons ?? record.poolGallons);
    const isSaltPool = String(record.pool_type ?? record.poolType ?? '').toLowerCase() === 'salt';

    let inferredDuration = 15;
    if (Number.isFinite(gallons)) {
      if (gallons >= 35000) inferredDuration = 30;
      else if (gallons >= 20000) inferredDuration = 24;
      else if (gallons >= 10000) inferredDuration = 18;
    }
    if (isSaltPool) inferredDuration += 2;

    return Math.min(180, Math.max(10, inferredDuration));
  }

  private parseTime(timeStr: string): number {
    if (!timeStr || !timeStr.includes(':')) return 8 * 60;
    const [hoursRaw, minutesRaw] = timeStr.split(':').map(Number);
    const hours = Number.isFinite(hoursRaw) ? Math.min(23, Math.max(0, hoursRaw)) : 8;
    const minutes = Number.isFinite(minutesRaw) ? Math.min(59, Math.max(0, minutesRaw)) : 0;
    return hours * 60 + minutes;
  }

  private formatTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  private getDayOfWeek(dateValue: string | Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = this.parseDateValue(dateValue);
    return days[date.getDay()];
  }

  private parseDateValue(dateValue: string | Date): Date {
    if (dateValue instanceof Date) {
      const safeDate = new Date(dateValue.getTime());
      return Number.isNaN(safeDate.getTime()) ? new Date() : safeDate;
    }

    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      const [year, month, day] = dateValue.split('-').map(Number);
      const parsedLocalDate = new Date(year, month - 1, day);
      return Number.isNaN(parsedLocalDate.getTime()) ? new Date() : parsedLocalDate;
    }

    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private toDateString(dateValue: string | Date): string {
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }

    const parsed = this.parseDateValue(dateValue);
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// Global route optimizer instance
export const routeOptimizer = new RouteOptimizer();
export { RouteOptimizer };

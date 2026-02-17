// Advanced Route Optimization
// Optimizes service routes using GPS coordinates and various algorithms

import { monitoring } from './monitoring';

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
}

export interface Customer {
  id: number;
  name: string;
  address: string;
  location?: Location;
  serviceDay: string;
  priority: 'low' | 'medium' | 'high';
  estimatedDuration: number; // minutes
  timeWindow?: {
    start: string; // HH:MM
    end: string;   // HH:MM
  };
  notes?: string;
}

export interface RouteStop {
  customer: Customer;
  arrivalTime: string;
  departureTime: string;
  travelTime: number; // minutes from previous stop
  distance: number;   // miles from previous stop
}

export interface OptimizedRoute {
  id: string;
  date: string;
  stops: RouteStop[];
  totalDistance: number;
  totalTime: number;
  totalTravelTime: number;
  totalServiceTime: number;
  totalWaitTime: number;
  startLocation?: Location;
  endLocation?: Location;
  optimizationMethod: string;
  createdAt: string;
}

export interface RouteOptimizationOptions {
  startLocation?: Location;
  endLocation?: Location;
  startTime?: string; // HH:MM
  maxWorkingHours?: number;
  prioritizeTimeWindows?: boolean;
  prioritizeHighPriority?: boolean;
  avoidTraffic?: boolean;
  algorithm?: 'nearest-neighbor' | 'genetic' | 'simulated-annealing';
}

type UnknownCustomer = Customer | Record<string, unknown>;
type CustomerPriority = Customer['priority'];

class RouteOptimizer {
  private geocodeCache = new Map<string, Location>();
  private distanceCache = new Map<string, { distance: number; duration: number }>();

  // ============================================
  // Main Optimization Function
  // ============================================

  async optimizeRoute(
    customers: UnknownCustomer[],
    date: string | Date,
    options: RouteOptimizationOptions = {}
  ): Promise<OptimizedRoute> {
    const startTime = performance.now();
    const normalizedCustomers = customers
      .map((customer) => this.normalizeCustomer(customer))
      .filter((customer): customer is Customer => customer !== null);
    
    try {
      // Ensure all customers have locations
      const customersWithLocations = await this.ensureLocations(normalizedCustomers);

      const targetDay = this.getDayOfWeek(date);
      
      // Filter customers for the specific day
      const dayCustomers = customersWithLocations.filter(
        (customer) => this.normalizeDayName(customer.serviceDay) === targetDay
      );
      
      if (dayCustomers.length === 0) {
        return this.createEmptyRoute(this.toDateString(date), options);
      }

      // Choose optimization algorithm
      const algorithm = options.algorithm || 'nearest-neighbor';
      let optimizedOrder: Customer[];

      switch (algorithm) {
        case 'genetic':
          optimizedOrder = await this.geneticAlgorithm(dayCustomers, options);
          break;
        case 'simulated-annealing':
          optimizedOrder = await this.simulatedAnnealing(dayCustomers, options);
          break;
        default:
          optimizedOrder = await this.nearestNeighbor(dayCustomers, options);
      }

      // Calculate route details
      const route = await this.calculateRouteDetails(optimizedOrder, this.toDateString(date), options);
      
      const duration = performance.now() - startTime;
      monitoring.recordMetric('route_optimization', duration, {
        algorithm,
        customerCount: dayCustomers.length,
        totalDistance: route.totalDistance,
        totalTime: route.totalTime
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
  // Optimization Algorithms
  // ============================================

  private async nearestNeighbor(
    customers: Customer[],
    options: RouteOptimizationOptions
  ): Promise<Customer[]> {
    if (customers.length <= 1) return customers;

    const unvisited = [...customers];
    const route: Customer[] = [];
    
    // Start from the specified start location or first customer
    let currentLocation = options.startLocation || customers[0].location!;
    
    // If we have a start location, find the nearest customer to start with
    if (options.startLocation) {
      const nearest = this.findNearestCustomer(currentLocation, unvisited);
      route.push(nearest);
      unvisited.splice(unvisited.indexOf(nearest), 1);
      currentLocation = nearest.location!;
    }

    // Continue with nearest neighbor
    while (unvisited.length > 0) {
      const nearest = this.findNearestCustomer(currentLocation, unvisited);
      route.push(nearest);
      unvisited.splice(unvisited.indexOf(nearest), 1);
      currentLocation = nearest.location!;
    }

    return route;
  }

  private async geneticAlgorithm(
    customers: Customer[],
    options: RouteOptimizationOptions
  ): Promise<Customer[]> {
    const populationSize = Math.min(50, Math.max(10, customers.length * 2));
    const generations = Math.min(100, customers.length * 5);
    const mutationRate = 0.1;
    const eliteSize = Math.floor(populationSize * 0.2);

    // Initialize population
    let population = await this.initializePopulation(customers, populationSize);

    for (let gen = 0; gen < generations; gen++) {
      // Evaluate fitness
      const fitness = await Promise.all(
        population.map(route => this.calculateRouteFitness(route, options))
      );

      // Sort by fitness (lower is better)
      const sortedIndices = fitness
        .map((fit, index) => ({ fitness: fit, index }))
        .sort((a, b) => a.fitness - b.fitness)
        .map(item => item.index);

      // Select elite
      const newPopulation = sortedIndices
        .slice(0, eliteSize)
        .map(index => [...population[index]]);

      // Generate offspring
      while (newPopulation.length < populationSize) {
        const parent1 = population[sortedIndices[Math.floor(Math.random() * eliteSize)]];
        const parent2 = population[sortedIndices[Math.floor(Math.random() * eliteSize)]];
        
        let offspring = this.crossover(parent1, parent2);
        
        if (Math.random() < mutationRate) {
          offspring = this.mutate(offspring);
        }
        
        newPopulation.push(offspring);
      }

      population = newPopulation;
    }

    // Return best route
    const finalFitness = await Promise.all(
      population.map(route => this.calculateRouteFitness(route, options))
    );
    const bestIndex = finalFitness.indexOf(Math.min(...finalFitness));
    
    return population[bestIndex];
  }

  private async simulatedAnnealing(
    customers: Customer[],
    options: RouteOptimizationOptions
  ): Promise<Customer[]> {
    let currentRoute = await this.nearestNeighbor(customers, options);
    let currentFitness = await this.calculateRouteFitness(currentRoute, options);
    
    let bestRoute = [...currentRoute];
    let bestFitness = currentFitness;
    
    const maxIterations = customers.length * 100;
    const initialTemp = 1000;
    const coolingRate = 0.995;
    let temperature = initialTemp;

    for (let i = 0; i < maxIterations; i++) {
      // Generate neighbor solution
      const neighborRoute = this.generateNeighbor(currentRoute);
      const neighborFitness = await this.calculateRouteFitness(neighborRoute, options);
      
      // Accept or reject the neighbor
      const delta = neighborFitness - currentFitness;
      
      if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentRoute = neighborRoute;
        currentFitness = neighborFitness;
        
        if (currentFitness < bestFitness) {
          bestRoute = [...currentRoute];
          bestFitness = currentFitness;
        }
      }
      
      temperature *= coolingRate;
    }

    return bestRoute;
  }

  // ============================================
  // Helper Functions for Algorithms
  // ============================================

  private findNearestCustomer(location: Location, customers: Customer[]): Customer {
    let nearest = customers[0];
    let minDistance = this.calculateDistance(location, nearest.location!);

    for (const customer of customers.slice(1)) {
      const distance = this.calculateDistance(location, customer.location!);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = customer;
      }
    }

    return nearest;
  }

  private async initializePopulation(customers: Customer[], size: number): Promise<Customer[][]> {
    const population: Customer[][] = [];
    
    // Add one nearest neighbor solution
    population.push(await this.nearestNeighbor(customers, {}));
    
    // Add random solutions
    for (let i = 1; i < size; i++) {
      const shuffled = [...customers];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
      }
      population.push(shuffled);
    }

    return population;
  }

  private crossover(parent1: Customer[], parent2: Customer[]): Customer[] {
    const start = Math.floor(Math.random() * parent1.length);
    const end = Math.floor(Math.random() * (parent1.length - start)) + start;
    
    const offspring = new Array(parent1.length);
    const segment = parent1.slice(start, end + 1);
    
    // Copy segment from parent1
    for (let i = start; i <= end; i++) {
      offspring[i] = parent1[i];
    }
    
    // Fill remaining positions from parent2
    let parent2Index = 0;
    for (let i = 0; i < offspring.length; i++) {
      if (offspring[i] === undefined) {
        while (segment.includes(parent2[parent2Index])) {
          parent2Index++;
        }
        offspring[i] = parent2[parent2Index];
        parent2Index++;
      }
    }
    
    return offspring;
  }

  private mutate(route: Customer[]): Customer[] {
    const mutated = [...route];
    const i = Math.floor(Math.random() * mutated.length);
    const j = Math.floor(Math.random() * mutated.length);
    
    [mutated[i], mutated[j]] = [mutated[j], mutated[i]];
    
    return mutated;
  }

  private generateNeighbor(route: Customer[]): Customer[] {
    const neighbor = [...route];
    
    // Random swap
    if (Math.random() < 0.5) {
      const i = Math.floor(Math.random() * neighbor.length);
      const j = Math.floor(Math.random() * neighbor.length);
      [neighbor[i], neighbor[j]] = [neighbor[j], neighbor[i]];
    } else {
      // Random reverse
      const start = Math.floor(Math.random() * neighbor.length);
      const end = Math.floor(Math.random() * (neighbor.length - start)) + start;
      const segment = neighbor.slice(start, end + 1).reverse();
      neighbor.splice(start, segment.length, ...segment);
    }
    
    return neighbor;
  }

  private async calculateRouteFitness(route: Customer[], options: RouteOptimizationOptions): Promise<number> {
    if (route.length === 0) return 0;

    let totalDistance = 0;
    let totalTime = 0;
    let timeWindowPenalty = 0;
    let priorityBonus = 0;

    let currentLocation = options.startLocation || route[0]?.location;
    let currentTime = this.parseTime(options.startTime || '08:00');

    for (const customer of route) {
      if (currentLocation && customer.location) {
        const { distance, duration } = await this.getDistanceAndDuration(currentLocation, customer.location);
        totalDistance += distance;
        totalTime += duration;
        currentTime += duration;

        // Time window penalty
        if (options.prioritizeTimeWindows && customer.timeWindow) {
          const windowStart = this.parseTime(customer.timeWindow.start);
          const windowEnd = this.parseTime(customer.timeWindow.end);
          
          if (currentTime < windowStart) {
            timeWindowPenalty += (windowStart - currentTime) * 2; // Wait penalty
            currentTime = windowStart;
          } else if (currentTime > windowEnd) {
            timeWindowPenalty += (currentTime - windowEnd) * 5; // Late penalty
          }
        }

        // Priority bonus
        if (options.prioritizeHighPriority) {
          if (customer.priority === 'high') {
            priorityBonus -= 10; // Negative because lower fitness is better
          } else if (customer.priority === 'medium') {
            priorityBonus -= 5;
          }
        }

        currentTime += this.getEstimatedDuration(customer);
        totalTime += this.getEstimatedDuration(customer);
        currentLocation = customer.location;
      }
    }

    // Add distance to end location if specified
    if (options.endLocation && currentLocation) {
      const { distance } = await this.getDistanceAndDuration(currentLocation, options.endLocation);
      totalDistance += distance;
    }

    // Fitness function (lower is better)
    return totalDistance + (totalTime / 60) + timeWindowPenalty + priorityBonus;
  }

  // ============================================
  // Route Calculation
  // ============================================

  private async calculateRouteDetails(
    customers: Customer[],
    date: string,
    options: RouteOptimizationOptions
  ): Promise<OptimizedRoute> {
    const stops: RouteStop[] = [];
    let totalDistance = 0;
    let totalTime = 0;
    let totalTravelTime = 0;
    let totalServiceTime = 0;
    let totalWaitTime = 0;

    let currentLocation = options.startLocation || customers[0]?.location;
    let currentTime = this.parseTime(options.startTime || '08:00');

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      let travelTime = 0;
      let distance = 0;
      const serviceDuration = this.getEstimatedDuration(customer);

      if (currentLocation && customer.location) {
        const result = await this.getDistanceAndDuration(currentLocation, customer.location);
        travelTime = result.duration;
        distance = result.distance;
        totalDistance += distance;
        totalTime += travelTime;
        totalTravelTime += travelTime;
        currentTime += travelTime;
      }

      // Handle time windows
      if (customer.timeWindow) {
        const windowStart = this.parseTime(customer.timeWindow.start);
        if (currentTime < windowStart) {
          const waitTime = windowStart - currentTime;
          totalTime += waitTime;
          totalWaitTime += waitTime;
          currentTime = windowStart; // Wait until window opens
        }
      }

      const arrivalTime = this.formatTime(currentTime);
      currentTime += serviceDuration;
      totalTime += serviceDuration;
      totalServiceTime += serviceDuration;
      const departureTime = this.formatTime(currentTime);

      stops.push({
        customer,
        arrivalTime,
        departureTime,
        travelTime,
        distance
      });

      currentLocation = customer.location;
    }

    return {
      id: `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      date,
      stops,
      totalDistance,
      totalTime,
      totalTravelTime,
      totalServiceTime,
      totalWaitTime,
      startLocation: options.startLocation,
      endLocation: options.endLocation,
      optimizationMethod: options.algorithm || 'nearest-neighbor',
      createdAt: new Date().toISOString()
    };
  }

  // ============================================
  // Geocoding & Distance Calculation
  // ============================================

  private async ensureLocations(customers: Customer[]): Promise<Customer[]> {
    const customersWithLocations: Customer[] = [];

    for (const customer of customers) {
      if (customer.location) {
        customersWithLocations.push(customer);
        continue;
      }

      const location = await this.geocodeAddress(customer.address);
      customersWithLocations.push({ ...customer, location });
    }

    return customersWithLocations;
  }

  private async geocodeAddress(address: string): Promise<Location> {
    const normalizedAddress = (address || '').trim().toLowerCase();

    // Check cache first
    if (this.geocodeCache.has(normalizedAddress)) {
      return this.geocodeCache.get(normalizedAddress)!;
    }

    try {
      const { zipCode, localityKey, streetName, houseNumber } = this.parseAddressComponents(normalizedAddress);
      const localitySeed = zipCode || localityKey || 'default-locality';
      const localityHash = this.hashString(localitySeed);
      const baseLatOffset = (((localityHash % 10000) / 10000) - 0.5) * 0.16;
      const baseLngOffset = ((((Math.floor(localityHash / 10000)) % 10000) / 10000) - 0.5) * 0.16;

      const streetSeed = `${localitySeed}|${streetName || 'unknown-street'}`;
      const streetHash = this.hashString(streetSeed);
      const streetAngleRadians = ((streetHash % 360) * Math.PI) / 180;
      const streetRadius = ((((Math.floor(streetHash / 360)) % 1000) / 1000) - 0.5) * 0.02;

      const baseLatitude = 34.0522 + baseLatOffset;
      const baseLongitude = -118.2437 + baseLngOffset;
      const streetLatitude = baseLatitude + Math.cos(streetAngleRadians) * streetRadius;
      const streetLongitude = baseLongitude + Math.sin(streetAngleRadians) * streetRadius;

      const normalizedHouse = Number.isFinite(houseNumber as number) && houseNumber !== null
        ? (((houseNumber as number) % 2000) - 1000) / 1000
        : 0;
      const alongStreetStep = 0.0035; // ~0.2-0.3 miles per 1000-number range

      // Deterministic, address-aware fallback location.
      const location: Location = {
        latitude: streetLatitude + Math.cos(streetAngleRadians) * normalizedHouse * alongStreetStep,
        longitude: streetLongitude + Math.sin(streetAngleRadians) * normalizedHouse * alongStreetStep,
        address
      };

      this.geocodeCache.set(normalizedAddress, location);
      return location;
    } catch (error) {
      console.error('Geocoding failed for address:', address, error);
      
      // Return default location
      const defaultLocation: Location = {
        latitude: 34.0522,
        longitude: -118.2437,
        address
      };
      
      return defaultLocation;
    }
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(loc2.latitude - loc1.latitude);
    const dLon = this.toRadians(loc2.longitude - loc1.longitude);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(loc1.latitude)) * Math.cos(this.toRadians(loc2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private async getDistanceAndDuration(
    from: Location,
    to: Location
  ): Promise<{ distance: number; duration: number }> {
    const cacheKey = `${from.latitude},${from.longitude}-${to.latitude},${to.longitude}`;
    
    if (this.distanceCache.has(cacheKey)) {
      return this.distanceCache.get(cacheKey)!;
    }

    // Calculate straight-line distance
    const distance = this.calculateDistance(from, to);
    
    // Estimate duration (assuming 30 mph average with traffic)
    const duration = distance <= 0 ? 0 : Math.max(2, (distance / 30) * 60); // Convert to minutes with a realistic minimum
    
    const result = { distance, duration };
    this.distanceCache.set(cacheKey, result);
    
    return result;
  }

  // ============================================
  // Utility Functions
  // ============================================

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private parseAddressComponents(normalizedAddress: string): {
    zipCode: string | null;
    localityKey: string;
    streetName: string;
    houseNumber: number | null;
  } {
    const safeAddress = normalizedAddress || '';
    const parts = safeAddress.split(',').map((part) => part.trim()).filter(Boolean);
    const streetPart = parts[0] || safeAddress;
    const localityKey = parts.slice(1).join(',') || '';
    const zipMatch = safeAddress.match(/\b\d{5}(?:-\d{4})?\b/);
    const zipCode = zipMatch ? zipMatch[0].slice(0, 5) : null;

    const houseMatch = streetPart.match(/\b\d{1,6}\b/);
    const parsedHouse = houseMatch ? Number(houseMatch[0]) : NaN;
    const houseNumber = Number.isFinite(parsedHouse) ? parsedHouse : null;

    const streetName = streetPart
      .replace(/\b\d{1,6}\b/g, ' ')
      .replace(/\b(apt|apartment|unit|ste|suite|#)\s*[a-z0-9-]+\b/g, ' ')
      .replace(/\b(off|near|at|by)\b/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'unknown-street';

    return { zipCode, localityKey, streetName, houseNumber };
  }

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
    const id = Number(idCandidate);

    if (!Number.isFinite(id)) {
      return null;
    }

    const name =
      (typeof customerRecord.name === 'string' && customerRecord.name) ||
      (typeof customerRecord.full_name === 'string' && customerRecord.full_name) ||
      `Customer ${id}`;
    const address = typeof customerRecord.address === 'string' ? customerRecord.address : '';

    const rawLocation = customerRecord.location as Record<string, unknown> | undefined;
    const latitude = Number(rawLocation?.latitude ?? rawLocation?.lat);
    const longitude = Number(rawLocation?.longitude ?? rawLocation?.lng);
    const location = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude, address }
      : undefined;

    const normalizedServiceDay = this.normalizeDayName(
      (customerRecord.serviceDay as string | undefined) ??
      (customerRecord.service_day as string | undefined)
    );

    if (!normalizedServiceDay) {
      return null;
    }

    return {
      id,
      name,
      address,
      location,
      serviceDay: normalizedServiceDay,
      priority: this.normalizePriority(customerRecord.priority),
      estimatedDuration: this.getEstimatedDuration(customerRecord),
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

  private createEmptyRoute(date: string, options: RouteOptimizationOptions): OptimizedRoute {
    return {
      id: `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      date,
      stops: [],
      totalDistance: 0,
      totalTime: 0,
      totalTravelTime: 0,
      totalServiceTime: 0,
      totalWaitTime: 0,
      startLocation: options.startLocation,
      endLocation: options.endLocation,
      optimizationMethod: options.algorithm || 'nearest-neighbor',
      createdAt: new Date().toISOString()
    };
  }

  // ============================================
  // Route Management
  // ============================================

  saveRoute(route: OptimizedRoute): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const routes = this.getSavedRoutes();
    routes.push(route);
    localStorage.setItem('optimized_routes', JSON.stringify(routes));
  }

  getSavedRoutes(): OptimizedRoute[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const stored = localStorage.getItem('optimized_routes');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  getRouteForDate(date: string): OptimizedRoute | null {
    const routes = this.getSavedRoutes();
    return routes.find(route => route.date === date) || null;
  }

  deleteRoute(routeId: string): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const routes = this.getSavedRoutes();
    const filtered = routes.filter(route => route.id !== routeId);
    localStorage.setItem('optimized_routes', JSON.stringify(filtered));
  }
}

// Global route optimizer instance
export const routeOptimizer = new RouteOptimizer();

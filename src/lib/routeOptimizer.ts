// Advanced Route Optimization
// Optimizes service routes using GPS coordinates and various algorithms

import { monitoring } from './monitoring';
import { userManager } from './userManager';

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

class RouteOptimizer {
  private geocodeCache = new Map<string, Location>();
  private distanceCache = new Map<string, { distance: number; duration: number }>();

  // ============================================
  // Main Optimization Function
  // ============================================

  async optimizeRoute(
    customers: Customer[],
    date: string,
    options: RouteOptimizationOptions = {}
  ): Promise<OptimizedRoute> {
    const startTime = performance.now();
    
    try {
      // Ensure all customers have locations
      await this.ensureLocations(customers);
      
      // Filter customers for the specific day
      const dayCustomers = customers.filter(c => c.serviceDay === this.getDayOfWeek(date));
      
      if (dayCustomers.length === 0) {
        return this.createEmptyRoute(date, options);
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
      const route = await this.calculateRouteDetails(optimizedOrder, date, options);
      
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
          customerCount: customers.length,
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
        if (customer.timeWindow) {
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
        if (customer.priority === 'high') {
          priorityBonus -= 10; // Negative because lower fitness is better
        } else if (customer.priority === 'medium') {
          priorityBonus -= 5;
        }

        currentTime += customer.estimatedDuration;
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

    let currentLocation = options.startLocation || customers[0]?.location;
    let currentTime = this.parseTime(options.startTime || '08:00');

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      let travelTime = 0;
      let distance = 0;

      if (currentLocation && customer.location) {
        const result = await this.getDistanceAndDuration(currentLocation, customer.location);
        travelTime = result.duration;
        distance = result.distance;
        totalDistance += distance;
        totalTime += travelTime;
        currentTime += travelTime;
      }

      // Handle time windows
      if (customer.timeWindow) {
        const windowStart = this.parseTime(customer.timeWindow.start);
        if (currentTime < windowStart) {
          currentTime = windowStart; // Wait until window opens
        }
      }

      const arrivalTime = this.formatTime(currentTime);
      currentTime += customer.estimatedDuration;
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
      startLocation: options.startLocation,
      endLocation: options.endLocation,
      optimizationMethod: options.algorithm || 'nearest-neighbor',
      createdAt: new Date().toISOString()
    };
  }

  // ============================================
  // Geocoding & Distance Calculation
  // ============================================

  private async ensureLocations(customers: Customer[]): Promise<void> {
    for (const customer of customers) {
      if (!customer.location) {
        customer.location = await this.geocodeAddress(customer.address);
      }
    }
  }

  private async geocodeAddress(address: string): Promise<Location> {
    // Check cache first
    if (this.geocodeCache.has(address)) {
      return this.geocodeCache.get(address)!;
    }

    try {
      // For demo purposes, generate random coordinates
      // In production, use a real geocoding service like Google Maps API
      const location: Location = {
        latitude: 34.0522 + (Math.random() - 0.5) * 0.1, // Los Angeles area
        longitude: -118.2437 + (Math.random() - 0.5) * 0.1,
        address
      };

      this.geocodeCache.set(address, location);
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
    const duration = (distance / 30) * 60; // Convert to minutes
    
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

  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private formatTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  private getDayOfWeek(dateStr: string): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = new Date(dateStr);
    return days[date.getDay()];
  }

  private createEmptyRoute(date: string, options: RouteOptimizationOptions): OptimizedRoute {
    return {
      id: `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      date,
      stops: [],
      totalDistance: 0,
      totalTime: 0,
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
    const routes = this.getSavedRoutes();
    routes.push(route);
    localStorage.setItem('optimized_routes', JSON.stringify(routes));
  }

  getSavedRoutes(): OptimizedRoute[] {
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
    const routes = this.getSavedRoutes();
    const filtered = routes.filter(route => route.id !== routeId);
    localStorage.setItem('optimized_routes', JSON.stringify(filtered));
  }
}

// Global route optimizer instance
export const routeOptimizer = new RouteOptimizer();
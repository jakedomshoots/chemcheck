/**
 * Property-Based Tests for Weather Analyzer
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { WeatherAnalyzer, analyzeWeatherImpact } from './weatherAnalyzer';
import type { WeatherForecast, WeatherCondition, ServiceLog, ChemicalReading } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid weather conditions
 */
const weatherConditionArb = fc.constantFrom<WeatherCondition>('sunny', 'cloudy', 'rain', 'storm');

/**
 * Generator for a valid date string in YYYY-MM-DD format
 */
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([year, month, day]) => 
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

/**
 * Generator for a valid weather forecast entry
 */
const weatherForecastArb: fc.Arbitrary<WeatherForecast> = fc.record({
  date: dateStringArb,
  condition: weatherConditionArb,
  highTemp: fc.integer({ min: 50, max: 110 }),
  lowTemp: fc.integer({ min: 40, max: 90 }),
  precipitation: fc.float({ min: 0, max: 5, noNaN: true }),
  humidity: fc.integer({ min: 0, max: 100 }),
}).map(f => ({
  ...f,
  // Ensure lowTemp <= highTemp
  lowTemp: Math.min(f.lowTemp, f.highTemp),
  highTemp: Math.max(f.lowTemp, f.highTemp),
}));

/**
 * Generator for a non-empty array of weather forecasts
 */
const weatherForecastArrayArb = fc.array(weatherForecastArb, { minLength: 1, maxLength: 14 });

/**
 * Generator for valid chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for a service log
 */
const serviceLogArb: fc.Arbitrary<ServiceLog> = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: chemicalReadingArb,
  chlorine: chemicalReadingArb,
  alkalinity: chemicalReadingArb,
  stabilizer: chemicalReadingArb,
  notes: fc.option(fc.string(), { nil: undefined }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Weather Analyzer - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 15: Weather Impact Graceful Degradation**
   * 
   * *For any* analysis where weather data is unavailable, the weatherImpact 
   * field SHALL be null and the analysis SHALL complete successfully without 
   * weather-related predictions.
   * 
   * **Validates: Requirements 9.5**
   */
  describe('Property 15: Weather Impact Graceful Degradation', () => {
    it('should return null when forecast is null', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (poolHistory) => {
            const result = analyzeWeatherImpact(null, poolHistory);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null when forecast is undefined', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (poolHistory) => {
            const result = analyzeWeatherImpact(undefined, poolHistory);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null when forecast is an empty array', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (poolHistory) => {
            const result = analyzeWeatherImpact([], poolHistory);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should complete successfully with valid forecast data', () => {
      fc.assert(
        fc.property(
          weatherForecastArrayArb,
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (forecast, poolHistory) => {
            const result = analyzeWeatherImpact(forecast, poolHistory);
            
            // Should return a valid WeatherImpact object
            expect(result).not.toBeNull();
            expect(result!.forecast).toEqual(forecast);
            expect(Array.isArray(result!.impacts)).toBe(true);
            expect(['low', 'moderate', 'high']).toContain(result!.overallRisk);
            expect(typeof result!.summary).toBe('string');
            expect(result!.summary.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('WeatherAnalyzer class should handle null/undefined gracefully', () => {
      const analyzer = new WeatherAnalyzer();
      
      expect(analyzer.analyze(null)).toBeNull();
      expect(analyzer.analyze(undefined)).toBeNull();
      expect(analyzer.analyze([])).toBeNull();
    });

    it('should work with any valid pool history when weather is unavailable', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 20 }),
          (poolHistory) => {
            // Test all unavailable weather scenarios
            expect(analyzeWeatherImpact(null, poolHistory)).toBeNull();
            expect(analyzeWeatherImpact(undefined, poolHistory)).toBeNull();
            expect(analyzeWeatherImpact([], poolHistory)).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional property tests for weather impact detection
   */
  describe('Weather Impact Detection', () => {
    it('should detect impacts for rain conditions', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              date: dateStringArb,
              condition: fc.constant<WeatherCondition>('rain'),
              highTemp: fc.integer({ min: 70, max: 90 }),
              lowTemp: fc.integer({ min: 60, max: 70 }),
              precipitation: fc.float({ min: 0.5, max: 3, noNaN: true }),
              humidity: fc.integer({ min: 50, max: 90 }),
            }),
            { minLength: 1, maxLength: 7 }
          ),
          (forecast) => {
            const result = analyzeWeatherImpact(forecast);
            
            expect(result).not.toBeNull();
            // Rain should trigger pH-related impacts
            const hasPhImpact = result!.impacts.some(i => i.chemical === 'pH');
            expect(hasPhImpact).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect impacts for high temperature conditions', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              date: dateStringArb,
              condition: fc.constant<WeatherCondition>('sunny'),
              highTemp: fc.integer({ min: 90, max: 110 }),
              lowTemp: fc.integer({ min: 75, max: 85 }),
              precipitation: fc.constant(0),
              humidity: fc.integer({ min: 30, max: 60 }),
            }),
            { minLength: 1, maxLength: 7 }
          ),
          (forecast) => {
            const result = analyzeWeatherImpact(forecast);
            
            expect(result).not.toBeNull();
            // High temps should trigger chlorine-related impacts
            const hasChlorineImpact = result!.impacts.some(i => i.chemical === 'chlorine');
            expect(hasChlorineImpact).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate higher risk for storm conditions', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              date: dateStringArb,
              condition: fc.constant<WeatherCondition>('storm'),
              highTemp: fc.integer({ min: 70, max: 90 }),
              lowTemp: fc.integer({ min: 60, max: 70 }),
              precipitation: fc.float({ min: 1, max: 4, noNaN: true }),
              humidity: fc.integer({ min: 70, max: 100 }),
            }),
            { minLength: 1, maxLength: 7 }
          ),
          (forecast) => {
            const result = analyzeWeatherImpact(forecast);
            
            expect(result).not.toBeNull();
            // Storms should result in moderate or high risk
            expect(['moderate', 'high']).toContain(result!.overallRisk);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return low risk for mild sunny conditions', () => {
      const mildForecast: WeatherForecast[] = [
        {
          date: '2025-06-15',
          condition: 'sunny',
          highTemp: 78,
          lowTemp: 65,
          precipitation: 0,
          humidity: 45,
        },
      ];
      
      const result = analyzeWeatherImpact(mildForecast);
      
      expect(result).not.toBeNull();
      expect(result!.overallRisk).toBe('low');
    });
  });

  /**
   * Summary generation tests
   */
  describe('Summary Generation', () => {
    it('should always generate a non-empty summary for valid forecasts', () => {
      fc.assert(
        fc.property(
          weatherForecastArrayArb,
          (forecast) => {
            const result = analyzeWeatherImpact(forecast);
            
            expect(result).not.toBeNull();
            expect(result!.summary).toBeTruthy();
            expect(result!.summary.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include warning emoji for high risk conditions', () => {
      const stormForecast: WeatherForecast[] = [
        {
          date: '2025-06-15',
          condition: 'storm',
          highTemp: 95,
          lowTemp: 75,
          precipitation: 2.5,
          humidity: 90,
        },
        {
          date: '2025-06-16',
          condition: 'storm',
          highTemp: 100,
          lowTemp: 80,
          precipitation: 3.0,
          humidity: 85,
        },
      ];
      
      const result = analyzeWeatherImpact(stormForecast);
      
      expect(result).not.toBeNull();
      expect(result!.overallRisk).toBe('high');
      expect(result!.summary).toContain('⚠️');
    });
  });
});

/**
 * Weather Analyzer
 * 
 * Analyzes weather data to predict impacts on pool chemistry and generate
 * preemptive action recommendations.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.5
 */

import {
  WeatherForecast,
  WeatherImpact,
  WeatherChemicalImpact,
  WeatherCondition,
  OverallRisk,
  ImpactSeverity,
  ServiceLog,
} from './types';

// ============================================================================
// Weather Impact Rules
// ============================================================================

interface WeatherRule {
  condition: (forecast: WeatherForecast) => boolean;
  chemical: string;
  effect: string;
  severity: ImpactSeverity;
  action: string;
}

/**
 * Weather impact rules based on pool chemistry science:
 * - Rain dilutes chemicals and affects pH/alkalinity
 * - Heat increases chlorine demand and algae risk
 * - High humidity can affect evaporation rates
 * - Storms bring debris and contaminants
 */
const WEATHER_RULES: WeatherRule[] = [
  // Rain impacts (Requirement 9.1)
  {
    condition: (f) => f.condition === 'rain' || f.condition === 'storm',
    chemical: 'pH',
    effect: 'Rain dilutes pool water and typically lowers pH levels',
    severity: 'medium',
    action: 'Test pH after rain and add pH increaser if below 7.2',
  },
  {
    condition: (f) => f.condition === 'rain' && f.precipitation > 0.5,
    chemical: 'alkalinity',
    effect: 'Heavy rain significantly dilutes alkalinity levels',
    severity: 'high',
    action: 'Add alkalinity increaser after heavy rain to restore buffer capacity',
  },
  {
    condition: (f) => f.condition === 'storm',
    chemical: 'chlorine',
    effect: 'Storm debris introduces contaminants requiring extra sanitization',
    severity: 'high',
    action: 'Shock pool after storm and remove debris promptly',
  },
  {
    condition: (f) => f.precipitation > 1.0,
    chemical: 'stabilizer',
    effect: 'Heavy precipitation dilutes stabilizer (CYA) levels',
    severity: 'medium',
    action: 'Check stabilizer levels after significant rainfall',
  },
  
  // Heat impacts (Requirement 9.2)
  {
    condition: (f) => f.highTemp >= 90,
    chemical: 'chlorine',
    effect: 'High temperatures accelerate chlorine consumption',
    severity: 'high',
    action: 'Increase chlorine dosage or run chlorinator longer during heat waves',
  },
  {
    condition: (f) => f.highTemp >= 85,
    chemical: 'algae',
    effect: 'Warm water promotes algae growth',
    severity: 'medium',
    action: 'Maintain higher chlorine levels and consider algaecide treatment',
  },
  {
    condition: (f) => f.highTemp >= 95,
    chemical: 'pH',
    effect: 'Extreme heat can cause pH to rise due to increased outgassing',
    severity: 'medium',
    action: 'Monitor pH more frequently during extreme heat',
  },
  
  // Humidity impacts
  {
    condition: (f) => f.humidity >= 80 && f.highTemp >= 85,
    chemical: 'chlorine',
    effect: 'High humidity combined with heat creates ideal conditions for bacteria',
    severity: 'medium',
    action: 'Ensure chlorine levels are at upper end of acceptable range',
  },
  
  // Sunny conditions
  {
    condition: (f) => f.condition === 'sunny' && f.highTemp >= 80,
    chemical: 'chlorine',
    effect: 'UV rays break down chlorine faster on sunny days',
    severity: 'low',
    action: 'Verify stabilizer levels are adequate to protect chlorine from UV',
  },
];

// ============================================================================
// Configuration
// ============================================================================

export interface WeatherAnalyzerConfig {
  /** Number of forecast days to analyze */
  forecastDays: number;
  /** Temperature threshold for heat warnings (°F) */
  heatThreshold: number;
  /** Precipitation threshold for rain warnings (inches) */
  rainThreshold: number;
}

const DEFAULT_CONFIG: WeatherAnalyzerConfig = {
  forecastDays: 7,
  heatThreshold: 90,
  rainThreshold: 0.25,
};

// ============================================================================
// Main Weather Analyzer Class
// ============================================================================

export class WeatherAnalyzer {
  private config: WeatherAnalyzerConfig;

  constructor(config: Partial<WeatherAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyzes weather forecast data and returns predicted impacts on pool chemistry.
   * Returns null if weather data is unavailable (graceful degradation per Requirement 9.5).
   */
  analyze(
    forecast: WeatherForecast[] | null | undefined,
    _poolHistory?: ServiceLog[]
  ): WeatherImpact | null {
    // Graceful degradation when weather unavailable (Requirement 9.5)
    if (!forecast || forecast.length === 0) {
      return null;
    }

    const impacts = this.detectImpacts(forecast);
    const overallRisk = this.calculateOverallRisk(impacts, forecast);
    const summary = this.generateSummary(impacts, forecast, overallRisk);

    return {
      forecast,
      impacts,
      overallRisk,
      summary,
    };
  }

  /**
   * Detects chemical impacts based on weather rules
   */
  private detectImpacts(forecast: WeatherForecast[]): WeatherChemicalImpact[] {
    const impactMap = new Map<string, WeatherChemicalImpact>();

    for (const day of forecast) {
      for (const rule of WEATHER_RULES) {
        if (rule.condition(day)) {
          const key = `${rule.chemical}-${rule.effect}`;
          
          // Keep the highest severity impact for each chemical-effect combination
          const existing = impactMap.get(key);
          if (!existing || this.severityRank(rule.severity) > this.severityRank(existing.severity)) {
            impactMap.set(key, {
              chemical: rule.chemical,
              expectedEffect: rule.effect,
              severity: rule.severity,
              preemptiveAction: rule.action,
            });
          }
        }
      }
    }

    // Sort by severity (high first)
    return Array.from(impactMap.values()).sort(
      (a, b) => this.severityRank(b.severity) - this.severityRank(a.severity)
    );
  }

  /**
   * Calculates overall risk level based on detected impacts
   */
  private calculateOverallRisk(
    impacts: WeatherChemicalImpact[],
    forecast: WeatherForecast[]
  ): OverallRisk {
    if (impacts.length === 0) {
      return 'low';
    }

    const highSeverityCount = impacts.filter((i) => i.severity === 'high').length;
    const mediumSeverityCount = impacts.filter((i) => i.severity === 'medium').length;

    // Check for severe weather conditions
    const hasStorm = forecast.some((f) => f.condition === 'storm');
    const hasExtremeHeat = forecast.some((f) => f.highTemp >= 100);
    const hasHeavyRain = forecast.some((f) => f.precipitation > 1.0);

    if (hasStorm || hasExtremeHeat || highSeverityCount >= 2) {
      return 'high';
    }

    if (hasHeavyRain || highSeverityCount >= 1 || mediumSeverityCount >= 2) {
      return 'moderate';
    }

    return 'low';
  }

  /**
   * Generates a human-readable summary of weather impacts
   */
  private generateSummary(
    impacts: WeatherChemicalImpact[],
    forecast: WeatherForecast[],
    overallRisk: OverallRisk
  ): string {
    if (impacts.length === 0) {
      return 'Weather conditions look favorable for pool maintenance. No significant impacts expected.';
    }

    const parts: string[] = [];

    // Overall risk statement
    switch (overallRisk) {
      case 'high':
        parts.push('⚠️ High weather risk detected.');
        break;
      case 'moderate':
        parts.push('Weather conditions may affect pool chemistry.');
        break;
      case 'low':
        parts.push('Minor weather impacts possible.');
        break;
    }

    // Specific conditions
    const conditions = this.summarizeConditions(forecast);
    if (conditions) {
      parts.push(conditions);
    }

    // Key impacts
    const highImpacts = impacts.filter((i) => i.severity === 'high');
    if (highImpacts.length > 0) {
      const chemicals = [...new Set(highImpacts.map((i) => i.chemical))];
      parts.push(`Pay special attention to ${chemicals.join(', ')} levels.`);
    }

    // Action count
    const actionCount = impacts.length;
    if (actionCount > 0) {
      parts.push(`${actionCount} preemptive action${actionCount > 1 ? 's' : ''} recommended.`);
    }

    return parts.join(' ');
  }

  /**
   * Summarizes weather conditions from forecast
   */
  private summarizeConditions(forecast: WeatherForecast[]): string {
    const conditions: string[] = [];

    const hasRain = forecast.some((f) => f.condition === 'rain');
    const hasStorm = forecast.some((f) => f.condition === 'storm');
    const maxTemp = Math.max(...forecast.map((f) => f.highTemp));
    const totalPrecip = forecast.reduce((sum, f) => sum + f.precipitation, 0);

    if (hasStorm) {
      conditions.push('storms expected');
    } else if (hasRain) {
      conditions.push('rain in forecast');
    }

    if (maxTemp >= 95) {
      conditions.push(`extreme heat (up to ${maxTemp}°F)`);
    } else if (maxTemp >= 90) {
      conditions.push(`high temperatures (up to ${maxTemp}°F)`);
    }

    if (totalPrecip > 1.0) {
      conditions.push(`significant rainfall (${totalPrecip.toFixed(1)}" total)`);
    }

    if (conditions.length === 0) {
      return '';
    }

    return `Expecting ${conditions.join(', ')}.`;
  }

  /**
   * Converts severity to numeric rank for comparison
   */
  private severityRank(severity: ImpactSeverity): number {
    switch (severity) {
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 0;
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Analyzes weather impact on pool chemistry.
 * Returns null if weather data is unavailable (graceful degradation).
 */
export function analyzeWeatherImpact(
  forecast: WeatherForecast[] | null | undefined,
  poolHistory?: ServiceLog[],
  config?: Partial<WeatherAnalyzerConfig>
): WeatherImpact | null {
  const analyzer = new WeatherAnalyzer(config);
  return analyzer.analyze(forecast, poolHistory);
}

/**
 * Creates a sample weather forecast for testing
 */
export function createSampleForecast(days: number = 7): WeatherForecast[] {
  const conditions: WeatherCondition[] = ['sunny', 'cloudy', 'rain', 'storm'];
  const forecast: WeatherForecast[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    
    forecast.push({
      date: date.toISOString().split('T')[0],
      condition: conditions[i % conditions.length],
      highTemp: 75 + Math.floor(Math.random() * 25),
      lowTemp: 60 + Math.floor(Math.random() * 15),
      precipitation: Math.random() < 0.3 ? Math.random() * 2 : 0,
      humidity: 40 + Math.floor(Math.random() * 50),
    });
  }

  return forecast;
}

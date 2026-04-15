// Pool Chemical Analysis & Insights Engine
// Analyzes service history to provide trends, problems, and recommendations

export interface ServiceLog {
  id: number;
  service_date: string;
  ph: string;
  chlorine: string;
  alkalinity: string;
  stabilizer: string;
  salt?: number;
  notes?: string;
}

export interface ChemicalTrend {
  chemical: string;
  trend: 'improving' | 'declining' | 'stable' | 'erratic';
  confidence: number; // 0-100
  description: string;
  values: Array<{ date: string; level: string; score: number }>;
}

export interface PoolProblem {
  type: 'chronic' | 'emerging' | 'seasonal';
  severity: 'low' | 'medium' | 'high' | 'critical';
  chemical: string;
  description: string;
  evidence: string[];
  recommendation: string;
}

export interface ServiceSummary {
  date: string;
  overallStatus: 'excellent' | 'good' | 'fair' | 'poor';
  issues: string[];
  improvements: string[];
  notes: string;
}

export interface PoolAnalysis {
  customerId: number;
  analysisDate: string;
  totalServices: number;
  dateRange: { start: string; end: string };
  
  // Trends
  chemicalTrends: ChemicalTrend[];
  overallTrend: 'improving' | 'declining' | 'stable';
  
  // Problems
  hiddenProblems: PoolProblem[];
  riskFactors: string[];
  
  // Recent summary
  recentVisits: ServiceSummary[];
  
  // Recommendations
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
    maintenance: string[];
  };
  
  // Insights
  insights: {
    bestPerformingChemical: string;
    mostProblematicChemical: string;
    seasonalPatterns: string[];
    serviceFrequencyRecommendation: string;
  };
}

class PoolAnalysisEngine {
  
  // Convert chemical level to numeric score for analysis
  private levelToScore(level: string): number {
    const scoreMap: Record<string, number> = {
      'critical': 1,
      'low': 2,
      'high': 3,
      'good': 4
    };
    return scoreMap[level] || 2;
  }

  // Analyze trend for a specific chemical
  private analyzeChemicalTrend(chemical: string, logs: ServiceLog[]): ChemicalTrend {
    const values = logs
      .filter(log => log[chemical as keyof ServiceLog])
      .map(log => ({
        date: log.service_date,
        level: log[chemical as keyof ServiceLog] as string,
        score: this.levelToScore(log[chemical as keyof ServiceLog] as string)
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (values.length < 2) {
      return {
        chemical,
        trend: 'stable',
        confidence: 0,
        description: 'Insufficient data for trend analysis',
        values
      };
    }

    // Calculate trend using linear regression
    const n = values.length;
    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, v) => sum + v.score, 0);
    const sumXY = values.reduce((sum, v, i) => sum + i * v.score, 0);
    const sumXX = values.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const variance = values.reduce((sum, v) => sum + Math.pow(v.score - sumY / n, 2), 0) / n;
    const confidence = Math.min(100, Math.max(0, (1 - variance / 2) * 100));

    let trend: ChemicalTrend['trend'];
    let description: string;

    if (Math.abs(slope) < 0.1) {
      trend = 'stable';
      description = `${chemical} levels have remained consistently stable`;
    } else if (slope > 0.3) {
      trend = 'improving';
      description = `${chemical} levels show a strong improving trend`;
    } else if (slope > 0.1) {
      trend = 'improving';
      description = `${chemical} levels show a gradual improvement`;
    } else if (slope < -0.3) {
      trend = 'declining';
      description = `${chemical} levels show a concerning decline`;
    } else if (slope < -0.1) {
      trend = 'declining';
      description = `${chemical} levels show a gradual decline`;
    } else {
      // High variance indicates erratic behavior
      if (variance > 1) {
        trend = 'erratic';
        description = `${chemical} levels are inconsistent and erratic`;
      } else {
        trend = 'stable';
        description = `${chemical} levels are relatively stable`;
      }
    }

    return { chemical, trend, confidence, description, values };
  }

  // Detect hidden problems based on patterns
  private detectHiddenProblems(logs: ServiceLog[], trends: ChemicalTrend[]): PoolProblem[] {
    const problems: PoolProblem[] = [];

    // Check for chronic pH issues
    const phTrend = trends.find(t => t.chemical === 'ph');
    if (phTrend) {
      const lowPhCount = phTrend.values.filter(v => v.level === 'low' || v.level === 'critical').length;
      const highPhCount = phTrend.values.filter(v => v.level === 'high').length;
      
      if (lowPhCount > phTrend.values.length * 0.4) {
        problems.push({
          type: 'chronic',
          severity: 'high',
          chemical: 'pH',
          description: 'Chronic low pH indicates potential alkalinity depletion or over-chlorination',
          evidence: [`Low pH in ${lowPhCount} of ${phTrend.values.length} recent services`],
          recommendation: 'Check total alkalinity levels and consider pH buffer system'
        });
      }

      if (highPhCount > phTrend.values.length * 0.3) {
        problems.push({
          type: 'chronic',
          severity: 'medium',
          chemical: 'pH',
          description: 'Frequent high pH may indicate scaling or circulation issues',
          evidence: [`High pH in ${highPhCount} of ${phTrend.values.length} recent services`],
          recommendation: 'Inspect circulation system and consider pH reducer automation'
        });
      }
    }

    // Check for chlorine demand issues
    const chlorineTrend = trends.find(t => t.chemical === 'chlorine');
    if (chlorineTrend) {
      const lowChlorineCount = chlorineTrend.values.filter(v => v.level === 'low' || v.level === 'critical').length;
      
      if (lowChlorineCount > chlorineTrend.values.length * 0.5) {
        problems.push({
          type: 'chronic',
          severity: 'high',
          chemical: 'Chlorine',
          description: 'High chlorine demand suggests organic contamination or inadequate circulation',
          evidence: [`Low chlorine in ${lowChlorineCount} of ${chlorineTrend.values.length} recent services`],
          recommendation: 'Consider shock treatment and inspect filtration system'
        });
      }
    }

    // Check for stabilizer buildup
    const stabilizerTrend = trends.find(t => t.chemical === 'stabilizer');
    if (stabilizerTrend) {
      const highStabCount = stabilizerTrend.values.filter(v => v.level === 'high').length;
      
      if (highStabCount > stabilizerTrend.values.length * 0.3) {
        problems.push({
          type: 'emerging',
          severity: 'medium',
          chemical: 'Stabilizer',
          description: 'Stabilizer buildup reduces chlorine effectiveness',
          evidence: [`High stabilizer in ${highStabCount} of ${stabilizerTrend.values.length} recent services`],
          recommendation: 'Consider partial water replacement to reduce stabilizer levels'
        });
      }
    }

    // Check for erratic patterns
    const erraticChemicals = trends.filter(t => t.trend === 'erratic');
    erraticChemicals.forEach(trend => {
      problems.push({
        type: 'emerging',
        severity: 'medium',
        chemical: trend.chemical,
        description: 'Erratic chemical levels indicate potential equipment or maintenance issues',
        evidence: [`Inconsistent ${trend.chemical} readings over recent services`],
        recommendation: 'Inspect chemical feeders and circulation equipment'
      });
    });

    return problems;
  }

  // Generate service summaries for recent visits
  private generateServiceSummaries(logs: ServiceLog[]): ServiceSummary[] {
    return logs.slice(0, 3).map(log => {
      const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'];
      const scores = chemicals.map(chem => this.levelToScore(log[chem as keyof ServiceLog] as string));
      const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

      let overallStatus: ServiceSummary['overallStatus'];
      if (avgScore >= 3.5) overallStatus = 'excellent';
      else if (avgScore >= 3) overallStatus = 'good';
      else if (avgScore >= 2.5) overallStatus = 'fair';
      else overallStatus = 'poor';

      const issues: string[] = [];
      const improvements: string[] = [];

      chemicals.forEach(chem => {
        const level = log[chem as keyof ServiceLog] as string;
        if (level === 'critical' || level === 'low') {
          issues.push(`${chem.toUpperCase()} was ${level}`);
        } else if (level === 'good') {
          improvements.push(`${chem.toUpperCase()} maintained at good levels`);
        }
      });

      return {
        date: log.service_date,
        overallStatus,
        issues,
        improvements,
        notes: log.notes || ''
      };
    });
  }

  // Generate recommendations based on analysis
  private generateRecommendations(
    trends: ChemicalTrend[], 
    problems: PoolProblem[], 
    logs: ServiceLog[]
  ): PoolAnalysis['recommendations'] {
    const recommendations = {
      immediate: [] as string[],
      shortTerm: [] as string[],
      longTerm: [] as string[],
      maintenance: [] as string[]
    };

    // Immediate actions for critical problems
    const criticalProblems = problems.filter(p => p.severity === 'critical' || p.severity === 'high');
    criticalProblems.forEach(problem => {
      recommendations.immediate.push(problem.recommendation);
    });

    // Short-term actions for declining trends
    const decliningTrends = trends.filter(t => t.trend === 'declining');
    decliningTrends.forEach(trend => {
      recommendations.shortTerm.push(`Address declining ${trend.chemical} trend through targeted treatment`);
    });

    // Long-term recommendations
    const erraticTrends = trends.filter(t => t.trend === 'erratic');
    if (erraticTrends.length > 1) {
      recommendations.longTerm.push('Consider equipment upgrade or automation system for consistent chemical balance');
    }

    // Maintenance recommendations
    const avgServiceInterval = this.calculateAverageServiceInterval(logs);
    if (avgServiceInterval > 7) {
      recommendations.maintenance.push('Consider more frequent service visits for better chemical stability');
    }

    recommendations.maintenance.push('Regular filter cleaning and equipment inspection');
    recommendations.maintenance.push('Monitor and maintain proper water circulation');

    return recommendations;
  }

  // Calculate average days between services
  private calculateAverageServiceInterval(logs: ServiceLog[]): number {
    if (logs.length < 2) return 7;

    const intervals: number[] = [];
    for (let i = 1; i < logs.length; i++) {
      const current = new Date(logs[i-1].service_date);
      const previous = new Date(logs[i].service_date);
      const diffDays = Math.abs((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
      intervals.push(diffDays);
    }

    return intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  }

  // Generate insights
  private generateInsights(trends: ChemicalTrend[], logs: ServiceLog[]): PoolAnalysis['insights'] {
    const chemicalScores = trends.map(trend => ({
      chemical: trend.chemical,
      avgScore: trend.values.reduce((sum, v) => sum + v.score, 0) / trend.values.length
    }));

    const bestPerforming = chemicalScores.reduce((best, current) => 
      current.avgScore > best.avgScore ? current : best
    );

    const mostProblematic = chemicalScores.reduce((worst, current) => 
      current.avgScore < worst.avgScore ? current : worst
    );

    const avgInterval = this.calculateAverageServiceInterval(logs);
    let frequencyRecommendation: string;
    
    if (avgInterval > 10) {
      frequencyRecommendation = 'Consider weekly service for better chemical stability';
    } else if (avgInterval > 7) {
      frequencyRecommendation = 'Current bi-weekly service is adequate';
    } else {
      frequencyRecommendation = 'Current service frequency is optimal';
    }

    return {
      bestPerformingChemical: bestPerforming.chemical,
      mostProblematicChemical: mostProblematic.chemical,
      seasonalPatterns: [], // TODO: Implement seasonal analysis
      serviceFrequencyRecommendation: frequencyRecommendation
    };
  }

  // Main analysis function
  public analyzePool(customerId: number, serviceLogs: ServiceLog[]): PoolAnalysis {
    if (serviceLogs.length === 0) {
      throw new Error('No service logs available for analysis');
    }

    // Sort logs by date (newest first)
    const sortedLogs = [...serviceLogs].sort((a, b) => 
      new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
    );

    const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'];
    const chemicalTrends = chemicals.map(chemical => 
      this.analyzeChemicalTrend(chemical, sortedLogs)
    );

    const hiddenProblems = this.detectHiddenProblems(sortedLogs, chemicalTrends);
    const recentVisits = this.generateServiceSummaries(sortedLogs);
    const recommendations = this.generateRecommendations(chemicalTrends, hiddenProblems, sortedLogs);
    const insights = this.generateInsights(chemicalTrends, sortedLogs);

    // Determine overall trend
    const trendScores = chemicalTrends.map(t => {
      if (t.trend === 'improving') return 1;
      if (t.trend === 'declining') return -1;
      return 0;
    });
    const avgTrendScore = trendScores.reduce((sum, score) => sum + score, 0) / trendScores.length;
    
    let overallTrend: PoolAnalysis['overallTrend'];
    if (avgTrendScore > 0.2) overallTrend = 'improving';
    else if (avgTrendScore < -0.2) overallTrend = 'declining';
    else overallTrend = 'stable';

    return {
      customerId,
      analysisDate: new Date().toISOString(),
      totalServices: sortedLogs.length,
      dateRange: {
        start: sortedLogs[sortedLogs.length - 1].service_date,
        end: sortedLogs[0].service_date
      },
      chemicalTrends,
      overallTrend,
      hiddenProblems,
      riskFactors: hiddenProblems.map(p => p.description),
      recentVisits,
      recommendations,
      insights
    };
  }
}

// Export singleton instance
export const poolAnalysisEngine = new PoolAnalysisEngine();
import { poolAnalysisEngine } from './poolAnalysis';
import type { ServiceLog } from './poolAnalysis';

describe('Pool Analysis Engine', () => {
  const mockServiceLogs: ServiceLog[] = [
    {
      id: 1,
      service_date: '2024-01-15',
      ph: 'good',
      chlorine: 'good',
      alkalinity: 'good',
      stabilizer: 'good',
      salt: 3200,
      notes: 'Pool looking great'
    },
    {
      id: 2,
      service_date: '2024-01-08',
      ph: 'low',
      chlorine: 'low',
      alkalinity: 'good',
      stabilizer: 'good',
      salt: 3100,
      notes: 'Added chemicals'
    },
    {
      id: 3,
      service_date: '2024-01-01',
      ph: 'low',
      chlorine: 'critical',
      alkalinity: 'low',
      stabilizer: 'good',
      salt: 3000,
      notes: 'Heavy usage over holidays'
    },
    {
      id: 4,
      service_date: '2023-12-25',
      ph: 'critical',
      chlorine: 'critical',
      alkalinity: 'low',
      stabilizer: 'high',
      salt: 2900,
      notes: 'Pool needs attention'
    },
    {
      id: 5,
      service_date: '2023-12-18',
      ph: 'low',
      chlorine: 'low',
      alkalinity: 'critical',
      stabilizer: 'high',
      salt: 2800,
      notes: 'Chemical imbalance'
    }
  ];

  test('should analyze pool trends correctly', () => {
    const analysis = poolAnalysisEngine.analyzePool(1, mockServiceLogs);
    
    expect(analysis.customerId).toBe(1);
    expect(analysis.totalServices).toBe(5);
    expect(analysis.chemicalTrends).toHaveLength(4);
    expect(analysis.recentVisits).toHaveLength(3);
  });

  test('should detect improving trends', () => {
    const analysis = poolAnalysisEngine.analyzePool(1, mockServiceLogs);
    
    // pH should show improving trend (critical -> low -> good)
    const phTrend = analysis.chemicalTrends.find(t => t.chemical === 'ph');
    expect(phTrend?.trend).toBe('improving');
  });

  test('should identify chronic problems', () => {
    const analysis = poolAnalysisEngine.analyzePool(1, mockServiceLogs);
    
    // Should detect chronic pH issues
    const phProblems = analysis.hiddenProblems.filter(p => p.chemical === 'pH');
    expect(phProblems.length).toBeGreaterThan(0);
  });

  test('should generate appropriate recommendations', () => {
    const analysis = poolAnalysisEngine.analyzePool(1, mockServiceLogs);
    
    expect(analysis.recommendations.immediate.length).toBeGreaterThan(0);
    expect(analysis.recommendations.maintenance.length).toBeGreaterThan(0);
  });

  test('should provide insights', () => {
    const analysis = poolAnalysisEngine.analyzePool(1, mockServiceLogs);
    
    expect(analysis.insights.bestPerformingChemical).toBeDefined();
    expect(analysis.insights.mostProblematicChemical).toBeDefined();
    expect(analysis.insights.serviceFrequencyRecommendation).toBeDefined();
  });

  test('should handle insufficient data gracefully', () => {
    const singleLog = [mockServiceLogs[0]];
    const analysis = poolAnalysisEngine.analyzePool(1, singleLog);
    
    expect(analysis.totalServices).toBe(1);
    expect(analysis.chemicalTrends.every(t => t.confidence === 0)).toBe(true);
  });

  test('should throw error for empty logs', () => {
    expect(() => {
      poolAnalysisEngine.analyzePool(1, []);
    }).toThrow('No service logs available for analysis');
  });
});
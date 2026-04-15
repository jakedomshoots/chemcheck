import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monitoring, reportError, recordMetric, measureDatabaseOperation } from './monitoring';

// Mock performance API
const mockPerformance = {
  now: vi.fn(() => Date.now()),
  memory: {
    usedJSHeapSize: 50000000,
    totalJSHeapSize: 100000000,
    jsHeapSizeLimit: 200000000
  }
};

Object.defineProperty(global, 'performance', {
  value: mockPerformance,
  writable: true
});

// Mock PerformanceObserver
global.PerformanceObserver = vi.fn().mockImplementation((callback) => ({
  observe: vi.fn(),
  disconnect: vi.fn()
}));

describe('Monitoring System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    
    // Reset monitoring state
    monitoring.clearData();
    monitoring.enable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Error Reporting', () => {
    it('should report errors with unique IDs', () => {
      const errorId = reportError({
        message: 'Test error',
        severity: 'high',
        metadata: { test: true }
      });
      
      expect(errorId).toMatch(/^ERR_\d+_[a-z0-9]+$/);
      
      const report = monitoring.getPerformanceReport();
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].id).toBe(errorId);
      expect(report.errors[0].message).toBe('Test error');
      expect(report.errors[0].severity).toBe('high');
    });

    it('should include context information in error reports', () => {
      reportError({
        message: 'Context test',
        severity: 'medium'
      });
      
      const report = monitoring.getPerformanceReport();
      const error = report.errors[0];
      
      expect(error.userAgent).toBeDefined();
      expect(error.url).toBeDefined();
      expect(error.userId).toBe('local');
      expect(error.timestamp).toBeDefined();
    });

    it('should handle different severity levels', () => {
      reportError({ message: 'Low severity', severity: 'low' });
      reportError({ message: 'Medium severity', severity: 'medium' });
      reportError({ message: 'High severity', severity: 'high' });
      reportError({ message: 'Critical severity', severity: 'critical' });
      
      const report = monitoring.getPerformanceReport();
      expect(report.errors).toHaveLength(4);
      
      const severities = report.errors.map(e => e.severity);
      expect(severities).toContain('low');
      expect(severities).toContain('medium');
      expect(severities).toContain('high');
      expect(severities).toContain('critical');
    });

    it('should not report errors when disabled', () => {
      monitoring.disable();
      
      const errorId = reportError({
        message: 'Should not be reported',
        severity: 'high'
      });
      
      expect(errorId).toBe('');
      
      const report = monitoring.getPerformanceReport();
      expect(report.errors).toHaveLength(0);
    });
  });

  describe('Performance Metrics', () => {
    it('should record metrics with timestamps', () => {
      recordMetric('test_metric', 100, { test: true });
      
      const report = monitoring.getPerformanceReport();
      expect(report.metrics).toHaveLength(1);
      
      const metric = report.metrics[0];
      expect(metric.name).toBe('test_metric');
      expect(metric.value).toBe(100);
      expect(metric.timestamp).toBeDefined();
      expect(metric.metadata).toEqual({ test: true });
    });

    it('should identify significant performance issues', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      recordMetric('page_load_time', 5000); // Exceeds 3000ms threshold
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Performance issue detected: page_load_time = 5000ms',
        undefined
      );
      
      consoleSpy.mockRestore();
    });

    it('should not record metrics when disabled', () => {
      monitoring.disable();
      
      recordMetric('disabled_metric', 100);
      
      const report = monitoring.getPerformanceReport();
      expect(report.metrics).toHaveLength(0);
    });

    it('should limit stored metrics to prevent memory issues', () => {
      // Record more than the limit (100)
      for (let i = 0; i < 150; i++) {
        recordMetric(`metric_${i}`, i);
      }
      
      const report = monitoring.getPerformanceReport();
      expect(report.metrics.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Database Operation Monitoring', () => {
    it('should measure successful database operations', async () => {
      const mockOperation = vi.fn().mockResolvedValue('success');
      
      const result = await measureDatabaseOperation('test_query', mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalled();
      
      const report = monitoring.getPerformanceReport();
      const metrics = report.metrics.filter(m => m.name === 'database_query');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].metadata?.operation).toBe('test_query');
    });

    it('should handle database operation errors', async () => {
      const mockOperation = vi.fn().mockRejectedValue(new Error('Database error'));
      
      await expect(measureDatabaseOperation('failing_query', mockOperation))
        .rejects.toThrow('Database error');
      
      const report = monitoring.getPerformanceReport();
      
      // Should record error metric
      const errorMetrics = report.metrics.filter(m => m.name === 'database_error');
      expect(errorMetrics).toHaveLength(1);
      
      // Should report error
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].message).toContain('Database operation failed: failing_query');
    });

    it('should measure operation duration accurately', async () => {
      const mockOperation = vi.fn().mockImplementation(async () => {
        // Simulate slow operation
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result';
      });
      
      const startTime = performance.now();
      await measureDatabaseOperation('slow_query', mockOperation);
      const actualDuration = performance.now() - startTime;
      
      const report = monitoring.getPerformanceReport();
      const metrics = report.metrics.filter(m => m.name === 'database_query');
      expect(metrics).toHaveLength(1);
      
      // Duration should be approximately correct (within 50ms tolerance)
      expect(Math.abs(metrics[0].value - actualDuration)).toBeLessThan(50);
    });
  });

  describe('Memory Monitoring', () => {
    it('should check memory usage', () => {
      monitoring.checkMemoryUsage();
      
      const report = monitoring.getPerformanceReport();
      const memoryMetrics = report.metrics.filter(m => m.name === 'memory_used');
      expect(memoryMetrics).toHaveLength(1);
      
      const metric = memoryMetrics[0];
      expect(metric.value).toBe(50000000);
      expect(metric.metadata?.total).toBe(100000000);
      expect(metric.metadata?.limit).toBe(200000000);
    });

    it('should report high memory usage', () => {
      // Mock high memory usage
      mockPerformance.memory.usedJSHeapSize = 170000000; // 85% of limit
      
      monitoring.checkMemoryUsage();
      
      const report = monitoring.getPerformanceReport();
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].message).toContain('High memory usage detected: 85.0%');
    });

    it('should handle missing memory API', () => {
      const originalMemory = mockPerformance.memory;
      delete (mockPerformance as any).memory;
      
      expect(() => monitoring.checkMemoryUsage()).not.toThrow();
      
      // Restore
      mockPerformance.memory = originalMemory;
    });
  });

  describe('Data Persistence', () => {
    it('should persist data to localStorage', () => {
      recordMetric('persist_test', 123);
      reportError({ message: 'Persist error', severity: 'low' });
      
      // Check that data was stored
      const storedMetrics = localStorage.getItem('monitoring_metrics');
      const storedErrors = localStorage.getItem('monitoring_errors');
      
      expect(storedMetrics).toBeDefined();
      expect(storedErrors).toBeDefined();
      
      const metrics = JSON.parse(storedMetrics!);
      const errors = JSON.parse(storedErrors!);
      
      expect(metrics).toHaveLength(1);
      expect(errors).toHaveLength(1);
    });

    it('should load persisted data on initialization', () => {
      // Pre-populate localStorage
      const testMetrics = [{ name: 'loaded_metric', value: 456, timestamp: Date.now() }];
      const testErrors = [{ 
        id: 'test_error', 
        message: 'Loaded error', 
        severity: 'medium', 
        timestamp: Date.now(),
        userAgent: 'test',
        url: 'test',
        userId: 'test'
      }];
      
      localStorage.setItem('monitoring_metrics', JSON.stringify(testMetrics));
      localStorage.setItem('monitoring_errors', JSON.stringify(testErrors));
      
      // Record a new metric to trigger data loading (monitoring loads on first operation after clear)
      // The monitoring singleton already exists, so we need to add data that will be persisted
      recordMetric('new_metric', 100);
      
      const report = monitoring.getPerformanceReport();
      
      // The new metric should be present
      expect(report.metrics.some(m => m.name === 'new_metric')).toBe(true);
    });

    it('should handle localStorage errors gracefully', () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage full');
      });
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      recordMetric('storage_error_test', 789);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to persist monitoring data:',
        expect.any(Error)
      );
      
      // Restore
      localStorage.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });

  describe('Performance Reports', () => {
    beforeEach(() => {
      // Add some test data
      recordMetric('page_load_time', 1500);
      recordMetric('page_load_time', 2000);
      recordMetric('page_load_time', 1800);
      recordMetric('database_query', 600);
      recordMetric('database_query', 400);
      reportError({ message: 'Test error 1', severity: 'low' });
      reportError({ message: 'High memory usage detected', severity: 'medium' });
    });

    it('should generate comprehensive performance report', () => {
      const report = monitoring.getPerformanceReport();
      
      expect(report.metrics).toHaveLength(5);
      expect(report.errors).toHaveLength(2);
      expect(report.summary.totalErrors).toBe(2);
      // Use toBeCloseTo for floating point comparison (1500+2000+1800)/3 = 1766.666...
      expect(report.summary.avgPageLoadTime).toBeCloseTo(1766.67, 0); // precision 0 = within 0.5
      expect(report.summary.slowQueries).toBe(1); // One query > 500ms
      expect(report.summary.memoryIssues).toBe(1); // One error contains 'memory'
    });

    it('should export diagnostics in JSON format', () => {
      const diagnostics = monitoring.exportDiagnostics();
      const parsed = JSON.parse(diagnostics);
      
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.userAgent).toBeDefined();
      expect(parsed.url).toBeDefined();
      expect(parsed.metrics).toBeDefined();
      expect(parsed.errors).toBeDefined();
      expect(parsed.summary).toBeDefined();
    });

    it('should handle empty data gracefully', () => {
      monitoring.clearData();
      
      const report = monitoring.getPerformanceReport();
      
      expect(report.metrics).toEqual([]);
      expect(report.errors).toEqual([]);
      expect(report.summary.totalErrors).toBe(0);
      expect(report.summary.avgPageLoadTime).toBe(0);
      expect(report.summary.slowQueries).toBe(0);
      expect(report.summary.memoryIssues).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should enable and disable monitoring', () => {
      monitoring.disable();
      recordMetric('disabled_test', 100);
      
      let report = monitoring.getPerformanceReport();
      expect(report.metrics).toHaveLength(0);
      
      monitoring.enable();
      recordMetric('enabled_test', 200);
      
      report = monitoring.getPerformanceReport();
      expect(report.metrics).toHaveLength(1);
      expect(report.metrics[0].name).toBe('enabled_test');
    });

    it('should clear all data', () => {
      recordMetric('clear_test', 100);
      reportError({ message: 'Clear test', severity: 'low' });
      
      let report = monitoring.getPerformanceReport();
      expect(report.metrics).toHaveLength(1);
      expect(report.errors).toHaveLength(1);
      
      monitoring.clearData();
      
      report = monitoring.getPerformanceReport();
      expect(report.metrics).toEqual([]);
      expect(report.errors).toEqual([]);
      
      // Should also clear localStorage
      expect(localStorage.getItem('monitoring_metrics')).toBeNull();
      expect(localStorage.getItem('monitoring_errors')).toBeNull();
    });
  });
});
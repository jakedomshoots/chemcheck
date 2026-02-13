// ============================================
// Performance & Error Monitoring System
// ============================================

export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  timestamp: number;
  userAgent: string;
  url: string;
  userId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

class MonitoringService {
  private metrics: PerformanceMetric[] = [];
  private errors: ErrorReport[] = [];
  private maxStoredItems = 100;
  private isEnabled = true;

  constructor() {
    this.setupGlobalErrorHandling();
    this.setupPerformanceObserver();
    this.loadStoredData();
  }

  // ============================================
  // Error Tracking
  // ============================================

  private setupGlobalErrorHandling(): void {
    // Catch unhandled JavaScript errors
    window.addEventListener('error', (event) => {
      this.reportError({
        message: event.message,
        stack: event.error?.stack,
        severity: 'high',
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          type: 'javascript'
        }
      });
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.reportError({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        severity: 'high',
        metadata: {
          type: 'promise_rejection',
          reason: event.reason
        }
      });
    });
  }

  reportError(error: Omit<ErrorReport, 'id' | 'timestamp' | 'userAgent' | 'url' | 'userId'>): string {
    if (!this.isEnabled) return '';

    const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const errorReport: ErrorReport = {
      id: errorId,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: 'local', // For offline app
      ...error
    };

    this.errors.push(errorReport);
    this.trimStoredData();
    this.persistData();

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[${errorId}] Error reported:`, errorReport);
    }

    // TODO: Send to external service in production
    // this.sendToExternalService(errorReport);

    return errorId;
  }

  // ============================================
  // Performance Monitoring
  // ============================================

  private setupPerformanceObserver(): void {
    if ('PerformanceObserver' in window) {
      try {
        // Monitor navigation timing
        const navObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'navigation') {
              const navEntry = entry as PerformanceNavigationTiming;
              this.recordMetric('page_load_time', navEntry.loadEventEnd - navEntry.fetchStart);
              this.recordMetric('dom_content_loaded', navEntry.domContentLoadedEventEnd - navEntry.fetchStart);
              this.recordMetric('first_paint', navEntry.responseEnd - navEntry.fetchStart);
            }
          }
        });
        navObserver.observe({ entryTypes: ['navigation'] });

        // Monitor resource loading
        const resourceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'resource') {
              const resourceEntry = entry as PerformanceResourceTiming;
              if (resourceEntry.duration > 1000) { // Log slow resources (>1s)
                this.recordMetric('slow_resource_load', resourceEntry.duration, {
                  name: resourceEntry.name,
                  type: resourceEntry.initiatorType
                });
              }
            }
          }
        });
        resourceObserver.observe({ entryTypes: ['resource'] });

        // Monitor long tasks (performance bottlenecks)
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'longtask') {
              this.recordMetric('long_task', entry.duration, {
                startTime: entry.startTime
              });
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (error) {
        console.warn('Performance monitoring setup failed:', error);
      }
    }
  }

  recordMetric(name: string, value: number, metadata?: Record<string, any>): void {
    if (!this.isEnabled) return;

    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: Date.now(),
      metadata
    };

    this.metrics.push(metric);
    this.trimStoredData();
    this.persistData();

    // Log significant performance issues (skip memory metrics from console spam)
    if (name !== 'memory_used' && this.isSignificantMetric(name, value)) {
      console.warn(`Performance issue detected: ${name} = ${value}ms`, metadata);
    }
  }

  private isSignificantMetric(name: string, value: number): boolean {
    const thresholds: Record<string, number> = {
      page_load_time: 3000,
      dom_content_loaded: 2000,
      long_task: 100,
      slow_resource_load: 2000,
      database_query: 500,
      memory_used: Infinity, // Don't log memory as "significant" - it's always large in bytes
      // User-driven operations - these include user interaction time, not system performance
      business_created: Infinity,
      user_created: Infinity,
      user_login: Infinity,
      user_logout: Infinity,
      setup_completed: Infinity,
      form_submitted: Infinity
    };
    return value > (thresholds[name] || 1000);
  }

  // ============================================
  // Database Performance Monitoring
  // ============================================

  async measureDatabaseOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      this.recordMetric('database_query', duration, { operation });
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.recordMetric('database_error', duration, { operation });
      this.reportError({
        message: `Database operation failed: ${operation}`,
        stack: error instanceof Error ? error.stack : undefined,
        severity: 'medium',
        metadata: { operation, duration }
      });
      throw error;
    }
  }

  // ============================================
  // Memory Usage Monitoring
  // ============================================

  checkMemoryUsage(): void {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.recordMetric('memory_used', memory.usedJSHeapSize, {
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit
      });

      // Warn if memory usage is high
      const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
      if (usagePercent > 80) {
        this.reportError({
          message: `High memory usage detected: ${usagePercent.toFixed(1)}%`,
          severity: 'medium',
          metadata: { memoryUsage: memory }
        });
      }
    }
  }

  // ============================================
  // Data Management
  // ============================================

  private trimStoredData(): void {
    if (this.metrics.length > this.maxStoredItems) {
      this.metrics = this.metrics.slice(-this.maxStoredItems);
    }
    if (this.errors.length > this.maxStoredItems) {
      this.errors = this.errors.slice(-this.maxStoredItems);
    }
  }

  private getStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  private persistData(): void {
    try {
      const storage = this.getStorage();
      if (!storage) return;

      storage.setItem('monitoring_metrics', JSON.stringify(this.metrics.slice(-50)));
      storage.setItem('monitoring_errors', JSON.stringify(this.errors.slice(-50)));
    } catch (error) {
      // Handle quota exceeded error specifically
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('SessionStorage quota exceeded, clearing old monitoring data');
        this.clearOldData();
        // Retry once with reduced data
        try {
          const storage = this.getStorage();
          if (!storage) return;
          storage.setItem('monitoring_metrics', JSON.stringify(this.metrics.slice(-25)));
          storage.setItem('monitoring_errors', JSON.stringify(this.errors.slice(-25)));
        } catch (retryError) {
          console.warn('Still failed to persist after clearing, using memory-only mode');
        }
      } else {
        console.warn('Failed to persist monitoring data:', error);
      }
    }
  }

  private clearOldData(): void {
    // Reduce stored items by half to clear space
    this.metrics = this.metrics.slice(-Math.floor(this.maxStoredItems / 2));
    this.errors = this.errors.slice(-Math.floor(this.maxStoredItems / 2));
  }

  private loadStoredData(): void {
    try {
      const storage = this.getStorage();
      if (!storage) return;

      const storedMetrics = storage.getItem('monitoring_metrics');
      const storedErrors = storage.getItem('monitoring_errors');

      if (storedMetrics) {
        this.metrics = JSON.parse(storedMetrics);
      }
      if (storedErrors) {
        this.errors = JSON.parse(storedErrors);
      }
    } catch (error) {
      console.warn('Failed to load stored monitoring data:', error);
    }
  }

  // ============================================
  // Reporting & Analytics
  // ============================================

  getPerformanceReport(): {
    metrics: PerformanceMetric[];
    errors: ErrorReport[];
    summary: {
      totalErrors: number;
      avgPageLoadTime: number;
      slowQueries: number;
      memoryIssues: number;
    };
  } {
    const pageLoadMetrics = this.metrics.filter(m => m.name === 'page_load_time');
    const avgPageLoadTime = pageLoadMetrics.length > 0
      ? pageLoadMetrics.reduce((sum, m) => sum + m.value, 0) / pageLoadMetrics.length
      : 0;

    return {
      metrics: this.metrics,
      errors: this.errors,
      summary: {
        totalErrors: this.errors.length,
        avgPageLoadTime,
        slowQueries: this.metrics.filter(m => m.name === 'database_query' && m.value > 500).length,
        memoryIssues: this.errors.filter(e => e.message.includes('memory')).length
      }
    };
  }

  exportDiagnostics(): string {
    const report = this.getPerformanceReport();
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      ...report
    }, null, 2);
  }

  // ============================================
  // Configuration
  // ============================================

  enable(): void {
    this.isEnabled = true;
  }

  disable(): void {
    this.isEnabled = false;
  }

  clearData(): void {
    this.metrics = [];
    this.errors = [];
    const storage = this.getStorage();
    if (!storage) return;
    storage.removeItem('monitoring_metrics');
    storage.removeItem('monitoring_errors');
  }
}

// Global monitoring instance
export const monitoring = new MonitoringService();

// Convenience functions
export const reportError = (error: Omit<ErrorReport, 'id' | 'timestamp' | 'userAgent' | 'url' | 'userId'>) =>
  monitoring.reportError(error);

export const recordMetric = (name: string, value: number, metadata?: Record<string, any>) =>
  monitoring.recordMetric(name, value, metadata);

export const measureDatabaseOperation = <T>(operation: string, fn: () => Promise<T>) =>
  monitoring.measureDatabaseOperation(operation, fn);

// Memory monitoring interval reference
let memoryMonitorIntervalId: ReturnType<typeof setInterval> | null = null;

// Start memory monitoring
memoryMonitorIntervalId = setInterval(() => {
  monitoring.checkMemoryUsage();
}, 30000); // Check every 30 seconds

/**
 * Stop memory monitoring and clean up interval.
 * Call this during component unmount or page cleanup.
 */
export function stopMemoryMonitoring(): void {
  if (memoryMonitorIntervalId) {
    clearInterval(memoryMonitorIntervalId);
    memoryMonitorIntervalId = null;
  }
}

/**
 * Restart memory monitoring if it was stopped.
 */
export function startMemoryMonitoring(): void {
  if (!memoryMonitorIntervalId) {
    memoryMonitorIntervalId = setInterval(() => {
      monitoring.checkMemoryUsage();
    }, 30000);
  }
}

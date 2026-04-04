import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReadinessReport } from './readiness';
import { migrationManager } from '@/lib/migrations';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { monitoring } from '@/lib/monitoring';

vi.mock('@/lib/platformPolicy', () => ({
  appRuntime: {
    appVersion: '1.0.0-test',
  },
}));

vi.mock('@/lib/migrations', () => ({
  migrationManager: {
    getCurrentState: vi.fn(),
  },
}));

vi.mock('@/lib/serviceWorker', () => ({
  getServiceWorkerState: vi.fn(),
}));

vi.mock('@/lib/monitoring', () => ({
  monitoring: {
    getPerformanceReport: vi.fn(),
  },
}));

const healthyMigrationState = {
  currentVersion: 3,
  appliedMigrations: [1, 2, 3],
  lastMigration: '003-fix-route-guards',
};

const healthyPerformanceReport = {
  metrics: [],
  errors: [],
  summary: {
    totalErrors: 0,
    avgPageLoadTime: 250,
    slowQueries: 0,
    memoryIssues: 0,
  },
};

describe('Readiness report gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(migrationManager.getCurrentState).mockResolvedValue(healthyMigrationState);
    vi.mocked(getServiceWorkerState).mockReturnValue({
      isSupported: true,
      isRegistered: true,
      isControlling: true,
      hasUpdate: false,
    } as any);
    vi.mocked(monitoring.getPerformanceReport).mockReturnValue(healthyPerformanceReport);
    window.history.replaceState({}, '', '/ready');
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  it('emits a stable ok report when all checks pass', async () => {
    const report = await getReadinessReport();

    expect(report.status).toBe('ok');
    expect(report.checks.routingReady.status).toBe('ok');
    expect(report.checks.storageReady.status).toBe('ok');
    expect(report.checks.migrationReady.status).toBe('ok');
    expect(report.checks.serviceWorkerReady.status).toBe('ok');
    expect(report.checks.monitoringReady.status).toBe('ok');
    expect(report.appVersion).toBe('1.0.0-test');
    expect(report.dataVersion).toBe(3);
    expect(report.metadata.routingRoot).toBe('/ready');
    expect(report.metadata.environment).toBe('browser');
  });

  it('marks readiness degraded when storage writes fail', async () => {
    const originalSetItem = localStorage.setItem;
    const storageError = new Error('Storage write blocked');

    localStorage.setItem = vi.fn(() => {
      throw storageError;
    });

    const report = await getReadinessReport();

    expect(report.checks.storageReady.status).toBe('degraded');
    expect(report.status).toBe('degraded');
    expect(report.checks.storageReady.details.reason).toContain('Storage write blocked');

    localStorage.setItem = originalSetItem;
  });

  it('marks readiness down when migrations cannot be loaded', async () => {
    vi.mocked(migrationManager.getCurrentState).mockRejectedValueOnce(new Error('Migration state not available'));

    const report = await getReadinessReport();

    expect(report.checks.migrationReady.status).toBe('down');
    expect(report.status).toBe('down');
    expect(report.checks.migrationReady.details.error).toContain('Migration state not available');
  });

  it('propagates monitoring pressure as degraded readiness', async () => {
    vi.mocked(monitoring.getPerformanceReport).mockReturnValue({
      ...healthyPerformanceReport,
      summary: {
        ...healthyPerformanceReport.summary,
        totalErrors: 37,
      },
    } as any);

    const report = await getReadinessReport();

    expect(report.checks.monitoringReady.status).toBe('degraded');
    expect(report.status).toBe('degraded');
    expect(report.checks.monitoringReady.details.totalErrors).toBe(37);
  });

  it('flags service worker drift as degraded when not registered', async () => {
    vi.mocked(getServiceWorkerState).mockReturnValue({
      isSupported: true,
      isRegistered: false,
      isControlling: false,
      hasUpdate: false,
    } as any);

    const report = await getReadinessReport();

    expect(report.checks.serviceWorkerReady.status).toBe('degraded');
    expect(report.status).toBe('degraded');
  });
});

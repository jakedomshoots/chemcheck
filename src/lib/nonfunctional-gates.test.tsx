import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { performanceTest } from '@/test/testUtils';
import ProtectedAppRoutes from '@/pages/ProtectedAppRoutes';
import { getReadinessReport } from './readiness';
import { migrationManager } from '@/lib/migrations';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { monitoring } from '@/lib/monitoring';

vi.mock('@/lib/chunkErrorRecovery', () => ({
  importWithRetry: vi.fn(loader => loader()),
}));

vi.mock('@/pages/Layout.jsx', () => ({
  default: ({ children, currentPageName }) => (
    <div>
      <div data-testid="layout-page">{currentPageName}</div>
      {children}
    </div>
  ),
}));

vi.mock('@/pages/Home', () => ({ default: () => <div>Home Page</div> }));
vi.mock('@/pages/Clients', () => ({ default: () => <div>Clients Page</div> }));
vi.mock('@/pages/NewClient', () => ({ default: () => <div>New Client Page</div> }));
vi.mock('@/pages/NewServiceLog', () => ({ default: () => <div>New Service Log Page</div> }));
vi.mock('@/pages/CustomerDetail', () => ({ default: () => <div>Customer Detail Page</div> }));
vi.mock('@/pages/WeeklyReport', () => ({ default: () => <div>Weekly Report Page</div> }));
vi.mock('@/pages/RouteOptimizer', () => ({ default: () => <div>Route Optimizer Page</div> }));
vi.mock('@/pages/EditClient', () => ({ default: () => <div>Edit Client Page</div> }));
vi.mock('@/pages/ChemicalUsage', () => ({ default: () => <div>Chemical Usage Page</div> }));
vi.mock('@/pages/NewChemicalUsage', () => ({ default: () => <div>New Chemical Usage Page</div> }));
vi.mock('@/pages/Notes', () => ({ default: () => <div>Notes Page</div> }));
vi.mock('@/pages/History', () => ({ default: () => <div>History Page</div> }));
vi.mock('@/pages/Settings', () => ({ default: () => <div>Settings Page</div> }));
vi.mock('@/pages/PoolSchool', () => ({ default: () => <div>Pool School Page</div> }));
vi.mock('@/pages/WorkOrders', () => ({ default: () => <div>Work Orders Page</div> }));
vi.mock('@/components/billing/BillingDashboard', () => ({
  BillingDashboard: () => <div>Billing Dashboard Page</div>,
}));
vi.mock('@/pages/NotFoundPage', () => ({
  default: () => <div>Not Found Page</div>,
  NotFoundPage: () => <div>Not Found Page</div>,
}));
vi.mock('@/pages/AccessDeniedPage', () => ({
  default: () => <div>Access Denied Page</div>,
  AccessDeniedPage: () => <div>Access Denied Page</div>,
}));

vi.mock('@/lib/workOrdersNavigation', () => ({
  getDefaultWorkOrdersSectionFromStorage: vi.fn(() => 'upcoming'),
}));

vi.mock('@/components/auth/ClerkAuthProvider', () => ({
  useAuthContext: vi.fn(() => ({ isSignedIn: true })),
}));

vi.mock('@/hooks/useSyncInitialization', () => ({
  useSyncInitialization: vi.fn(),
}));

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

const healthyServiceWorkerState = {
  isSupported: true,
  isRegistered: true,
  isControlling: true,
  hasUpdate: false,
};

describe('Non-functional gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(migrationManager.getCurrentState).mockResolvedValue(healthyMigrationState);
    vi.mocked(getServiceWorkerState).mockReturnValue(healthyServiceWorkerState as any);
    vi.mocked(monitoring.getPerformanceReport).mockReturnValue({
      metrics: [],
      errors: [],
      summary: {
        totalErrors: 0,
        avgPageLoadTime: 250,
        slowQueries: 0,
        memoryIssues: 0,
      },
    } as any);
    window.history.replaceState({}, '', '/ready');
  });

  it('keeps protected route rendering inside a stable route-performance envelope', async () => {
    const cases = [
      ['/clients', 'Clients Page'],
      ['/newclient', 'New Client Page'],
      ['/history', 'History Page'],
      ['/billing', 'Billing Dashboard Page'],
      ['/notes', 'Notes Page'],
    ];

    for (const [path, marker] of cases) {
      const { result } = await performanceTest.measureRenderTime(() =>
        render(
          <MemoryRouter initialEntries={[path]}>
            <ProtectedAppRoutes />
          </MemoryRouter>
        )
      );

      await result.findByText(marker);
      result.unmount();
    }

    // Use an explicit guardrail for cumulative run time to avoid regressions.
    const { result: lateResult, duration } = await performanceTest.measureRenderTime(() =>
      render(
        <MemoryRouter initialEntries={['/clients']}>
          <ProtectedAppRoutes />
        </MemoryRouter>
      )
    );
    expect(duration).toBeLessThan(2500);
    await lateResult.findByText('Clients Page');
    lateResult.unmount();
  });

  it('detects readiness drift from healthy to pressured state and back', async () => {
    const healthy = await getReadinessReport();
    expect(healthy.status).toBe('ok');

    vi.mocked(monitoring.getPerformanceReport).mockReturnValue({
      metrics: [],
      errors: [{ id: 'e1', message: 'pressure', timestamp: 0, userAgent: 'test', url: '/', userId: 'u', severity: 'high' }],
      summary: {
        totalErrors: 37,
        avgPageLoadTime: 250,
        slowQueries: 0,
        memoryIssues: 0,
      },
    } as any);

    const degraded = await getReadinessReport();
    expect(degraded.status).toBe('degraded');
    expect(degraded.checks.monitoringReady.status).toBe('degraded');
    expect(degraded.checks.monitoringReady.details.totalErrors).toBe(37);

    vi.mocked(monitoring.getPerformanceReport).mockReturnValue({
      metrics: [],
      errors: [],
      summary: {
        totalErrors: 0,
        avgPageLoadTime: 250,
        slowQueries: 0,
        memoryIssues: 0,
      },
    } as any);

    const recovered = await getReadinessReport();
    expect(recovered.status).toBe('ok');
    expect(recovered.checks.monitoringReady.status).toBe('ok');
  });
});

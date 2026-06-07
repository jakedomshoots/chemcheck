import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import HealthPage from '@/pages/HealthPage';
import { ReadyPage } from '@/pages/ReadyPage';

expect.extend(toHaveNoViolations);

const healthyReadinessReport = {
  status: 'ok' as const,
  appVersion: '1.0.0-test',
  dataVersion: 3,
  checks: {
    routingReady: {
      status: 'ok' as const,
      details: {
        supportsSPA: true,
      },
    },
    storageReady: {
      status: 'ok' as const,
      details: { available: true },
    },
    migrationReady: {
      status: 'ok' as const,
      details: {
        currentVersion: 3,
        applied: [1, 2, 3],
        lastMigration: 'baseline',
      },
    },
    serviceWorkerReady: {
      status: 'ok' as const,
      details: {
        isSupported: true,
        isRegistered: true,
      },
    },
    monitoringReady: {
      status: 'ok' as const,
      details: {
        totalErrors: 0,
        avgPageLoadMs: 320,
        slowQueries: 0,
      },
    },
  },
  timestamp: new Date().toISOString(),
  metadata: {
    environment: 'browser',
    isOnline: true,
    swRegistrationSource: 'registered',
    routingRoot: '/health',
  },
};

vi.mock('@/lib/readiness', () => ({
  getReadinessReport: vi.fn(),
}));

vi.mock('@/lib/serviceWorker', () => ({
  getServiceWorkerState: vi.fn(() => ({
    isSupported: true,
    isRegistered: true,
    isControlling: true,
    hasUpdate: false,
    registration: null,
  })),
}));

const getReadinessReportMock = vi.mocked(getReadinessReport);
const getServiceWorkerStateMock = vi.mocked(getServiceWorkerState);

describe('Accessibility gates for status surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReadinessReportMock.mockResolvedValue({ ...healthyReadinessReport });
    getServiceWorkerStateMock.mockReturnValue({
      isSupported: true,
      isRegistered: true,
      isControlling: true,
      hasUpdate: false,
      registration: null,
    } as any);
    window.history.replaceState({}, '', '/health');
  });

  it('Health page has no axe violations under status rendering load', async () => {
    const { container } = render(
      <MemoryRouter>
        <HealthPage />
      </MemoryRouter>
    );

    // Allow initial effect-driven readiness state to settle for warning-free audit.
    await screen.findByText(/ChemCheck Health/i);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Ready page has no axe violations and renders startup state markers', async () => {
    const { container, findByText } = render(
      <MemoryRouter>
        <ReadyPage />
      </MemoryRouter>
    );

    expect(await findByText(/startup checks/i)).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

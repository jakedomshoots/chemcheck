import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProtectedAppRoutes from './ProtectedAppRoutes';

vi.mock('@/lib/chunkErrorRecovery', () => ({
  importWithRetry: vi.fn(loader => loader()),
}));

vi.mock('./Layout.jsx', () => ({
  default: ({ children, currentPageName }) => (
    <div>
      <div data-testid="layout-page">{currentPageName}</div>
      {children}
    </div>
  ),
}));

vi.mock('./Home', () => ({ default: () => <div>Home Page</div> }));
vi.mock('./Clients', () => ({ default: () => <div>Clients Page</div> }));
vi.mock('./NewClient', () => ({ default: () => <div>New Client Page</div> }));
vi.mock('./NewServiceLog', () => ({ default: () => <div>New Service Log Page</div> }));
vi.mock('./CustomerDetail', () => ({ default: () => <div>Customer Detail Page</div> }));
vi.mock('./WeeklyReport', () => ({ default: () => <div>Weekly Report Page</div> }));
vi.mock('./RouteOptimizer', () => ({ default: () => <div>Route Optimizer Page</div> }));
vi.mock('./EditClient', () => ({ default: () => <div>Edit Client Page</div> }));
vi.mock('./ChemicalUsage', () => ({ default: () => <div>Chemical Usage Page</div> }));
vi.mock('./NewChemicalUsage', () => ({ default: () => <div>New Chemical Usage Page</div> }));
vi.mock('./Notes', () => ({ default: () => <div>Notes Page</div> }));
vi.mock('./Settings', () => ({ default: () => <div>Settings Page</div> }));
vi.mock('./PoolSchool', () => ({ default: () => <div>Pool School Page</div> }));
vi.mock('./WorkOrders', () => ({ default: () => <div>Work Orders Page</div> }));
vi.mock('@/components/billing/BillingDashboard', () => ({
  BillingDashboard: () => <div>Billing Dashboard Page</div>,
}));
vi.mock('./NotFoundPage', () => ({ 
  default: () => <div>Not Found Page</div>,
  NotFoundPage: () => <div>Not Found Page</div>,
}));
vi.mock('./AccessDeniedPage', () => ({
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

describe('ProtectedAppRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders access denied route directly through route mapping', async () => {
    render(
      <MemoryRouter initialEntries={['/access-denied']}>
        <ProtectedAppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText('Access Denied Page')).toBeInTheDocument();
  });

  it('falls back to not-found route for unknown paths', async () => {
    render(
      <MemoryRouter initialEntries={['/totally-missing-route']}>
        <ProtectedAppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText('Not Found Page')).toBeInTheDocument();
  });

  it('normalizes legacy /history alias to clients page', async () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <ProtectedAppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText('Clients Page')).toBeInTheDocument();
    expect(screen.getByTestId('layout-page').textContent).toBe('Clients');
  });

  it('keeps core route transitions inside an accessibility-friendly performance envelope', async () => {
    const cases = [
      ['/clients', 'Clients Page'],
      ['/newclient', 'New Client Page'],
      ['/history', 'Clients Page'],
      ['/access-denied', 'Access Denied Page'],
    ];

    for (const [path, marker] of cases) {
      const startedAt = performance.now();

      const renderResult = render(
        <MemoryRouter initialEntries={[path]}>
          <ProtectedAppRoutes />
        </MemoryRouter>
      );
      const elapsed = performance.now() - startedAt;

      expect(await renderResult.findByText(marker)).toBeInTheDocument();
      expect(elapsed).toBeLessThan(500);

      renderResult.unmount();
    }
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RobustAuthGuard } from './RobustAuthGuard';

const mockUseAuthContext = vi.fn();

vi.mock('./ClerkAuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

function LocationDisplay() {
  const location = useLocation();

  return (
    <div data-testid="location-state">
      {JSON.stringify({
        pathname: location.pathname,
        state: location.state ?? null,
      })}
    </div>
  );
}

function renderGuard(initialEntry = '/clients') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <Routes>
        <Route
          path="/login"
          element={(
            <RobustAuthGuard>
              <div>Login Route</div>
            </RobustAuthGuard>
          )}
        />
        <Route
          path="/setup"
          element={(
            <RobustAuthGuard>
              <div>Setup Route</div>
            </RobustAuthGuard>
          )}
        />
        <Route
          path="/report/:reportId"
          element={(
            <RobustAuthGuard>
              <div>Public Report</div>
            </RobustAuthGuard>
          )}
        />
        <Route
          path="*"
          element={(
            <RobustAuthGuard>
              <div>Protected Route</div>
            </RobustAuthGuard>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('RobustAuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /setup only from a definitive setup_missing state', async () => {
    mockUseAuthContext.mockReturnValue({
      isLoaded: true,
      isInitialized: true,
      isSignedIn: true,
      authState: 'setup_missing',
      hasCompletedSetup: false,
      authError: null,
      clearAuthError: vi.fn(),
      logout: vi.fn(),
    });

    renderGuard('/clients');

    await waitFor(() => {
      expect(screen.getByText('Setup Route')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-state')).toHaveTextContent('/setup');
  });

  it('keeps bootstrapping users on the loading screen instead of redirecting to /setup', () => {
    mockUseAuthContext.mockReturnValue({
      isLoaded: true,
      isInitialized: false,
      isSignedIn: true,
      authState: 'bootstrapping',
      hasCompletedSetup: false,
      authError: null,
      clearAuthError: vi.fn(),
      logout: vi.fn(),
    });

    renderGuard('/clients');

    expect(screen.getByText('Loading ChemCheck...')).toBeInTheDocument();
    expect(screen.getByTestId('location-state')).toHaveTextContent('/clients');
  });

  it('preserves the auth error screen for bootstrap failures', () => {
    mockUseAuthContext.mockReturnValue({
      isLoaded: true,
      isInitialized: true,
      isSignedIn: true,
      authState: 'error',
      hasCompletedSetup: false,
      authError: 'Convex bootstrap failed',
      clearAuthError: vi.fn(),
      logout: vi.fn(),
    });

    renderGuard('/clients');

    expect(screen.getByText('Authentication Error')).toBeInTheDocument();
    expect(screen.getByText('Convex bootstrap failed')).toBeInTheDocument();
    expect(screen.getByTestId('location-state')).toHaveTextContent('/clients');
  });

  it('preserves returnTo when redirecting signed-out users to login', async () => {
    mockUseAuthContext.mockReturnValue({
      isLoaded: true,
      isInitialized: true,
      isSignedIn: false,
      authState: 'signed_out',
      hasCompletedSetup: false,
      authError: null,
      clearAuthError: vi.fn(),
      logout: vi.fn(),
    });

    renderGuard('/clients');

    await waitFor(() => {
      expect(screen.getByText('Login Route')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-state')).toHaveTextContent('"returnTo":"/clients"');
  });

  it('lets public report routes render immediately', () => {
    mockUseAuthContext.mockReturnValue({
      isLoaded: false,
      isInitialized: false,
      isSignedIn: false,
      authState: 'loading',
      hasCompletedSetup: false,
      authError: null,
      clearAuthError: vi.fn(),
      logout: vi.fn(),
    });

    renderGuard('/report/abcd1234');

    expect(screen.getByText('Public Report')).toBeInTheDocument();
    expect(screen.getByTestId('location-state')).toHaveTextContent('/report/abcd1234');
  });
});

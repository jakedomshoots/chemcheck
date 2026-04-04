import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RobustAuthGuard } from './RobustAuthGuard';

const AUTH_RETURN_TO_SESSION_KEY = 'chemcheck_auth_return_to';

const buildAuthState = (overrides = {}) => ({
  isLoaded: true,
  isInitialized: true,
  isSignedIn: false,
  hasCompletedSetup: false,
  authError: null,
  clearAuthError: vi.fn(),
  ...overrides,
});

const mockAuthContextState = buildAuthState();

vi.mock('./ClerkAuthProvider', () => ({
  useAuthContext: vi.fn(() => mockAuthContextState),
}));

function LoginPage() {
  const location = useLocation();
  return (
    <div>
      <h1>Login Page</h1>
      <div data-testid="return-target">{JSON.stringify(location.state?.returnTo ?? '')}</div>
    </div>
  );
}

function ProtectedContent() {
  return <div>Protected Route Content</div>;
}

function LoginGuardProbe() {
  const location = useLocation();
  return (
    <div>
      <h1>Probed Route</h1>
      <div data-testid="route-path">{`${location.pathname}${location.search}`}</div>
      <div data-testid="return-target">{JSON.stringify(location.state?.returnTo ?? '')}</div>
    </div>
  );
}

function renderWithRoute(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<RobustAuthGuard><ProtectedContent /></RobustAuthGuard>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderWithGuardOnly(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<RobustAuthGuard><LoginGuardProbe /></RobustAuthGuard>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RobustAuthGuard', () => {
  beforeEach(() => {
    Object.assign(mockAuthContextState, buildAuthState());
  });

  it('renders public routes without redirecting unauthenticated users', () => {
    const state = mockAuthContextState;
    state.isSignedIn = false;

    renderWithRoute('/pricing');

    expect(screen.getByText('Protected Route Content')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated protected routes to login and preserves return target', async () => {
    const state = mockAuthContextState;
    state.isSignedIn = false;

    renderWithRoute('/clients');

    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('return-target').textContent).toBe('"/clients"');
  });

  it('persists return target in session storage for restore on login', async () => {
    const state = mockAuthContextState;
    state.isSignedIn = false;

    renderWithRoute('/clients');

    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

    expect(sessionStorage.getItem(AUTH_RETURN_TO_SESSION_KEY)).toBe('/clients');
  });

  it('restores return target from sessionStorage when available and removes stored intent after redirect', async () => {
    const state = mockAuthContextState;
    state.isSignedIn = true;
    state.hasCompletedSetup = true;
    sessionStorage.setItem(AUTH_RETURN_TO_SESSION_KEY, '/clients?sort=asc');

    renderWithGuardOnly('/login');

    await waitFor(() => {
      expect(screen.getByTestId('route-path').textContent).toBe('/clients?sort=asc');
    });

    expect(sessionStorage.getItem(AUTH_RETURN_TO_SESSION_KEY)).toBeNull();
  });

  it('allows already-authenticated users with completed setup to stay on protected routes', () => {
    const state = mockAuthContextState;
    state.isSignedIn = true;
    state.hasCompletedSetup = true;

    renderWithRoute('/clients');

    expect(screen.getByText('Protected Route Content')).toBeInTheDocument();
  });
});

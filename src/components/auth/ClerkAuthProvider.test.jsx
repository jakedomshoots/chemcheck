import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseAuth = vi.fn();
const mockUseUser = vi.fn();
const queryMock = vi.fn();
const logLoginMock = vi.fn();
const logLogoutMock = vi.fn();
const setUserContextMock = vi.fn();
const clearUserContextMock = vi.fn();
const mockUserManager = {
  getCurrentUser: vi.fn(),
  getCurrentBusiness: vi.fn(),
  loginUser: vi.fn(),
  bootstrapFromConvex: vi.fn(),
  logoutUser: vi.fn(),
};

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  useUser: () => mockUseUser(),
}));

vi.mock('@/lib/auditLog', () => ({
  logLogin: (...args) => logLoginMock(...args),
  logLogout: (...args) => logLogoutMock(...args),
}));

vi.mock('@/lib/sentry', () => ({
  setUserContext: (...args) => setUserContextMock(...args),
  clearUserContext: (...args) => clearUserContextMock(...args),
}));

vi.mock('@/lib/userManager', () => ({
  userManager: mockUserManager,
}));

vi.mock('convex/react', () => ({
  ConvexReactClient: class {
    query(...args) {
      return queryMock(...args);
    }
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    businesses: {
      getCurrent: 'businesses.getCurrent',
    },
  },
}));

describe('ClerkAuthProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_auth_provider');
    vi.stubEnv('VITE_CONVEX_URL', 'https://convex.example');
    vi.stubEnv('VITE_ENABLE_LOCALHOST_AUTH_BYPASS', 'false');
    vi.stubEnv('VITE_IOS_SIM_AUTH_BYPASS', 'false');

    mockUseAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_123',
      signOut: vi.fn(),
    });

    mockUseUser.mockReturnValue({
      user: {
        fullName: 'Owner User',
        firstName: 'Owner',
        primaryEmailAddress: {
          emailAddress: 'owner@example.com',
        },
      },
    });

    mockUserManager.getCurrentBusiness.mockReturnValue(null);
  });

  it('treats a missing canonical Convex business as setup_missing even with a local user', async () => {
    mockUserManager.getCurrentUser.mockReturnValue({
      id: 'local_user',
      email: 'owner@example.com',
      businessId: 'local_business',
    });
    queryMock.mockResolvedValue(null);

    const authModule = await import('./ClerkAuthProvider');
    const { ClerkAuthProvider, useAuthContext } = authModule;

    function Probe() {
      const auth = useAuthContext();
      return (
        <div>
          <div data-testid="auth-state">{auth.authState}</div>
          <div data-testid="setup-complete">{String(auth.hasCompletedSetup)}</div>
        </div>
      );
    }

    render(
      <ClerkAuthProvider>
        <Probe />
      </ClerkAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('setup_missing');
    });
    expect(screen.getByTestId('setup-complete')).toHaveTextContent('false');
  });

  it('becomes ready from the canonical Convex business and bootstraps local state when needed', async () => {
    mockUserManager.getCurrentUser.mockReturnValue(null);
    mockUserManager.loginUser.mockResolvedValue(null);
    mockUserManager.bootstrapFromConvex.mockResolvedValue({
      user: {
        id: 'bootstrapped_user',
        email: 'owner@example.com',
        businessId: 'biz_123',
      },
      business: {
        id: 'biz_123',
      },
    });
    queryMock.mockResolvedValue({
      _id: 'biz_123',
      name: 'Crystal Clear Pools',
      email: 'owner@example.com',
      settings: {},
    });

    const authModule = await import('./ClerkAuthProvider');
    const { ClerkAuthProvider, useAuthContext } = authModule;

    function Probe() {
      const auth = useAuthContext();
      return (
        <div>
          <div data-testid="auth-state">{auth.authState}</div>
          <div data-testid="setup-complete">{String(auth.hasCompletedSetup)}</div>
        </div>
      );
    }

    render(
      <ClerkAuthProvider>
        <Probe />
      </ClerkAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('setup-complete')).toHaveTextContent('true');
    expect(mockUserManager.bootstrapFromConvex).toHaveBeenCalled();
  });
});

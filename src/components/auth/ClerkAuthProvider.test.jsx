import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  getCurrentUser: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  signOut: vi.fn(),
  getToken: vi.fn(),
  bootstrapFromConvex: vi.fn(),
  convexSetAuth: vi.fn(),
  convexQuery: vi.fn(),
}));

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }) => children,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'clerk-user',
    signOut: mocks.signOut,
    getToken: mocks.getToken,
    sessionClaims: null,
  }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'second@example.com' }, fullName: 'Second User' } }),
}));
vi.mock('@/lib/sessionCleanup', () => ({ clearChemCheckSessionData: mocks.clearSession }));
vi.mock('@/lib/userManager', () => ({
  userManager: {
    getCurrentUser: mocks.getCurrentUser,
    loginUser: mocks.loginUser,
    logoutUser: mocks.logoutUser,
    bootstrapFromConvex: mocks.bootstrapFromConvex,
  },
}));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth = mocks.convexSetAuth;
    query = mocks.convexQuery;
  },
}));
vi.mock('../../../convex/_generated/api', () => ({
  api: { businesses: { getCurrent: 'businesses:getCurrent' } },
}));
vi.mock('@/lib/auditLog', () => ({ logLogin: vi.fn(), logLogout: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ clearUserContext: vi.fn(), setUserContext: vi.fn() }));
vi.mock('@/lib/platformPolicy', () => ({
  getAuthBypassReason: () => null,
  shouldUseDevelopmentAuthBypass: () => false,
}));

describe('ClerkAuthProvider session isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_session_isolation');
    vi.stubEnv('VITE_CONVEX_URL', 'https://test-deployment.convex.cloud');
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.loginUser.mockResolvedValue({ email: 'second@example.com', businessId: 'business_2' });
    mocks.getToken.mockResolvedValue('convex-token');
    mocks.convexQuery.mockResolvedValue(null);
  });

  it('uses the Clerk token to restore an existing Convex business on a fresh browser', async () => {
    const convexBusiness = { _id: 'business-existing', name: 'Existing Business' };
    mocks.getCurrentUser.mockReturnValue(null);
    mocks.loginUser.mockResolvedValue(null);
    mocks.convexQuery.mockResolvedValue(convexBusiness);
    mocks.bootstrapFromConvex.mockResolvedValue({
      user: { email: 'second@example.com', businessId: 'business-existing' },
      business: convexBusiness,
    });
    const { ClerkAuthProvider, useAuthContext } = await import('./ClerkAuthProvider');
    function SetupState() {
      return <div>{useAuthContext().hasCompletedSetup ? 'restored' : 'new account'}</div>;
    }

    render(<ClerkAuthProvider><SetupState /></ClerkAuthProvider>);

    await screen.findByText('restored');
    expect(mocks.getToken).toHaveBeenCalledWith({ template: 'convex', skipCache: true });
    expect(mocks.convexSetAuth).toHaveBeenCalledWith('convex-token');
    expect(mocks.convexQuery).toHaveBeenCalledWith('businesses:getCurrent');
    expect(mocks.bootstrapFromConvex).toHaveBeenCalledWith(convexBusiness, 'second@example.com');
  });

  it('repairs a same-email local profile that points to the wrong business', async () => {
    const orphanUser = { email: 'second@example.com', businessId: 'local-orphan' };
    const convexBusiness = { _id: 'business-existing', name: 'Existing Business' };
    mocks.getCurrentUser.mockReturnValue(orphanUser);
    mocks.convexQuery.mockResolvedValue(convexBusiness);
    mocks.bootstrapFromConvex.mockResolvedValue({
      user: { email: 'second@example.com', businessId: 'business-existing' },
      business: convexBusiness,
    });
    const { ClerkAuthProvider, useAuthContext } = await import('./ClerkAuthProvider');
    function BusinessId() {
      return <div>{useAuthContext().localUser?.businessId}</div>;
    }

    render(<ClerkAuthProvider><BusinessId /></ClerkAuthProvider>);

    await screen.findByText('business-existing');
    expect(mocks.bootstrapFromConvex).toHaveBeenCalledWith(convexBusiness, 'second@example.com');
    expect(mocks.clearSession).not.toHaveBeenCalled();
  });

  it('purges offline data before a different account is restored', async () => {
    mocks.getCurrentUser.mockReturnValue({ email: 'first@example.com', businessId: 'business_1' });
    const { ClerkAuthProvider } = await import('./ClerkAuthProvider');

    render(<ClerkAuthProvider><div>child</div></ClerkAuthProvider>);

    await waitFor(() => expect(mocks.loginUser).toHaveBeenCalledWith('second@example.com'));
    expect(mocks.clearSession).toHaveBeenCalledBefore(mocks.loginUser);
  });

  it('keeps Clerk signed in when local cleanup fails during logout', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getCurrentUser.mockReturnValue({ email: 'second@example.com', businessId: 'business_2' });
    mocks.clearSession.mockRejectedValue(new Error('cache delete failed'));
    const { ClerkAuthProvider, useAuthContext } = await import('./ClerkAuthProvider');
    function LogoutControl() {
      const { authError, logout } = useAuthContext();
      return <><button onClick={() => void logout().catch(() => {})}>Sign out</button><p>{authError}</p></>;
    }

    render(<ClerkAuthProvider><LogoutControl /></ClerkAuthProvider>);
    await screen.findByText('Sign out');
    screen.getByRole('button', { name: 'Sign out' }).click();

    await waitFor(() => expect(screen.getByText(/Could not clear local customer data/i)).toBeInTheDocument());
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.logoutUser).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/* eslint-disable react/prop-types */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizardPage } from './SetupWizardPage';

const mockUseAuthContext = vi.fn();
const mockNavigate = vi.fn();
const createBusinessMutation = vi.fn();
const updateBusinessMutation = vi.fn();

vi.mock('./ClerkAuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('convex/react', () => ({
  useMutation: vi.fn((mutation) => {
    if (mutation === 'businesses.create') {
      return createBusinessMutation;
    }

    if (mutation === 'businesses.update') {
      return updateBusinessMutation;
    }

    return vi.fn();
  }),
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    businesses: {
      create: 'businesses.create',
      update: 'businesses.update',
    },
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

describe('SetupWizardPage', () => {
  let baseAuthContext;

  beforeEach(() => {
    vi.clearAllMocks();
    createBusinessMutation.mockResolvedValue('biz_123');
    updateBusinessMutation.mockResolvedValue('biz_123');

    baseAuthContext = {
      isLoaded: true,
      isInitialized: true,
      isSignedIn: true,
      authState: 'setup_missing',
      hasCompletedSetup: false,
      clerkUser: {
        fullName: 'Jordan Owner',
        firstName: 'Jordan',
        primaryEmailAddress: {
          emailAddress: 'owner@example.com',
        },
      },
      refreshAuthState: vi.fn().mockResolvedValue({ authState: 'ready' }),
    };

    mockUseAuthContext.mockReturnValue(baseAuthContext);
  });

  async function completeSetupForm() {
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Crystal Clear Pool Service'), 'Crystal Clear Pools');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /complete setup/i }));
  }

  it('verifies setup through a fresh canonical auth refresh before navigating home', async () => {
    const refreshAuthState = vi.fn().mockResolvedValue({ authState: 'ready' });
    mockUseAuthContext.mockReturnValue({
      ...baseAuthContext,
      refreshAuthState,
    });

    render(<SetupWizardPage />);

    await completeSetupForm();

    await waitFor(() => {
      expect(createBusinessMutation).toHaveBeenCalledWith({
        name: 'Crystal Clear Pools',
        address: undefined,
        phone: undefined,
        email: 'owner@example.com',
      });
    });
    expect(refreshAuthState).toHaveBeenCalledWith({ forceCanonicalBusinessRead: true });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('stays on setup when the canonical refresh does not confirm readiness', async () => {
    const refreshAuthState = vi.fn().mockResolvedValue({ authState: 'setup_missing' });
    mockUseAuthContext.mockReturnValue({
      ...baseAuthContext,
      refreshAuthState,
    });

    render(<SetupWizardPage />);

    await completeSetupForm();

    await waitFor(() => {
      expect(refreshAuthState).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/could not verify your workspace setup/i)).toBeInTheDocument();
  });
});

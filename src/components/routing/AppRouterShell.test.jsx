import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AppRouterShell from './AppRouterShell';

vi.mock('@/components/routing/PublicReportRouter.jsx', () => ({
  default: () => <div data-testid="public-report-router">Public Report Router</div>,
}));

vi.mock('@/components/auth/AuthenticatedShell.jsx', () => ({
  default: () => <div data-testid="authenticated-shell">Authenticated Shell</div>,
}));

vi.mock('@/lib/chunkErrorRecovery', () => ({
  importWithRetry: vi.fn(loader => loader()),
}));

describe('AppRouterShell', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('canonicalizes legacy case alias routes before shell selection', async () => {
    window.history.replaceState({}, '', '/Clients');

    const { findByTestId } = render(<AppRouterShell />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/clients');
    });
    expect(await findByTestId('authenticated-shell')).toBeInTheDocument();
  });

  it('canonicalizes public report deep links while preserving public entry behavior', async () => {
    window.history.replaceState({}, '', '/report/ABC123DEF/');

    const { findByTestId } = render(<AppRouterShell />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/report/ABC123DEF');
    });
    expect(await findByTestId('public-report-router')).toBeInTheDocument();
  });
});

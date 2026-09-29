import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SquareConnectCard } from './SquareConnectCard';

let status;
const createAuthorizeUrl = vi.fn();
const refreshConnection = vi.fn();
const disconnect = vi.fn();

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    squareConnect: {
      getSquareConnectStatus: 'getSquareConnectStatus',
      createAuthorizeUrl: 'createAuthorizeUrl',
      refreshConnection: 'refreshConnection',
      disconnect: 'disconnect',
    },
  },
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => status),
  useMutation: vi.fn((name) => ({ createAuthorizeUrl })[name]),
  useAction: vi.fn((name) => ({ refreshConnection, disconnect })[name]),
}));

const baseStatus = {
  state: 'not_connected',
  connected: false,
  merchant_id: null,
  location_name: null,
  updated_at: null,
  can_manage: true,
};

describe('SquareConnectCard', () => {
  beforeEach(() => {
    status = { ...baseStatus };
    createAuthorizeUrl.mockReset();
    refreshConnection.mockReset();
    disconnect.mockReset();
    window.history.replaceState(null, '', '/settings#integrations');
  });

  it('starts Square OAuth and redirects to the authorize URL', async () => {
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign, href: originalLocation.href, search: '' },
    });
    const url = 'https://connect.squareupsandbox.com/oauth2/authorize?client_id=app&state=abc';
    createAuthorizeUrl.mockResolvedValue({ url });

    render(<SquareConnectCard />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Square' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(url));
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('shows the masked merchant and location when connected, and never a token', () => {
    status = { ...baseStatus, state: 'connected', connected: true, merchant_id: '****1234', location_name: 'Main St' };
    render(<SquareConnectCard />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*\*1234/)).toBeInTheDocument();
    expect(screen.getByText(/Main St/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Square' })).not.toBeInTheDocument();
  });

  it('asks for confirmation before disconnecting', async () => {
    status = { ...baseStatus, state: 'connected', connected: true, merchant_id: '****1234' };
    disconnect.mockResolvedValue({ disconnected: true });
    render(<SquareConnectCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('explains a failed OAuth return and clears the query params', async () => {
    window.history.replaceState(null, '', '/settings?square_connect=error&reason=merchant_in_use#integrations');
    render(<SquareConnectCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already connected to another/);
    expect(window.location.search).toBe('');
  });

  it('shows reconnect when attention is needed', () => {
    status = { ...baseStatus, state: 'needs_reconnect', connected: true };
    render(<SquareConnectCard />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Square' })).toBeInTheDocument();
  });

  it('surfaces errors and hides management controls from non-managers', async () => {
    createAuthorizeUrl.mockRejectedValue(new Error('Only business owners and admins can manage Square payments.'));
    const { rerender } = render(<SquareConnectCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Square' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only business owners');

    status = { ...baseStatus, can_manage: false };
    rerender(<SquareConnectCard />);
    expect(screen.queryByRole('button', { name: 'Connect Square' })).not.toBeInTheDocument();
  });
});

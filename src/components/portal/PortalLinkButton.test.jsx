import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFunctionName } from 'convex/server';
import { PortalLinkButton } from './PortalLinkButton';

const { mockUseQuery, mutations, toast } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mutations: { createOrRotatePortalLink: vi.fn(), revokePortalLink: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('convex/react', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (ref) => mutations[getFunctionName(ref).split(':')[1]],
}));
vi.mock('sonner', () => ({ toast }));

const TOKEN = '11111111-2222-4333-8444-555555555555';

describe('PortalLinkButton', () => {
  let writeText;
  beforeEach(() => {
    mockUseQuery.mockReset();
    Object.values(mutations).forEach((fn) => fn.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
    writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a link on first use and copies the URL', async () => {
    mockUseQuery.mockReturnValue(null);
    mutations.createOrRotatePortalLink.mockResolvedValue({ token: TOKEN, expires_at: Date.now() + 1000 });
    render(<PortalLinkButton customerId="customers:1" />);
    expect(mockUseQuery).toHaveBeenCalledWith(expect.anything(), { customer_id: 'customers:1' });
    fireEvent.click(screen.getByRole('button', { name: 'Create portal link' }));
    await waitFor(() => expect(mutations.createOrRotatePortalLink).toHaveBeenCalledWith({ customer_id: 'customers:1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/${TOKEN}`));
    expect(toast.success).toHaveBeenCalledWith('Portal link copied.');
  });

  it('copies an existing link and exposes rotate/revoke options', async () => {
    mockUseQuery.mockReturnValue({ token: TOKEN, expires_at: Date.now() + 86400000 * 200, created_at: 1, last_access_at: null });
    mutations.createOrRotatePortalLink.mockResolvedValue({ token: 'rotated-token-0000000000', expires_at: 1 });
    mutations.revokePortalLink.mockResolvedValue({ revoked: 1 });
    render(<PortalLinkButton customerId="customers:1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy portal link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/${TOKEN}`));
    expect(mutations.createOrRotatePortalLink).not.toHaveBeenCalled();

    const options = screen.getByRole('button', { name: 'Portal options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(options);
    expect(screen.getByText(/never viewed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New link' }));
    await waitFor(() => expect(mutations.createOrRotatePortalLink).toHaveBeenCalledWith({ customer_id: 'customers:1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/rotated-token-0000000000`));

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(mutations.revokePortalLink).toHaveBeenCalledWith({ customer_id: 'customers:1' }));
    expect(toast.success).toHaveBeenCalledWith('Portal link turned off.');
  });

  it('reports mutation failures', async () => {
    mockUseQuery.mockReturnValue(null);
    mutations.createOrRotatePortalLink.mockRejectedValue(new Error('Only the account owner can manage portal links.'));
    render(<PortalLinkButton customerId="customers:1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create portal link' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the account owner can manage portal links.'));
  });

  it('skips Convex when given a local numeric Dexie customer ID', () => {
    mockUseQuery.mockReturnValue(undefined);

    render(<PortalLinkButton customerId={42} />);

    expect(mockUseQuery).toHaveBeenCalledWith(expect.anything(), 'skip');
    expect(screen.getByRole('button', { name: 'Create portal link' })).toBeDisabled();
  });
});

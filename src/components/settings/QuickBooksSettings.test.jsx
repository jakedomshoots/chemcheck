import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFunctionName } from 'convex/server';
import { QuickBooksSettings, consumeCallbackParams } from './QuickBooksSettings';

const { mockUseQuery, actions, mutations, toast } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  actions: { getAuthorizeUrl: vi.fn(), disconnect: vi.fn(), syncNow: vi.fn() },
  mutations: { updateSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('convex/react', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useAction: (ref) => actions[getFunctionName(ref).split(':')[1]],
  useMutation: (ref) => mutations[getFunctionName(ref).split(':')[1]],
}));
vi.mock('sonner', () => ({ toast }));

const baseStatus = {
  configured: true,
  missing: [],
  can_manage: true,
  connected: false,
  realm_id: null,
  environment: 'sandbox',
  connected_at: null,
  connected_by: null,
  last_sync_at: null,
  last_error: null,
  refresh_expires_at: null,
  auto_sync: true,
  company_url: 'https://app.sandbox.qbo.intuit.com/app/homepage',
  counts: { customer: 0, invoice: 0, payment: 0 },
};

function mockStatus(status, log = []) {
  mockUseQuery.mockImplementation((ref) => (getFunctionName(ref) === 'quickbooks:getStatus' ? status : log));
}

describe('QuickBooksSettings', () => {
  let assign;
  beforeEach(() => {
    mockUseQuery.mockReset();
    Object.values(actions).forEach((fn) => fn.mockReset());
    Object.values(mutations).forEach((fn) => fn.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
    assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign, search: '', pathname: '/settings', hash: '' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the OAuth flow when not connected', async () => {
    mockStatus(baseStatus);
    actions.getAuthorizeUrl.mockResolvedValue({ url: 'https://appcenter.intuit.com/connect/oauth2?state=x' });
    render(<QuickBooksSettings />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect QuickBooks' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://appcenter.intuit.com/connect/oauth2?state=x'));
  });

  it('explains missing server configuration and disables connect', () => {
    mockStatus({ ...baseStatus, configured: false, missing: ['QBO_CLIENT_ID'] });
    render(<QuickBooksSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('Missing: QBO_CLIENT_ID');
    expect(screen.getByRole('button', { name: 'Connect QuickBooks' })).toBeDisabled();
  });

  it('shows connection details, runs a sync, toggles auto-sync and disconnects', async () => {
    mockStatus(
      { ...baseStatus, connected: true, realm_id: '9130', connected_at: 1, connected_by: 'owner@example.com', last_sync_at: 2, last_error: 'Invoice CC-1: boom', counts: { customer: 3, invoice: 2, payment: 1 } },
      [{ _id: 'l1', entity_type: 'invoice', action: 'create', status: 'success', message: null, created_at: 3 }],
    );
    actions.syncNow.mockResolvedValue({ customers: 3, invoices: 2, payments: 1, skipped: 0, errors: [] });
    actions.disconnect.mockResolvedValue({ ok: true });
    mutations.updateSettings.mockResolvedValue('biz');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<QuickBooksSettings />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Realm 9130')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invoice CC-1: boom');
    expect(screen.getByText('3 customers · 2 invoices · 1 payments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open QuickBooks/ })).toHaveAttribute('href', 'https://app.sandbox.qbo.intuit.com/app/homepage');
    expect(screen.getByRole('list', { name: 'Sync log' })).toHaveTextContent('invoice create');

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(actions.syncNow).toHaveBeenCalledWith({}));
    expect(toast.success).toHaveBeenCalledWith('Synced 3 customers, 2 invoices, 1 payments.');

    fireEvent.click(screen.getByRole('checkbox', { name: /Sync invoices automatically/ }));
    await waitFor(() => expect(mutations.updateSettings).toHaveBeenCalledWith({ quickbooks_auto_sync: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(actions.disconnect).toHaveBeenCalledWith({}));
  });

  it('lists sync errors after a run with failures', async () => {
    mockStatus({ ...baseStatus, connected: true, realm_id: '1' });
    actions.syncNow.mockResolvedValue({ customers: 0, invoices: 0, payments: 0, skipped: 0, errors: ['Alice: Duplicate Name'] });
    render(<QuickBooksSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Alice: Duplicate Name')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Sync finished with 1 error.');
  });

  it('is read-only for non-managers', () => {
    mockStatus({ ...baseStatus, can_manage: false });
    render(<QuickBooksSettings />);
    expect(screen.getByRole('button', { name: 'Connect QuickBooks' })).toBeDisabled();
    expect(screen.getByText(/Only the account owner or an admin/)).toBeInTheDocument();
  });

  it('parses the OAuth callback query string', () => {
    expect(consumeCallbackParams('?section=integrations&quickbooks=connected')).toEqual({ kind: 'success', text: 'QuickBooks connected.', cleanedSearch: '?section=integrations' });
    expect(consumeCallbackParams('?quickbooks=error&reason=access_denied')).toMatchObject({ kind: 'error', text: 'QuickBooks connection was cancelled.', cleanedSearch: '' });
    expect(consumeCallbackParams('?quickbooks=error&reason=weird')).toMatchObject({ kind: 'error', text: 'QuickBooks connection failed.' });
    expect(consumeCallbackParams('?other=1')).toBeNull();
  });
});

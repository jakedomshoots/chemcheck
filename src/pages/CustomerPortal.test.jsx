import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getFunctionName } from 'convex/server';
import CustomerPortalPage from './CustomerPortal';

const { mockGetPortal, mockRequestService } = vi.hoisted(() => ({ mockGetPortal: vi.fn(), mockRequestService: vi.fn() }));
vi.mock('convex/react', () => ({
  useAction: (ref) => (getFunctionName(ref) === 'portal:getPortal' ? mockGetPortal : mockRequestService),
}));

const TOKEN = '11111111-2222-4333-8444-555555555555';
const portal = {
  business: { name: 'Blue Pools', phone: '+15551234567', email: 'hello@bluepools.com' },
  customer: { first_name: 'Alice', service_day: 'Monday' },
  visits: [
    { id: 'v1', date: '2026-03-02', status: 'completed', service_type: 'Regular Cleaning', overall_status: 'needs_attention', readings: { ph: 'high', chlorine: 'good', alkalinity: 'good', stabilizer: 'good', salt: null }, notes: 'Brushed walls', technician: 'Blue Pools', duration_ms: 1800000, photos: [{ id: 'p1', category: 'after', url: 'https://img/1' }] },
    { id: 'v2', date: '2026-02-23', status: 'completed', service_type: null, overall_status: null, readings: null, notes: null, technician: null, duration_ms: null, photos: [] },
  ],
  open_invoices: [{ id: 'i1', total: 100, due_date: '2026-03-20', payment_url: 'https://pay/1', sent_at: 1 }],
  quotes: [{ id: 'q1', title: 'Pump replacement', total: 900, valid_until: null, deposit_required: 200, deposit_status: 'pending', deposit_payment_url: 'https://pay/dep' }],
  open_requests: [{ id: 'w1', title: 'Customer request: Filter', scheduled_date: '2026-03-12', created_at: 1 }],
  allow_service_requests: true,
  expires_at: null,
};

function renderAt(token) {
  return render(
    <MemoryRouter initialEntries={[`/portal/${token}`]}>
      <Routes>
        <Route path="/portal/:token" element={<CustomerPortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CustomerPortalPage', () => {
  beforeEach(() => {
    mockGetPortal.mockReset();
    mockRequestService.mockReset();
  });

  it('renders the customer view from the token', async () => {
    mockGetPortal.mockResolvedValue({ found: true, portal });
    renderAt(TOKEN);
    expect(await screen.findByRole('heading', { name: 'Hi Alice' })).toBeInTheDocument();
    expect(mockGetPortal).toHaveBeenCalledWith({ token: TOKEN });
    expect(screen.getByText('Blue Pools')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+15551234567');
    expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', 'https://pay/1');
    expect(screen.getByRole('link', { name: 'Pay deposit to approve' })).toHaveAttribute('href', 'https://pay/dep');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Filter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mon, Mar 2, 2026/ }));
    expect(screen.getByText('Brushed walls')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /after photo/ })).toHaveAttribute('src', 'https://img/1');
    expect(screen.getByRole('button', { name: /Mon, Feb 23, 2026/ })).not.toHaveAttribute('aria-expanded');
  });

  it('submits a service request with the token', async () => {
    mockGetPortal.mockResolvedValue({ found: true, portal });
    mockRequestService.mockResolvedValue({ ok: true, work_order_id: 'w2' });
    renderAt(TOKEN);
    await screen.findByRole('heading', { name: 'Hi Alice' });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Pump is grinding' } });
    fireEvent.change(screen.getByLabelText(/Preferred date/), { target: { value: '2030-01-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request service' }));
    await waitFor(() => expect(mockRequestService).toHaveBeenCalledWith({ token: TOKEN, message: 'Pump is grinding', preferred_date: '2030-01-15' }));
    expect(await screen.findByText('Request sent.')).toBeInTheDocument();
  });

  it('shows server-side request errors and client validation', async () => {
    mockGetPortal.mockResolvedValue({ found: true, portal });
    mockRequestService.mockResolvedValue({ ok: false, error: 'Too many requests. Please try again in a minute.' });
    renderAt(TOKEN);
    await screen.findByRole('heading', { name: 'Hi Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Request service' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tell us a little');
    expect(mockRequestService).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Pump is grinding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request service' }));
    expect(await screen.findByText('Too many requests. Please try again in a minute.')).toBeInTheDocument();
  });

  it('renders failure states and short-circuits malformed tokens', async () => {
    mockGetPortal.mockResolvedValue({ found: false, failure_reason: 'expired', error: 'This portal link has expired.' });
    renderAt(TOKEN);
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
    expect(screen.getByText('This portal link has expired.')).toBeInTheDocument();

    mockGetPortal.mockClear();
    renderAt('bad');
    expect(await screen.findByRole('heading', { name: "This link isn't valid" })).toBeInTheDocument();
    expect(mockGetPortal).not.toHaveBeenCalled();
  });

  it('hides the request form when the business disallows requests', async () => {
    mockGetPortal.mockResolvedValue({ found: true, portal: { ...portal, allow_service_requests: false, open_invoices: [], quotes: [] } });
    renderAt(TOKEN);
    await screen.findByRole('heading', { name: 'Hi Alice' });
    expect(screen.queryByRole('button', { name: 'Request service' })).not.toBeInTheDocument();
    expect(screen.queryByText('Open invoices')).not.toBeInTheDocument();
  });
});

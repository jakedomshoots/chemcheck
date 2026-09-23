import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Billing from './Billing';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(async () => undefined),
  useQuery: (...args) => useQueryMock(...args),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/convexHooks', () => ({
  useCurrentUser: () => ({ email: 'owner@example.com' }),
  useCustomersFilter: () => [
    { _id: 'cust_1', full_name: 'Ada Lovelace' },
    { _id: 'cust_2', full_name: 'Grace Hopper' },
  ],
}));

const OVERVIEW = {
  stats: {
    outstanding_total: 300,
    overdue_total: 150,
    overdue_count: 1,
    collected_last_30_days: 450,
    draft_count: 0,
    active_plans: 1,
  },
  standings: [
    { customer_id: 'cust_1', customer_name: 'Ada Lovelace', standing: 'overdue', open_balance: 150, overdue_days: 5 },
    { customer_id: 'cust_2', customer_name: 'Grace Hopper', standing: 'current', open_balance: 0, overdue_days: 0 },
  ],
};

const INVOICES = {
  page: [
    {
      _id: 'inv_1',
      customer_id: 'cust_1',
      status: 'sent',
      total: 150,
      due_date: '2020-01-01',
      line_items: [{ description: 'Monthly pool service', quantity: 1, unit_price: 150, amount: 150 }],
    },
  ],
  continueCursor: null,
  isDone: true,
};

const PLANS = [
  {
    _id: 'plan_1',
    customer_id: 'cust_1',
    customer_name: 'Ada Lovelace',
    label: 'Monthly pool service',
    amount: 150,
    day_of_month: 1,
    auto_send: true,
    status: 'active',
    next_run_date: '2026-10-01',
  },
];

describe('Billing page', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    // Billing.jsx queries in fixed order: overview, invoices, service plans, providers.
    // Cycle so re-renders keep returning the same data.
    const responses = [
      OVERVIEW,
      INVOICES,
      PLANS,
      { stripe: { ready: true, missing: [] }, mailersend: { ready: true, missing: [] } },
    ];
    let call = 0;
    useQueryMock.mockImplementation(() => responses[call++ % responses.length]);
  });

  it('renders stats, an overdue invoice, and the standing chips', () => {
    render(<BrowserRouter><Billing /></BrowserRouter>);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByText('$300.00')).toBeInTheDocument();
    expect(screen.getByText(/Overdue \d+d/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New invoice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New plan/i })).toBeInTheDocument();
  });

  it('shows customer payment standing on the Customers tab', async () => {
    render(<BrowserRouter><Billing /></BrowserRouter>);

    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Customers' }));

    expect(screen.getByText('Overdue 5d')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });
});

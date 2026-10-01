import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import ChemicalCostsPage from './ChemicalCosts';

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: (...args) => mockUseQuery(...args) }));

const summary = {
  totals: { total_cost: 123.45, rows: 4, priced_rows: 3, unpriced_rows: 1, visits: 3, cost_per_visit: 41.15 },
  top_pools: [
    { key: 'c1|', label: 'Alice · Spa', customer_id: 'c1', service_day: 'Monday', total_cost: 100, rows: 2, priced_rows: 2, visits: 2, cost_per_visit: 50 },
    { key: 'c2|', label: 'Bob', customer_id: 'c2', service_day: 'Tuesday', total_cost: 23.45, rows: 2, priced_rows: 1, visits: 1, cost_per_visit: 23.45 },
  ],
  by_customer: [
    { key: 'c1|', label: 'Alice · Spa', customer_id: 'c1', service_day: 'Monday', total_cost: 100, rows: 2, priced_rows: 2, visits: 2, cost_per_visit: 50, dates: ['2026-03-02'], chemicals: [{ chemical_type: 'Liquid Chlorine', total_cost: 100, rows: 2, priced_rows: 2, amount: 25, unit: 'gal' }] },
    { key: 'c2|', label: 'Bob', customer_id: 'c2', service_day: 'Tuesday', total_cost: 23.45, rows: 2, priced_rows: 1, visits: 1, cost_per_visit: 23.45, dates: ['2026-03-03'], chemicals: [{ chemical_type: 'Algaecide', total_cost: 0, rows: 1, priced_rows: 0, amount: 0, unit: '' }] },
  ],
  by_technician: [{ key: 'tech@example.com', label: 'tech@example.com', total_cost: 123.45, rows: 4, priced_rows: 3, visits: 3, cost_per_visit: 41.15 }],
  by_route_day: [{ key: 'Monday', label: 'Monday', total_cost: 100, rows: 2, priced_rows: 2, visits: 2, cost_per_visit: 50 }],
  by_month: [{ key: '2026-03', label: '2026-03', total_cost: 123.45, rows: 4, priced_rows: 3, visits: 3, cost_per_visit: 41.15 }],
  by_chemical: [{ chemical_type: 'Liquid Chlorine', total_cost: 100, rows: 2, priced_rows: 2, amount: 25, unit: 'gal' }, { chemical_type: 'Algaecide', total_cost: 0, rows: 1, priced_rows: 0, amount: 0, unit: '' }],
  unpriced_chemicals: ['Algaecide'],
  range: { start: '2026-03-01', end: '2026-03-31' },
  truncated: false,
  technicians: ['tech@example.com'],
  has_prices: true,
};

function renderPage() {
  return render(<BrowserRouter><ChemicalCostsPage /></BrowserRouter>);
}

describe('ChemicalCostsPage', () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  it('shows a loading state while the summary loads', () => {
    mockUseQuery.mockReturnValue(undefined);
    renderPage();
    expect(screen.getByText(/Crunching costs/)).toBeInTheDocument();
    expect(mockUseQuery.mock.calls[0][1]).toMatchObject({ top_n: 10 });
  });

  it('renders totals, top pools, technicians and the unpriced warning', () => {
    mockUseQuery.mockReturnValue(summary);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Chemical Costs' })).toBeInTheDocument();
    expect(screen.getByTestId('stat-total-cost')).toHaveTextContent('$123.45');
    expect(screen.getByTestId('stat-cost-per-visit')).toHaveTextContent('$41.15');
    expect(screen.getByTestId('stat-unpriced')).toHaveTextContent('1');

    const pools = screen.getByRole('table', { name: 'Top pools by chemical cost' });
    const rows = within(pools).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Alice · Spa');
    expect(rows[1]).toHaveTextContent('$50.00');

    expect(screen.getByRole('table', { name: 'Chemical cost by technician' })).toHaveTextContent('tech');
    expect(screen.getByRole('status')).toHaveTextContent('No price set for: Algaecide');
    expect(screen.getByRole('link', { name: /Edit prices/ })).toHaveAttribute('href', '/settings?section=services');
    expect(screen.getByRole('table', { name: 'Chemical cost by product' })).toHaveTextContent('No price');
  });

  it('expands a customer to reveal its chemical breakdown', () => {
    mockUseQuery.mockReturnValue(summary);
    renderPage();
    const toggle = screen.getByRole('button', { name: /Alice · Spa/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('25 gal')).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('25 gal')).toHaveLength(2);
  });

  it('switches presets and validates a custom range', () => {
    mockUseQuery.mockReturnValue(summary);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-04-10' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-04-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Start date must be on or before the end date.');
    expect(mockUseQuery).toHaveBeenLastCalledWith(expect.anything(), 'skip');
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(mockUseQuery.mock.calls.at(-1)[1]).toMatchObject({ start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});

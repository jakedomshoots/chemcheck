import { act, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkOrders from './WorkOrders';

const { useQueryMock, useCustomersMock, localhostBypassMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useCustomersMock: vi.fn(),
  localhostBypassMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: (...args) => useQueryMock(...args),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('@/api/dexieHooks', () => ({ useCustomers: () => useCustomersMock() }));
vi.mock('@/lib/platformPolicy', () => ({ shouldUseDevelopmentAuthBypass: () => localhostBypassMock() }));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

describe('WorkOrders cloud gate', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useCustomersMock.mockReturnValue([]);
    localhostBypassMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading surface without financial controls before getCurrent resolves', () => {
    useQueryMock.mockReturnValue(undefined);

    render(<BrowserRouter><WorkOrders /></BrowserRouter>);

    expect(screen.getByRole('heading', { name: 'Loading Work Orders' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a read-only unavailable surface when no cloud business exists', () => {
    useQueryMock.mockReturnValueOnce(null).mockReturnValue(undefined);

    render(<BrowserRouter><WorkOrders /></BrowserRouter>);

    expect(screen.getByRole('heading', { name: 'Work Orders is unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/Connect to a cloud business/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stops loading when the cloud business query does not resolve', () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue(undefined);

    render(<BrowserRouter><WorkOrders /></BrowserRouter>);
    act(() => vi.advanceTimersByTime(12_000));

    expect(screen.getByRole('heading', { name: 'Work Orders is unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/could not reach your cloud business/i)).toBeInTheDocument();
  });

  it('discloses when cloud metrics only cover a bounded data window', () => {
    const completePage = { page: [], continueCursor: '', isDone: true };
    const truncatedPage = { page: [], continueCursor: 'next-page', isDone: false };

    useQueryMock
      .mockReturnValueOnce({ _id: 'business-1', name: 'ChemCheck' })
      .mockReturnValueOnce({ customers: [], cursor: 'next-customers', hasMore: true })
      .mockReturnValueOnce([])
      .mockReturnValueOnce(completePage)
      .mockReturnValueOnce(truncatedPage)
      .mockReturnValueOnce(completePage)
      .mockReturnValueOnce(completePage)
      .mockReturnValueOnce(completePage);

    render(<BrowserRouter><WorkOrders /></BrowserRouter>);

    expect(screen.getByRole('status')).toHaveTextContent(/showing up to 200 records per data set/i);
    expect(screen.getByRole('status')).toHaveTextContent(/totals may be incomplete/i);
  });

});

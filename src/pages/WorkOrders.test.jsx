import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkOrders from './WorkOrders';

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: (...args) => useQueryMock(...args),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

describe('WorkOrders cloud gate', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
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

});

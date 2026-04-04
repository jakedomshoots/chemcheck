import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Clients from './Clients';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data and functions
let mockCustomers = [];
const mockUpdateCustomer = vi.fn();
const mockDeleteCustomer = vi.fn();
const mockUser = { email: 'test@example.com' };
const setMockCustomers = (customers) => {
  mockCustomers = customers;
};

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomersFilter: () => mockCustomers,
    useCustomerUpdate: () => mockUpdateCustomer,
    useCustomerDelete: () => mockDeleteCustomer
}));

vi.mock('convex/react', () => ({
    useQuery: () => undefined
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock child components
vi.mock('../components/clients/ClientListItem', () => ({
    default: ({ customer, onMoveUp, onMoveDown, isFirst, isLast, isMoving }) => (
      <div data-testid={`client-item-${customer._id}`}>
        <span>{customer.full_name}</span>
        <button
          aria-label={`Move up ${customer._id}`}
          onClick={() => onMoveUp(customer)}
          disabled={isFirst || isMoving}
        >
          up
        </button>
        <button
          aria-label={`Move down ${customer._id}`}
          onClick={() => onMoveDown(customer)}
          disabled={isLast || isMoving}
        >
          down
        </button>
      </div>
    )
}));

// Mock UI components that might be complex
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children }) => <div>{children}</div>,
    TabsList: ({ children }) => <div>{children}</div>,
    TabsTrigger: React.forwardRef(function TabsTriggerMock({ children, onClick }, ref) {
      return <button ref={ref} onClick={onClick}>{children}</button>;
    }),
    TabsContent: ({ children }) => <div>{children}</div>
}));

describe('Clients Page', () => {
    beforeEach(() => {
      mockUpdateCustomer.mockResolvedValue(undefined);
      mockUpdateCustomer.mockClear();
      setMockCustomers([
        { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0 },
        { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Tuesday', sort_order: 0 }
      ]);
    });

    it('renders client list even when business query is unavailable', async () => {
        render(<BrowserRouter><Clients /></BrowserRouter>);
        // We mock ClientListItem to just show name, so we look for that
        expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
        expect(await screen.findByText('Bob Jones')).toBeInTheDocument();
    });

    it('filters clients by search', async () => {
        render(<BrowserRouter><Clients /></BrowserRouter>);
        const searchInput = screen.getByPlaceholderText(/Search clients/i);

        fireEvent.change(searchInput, { target: { value: 'Alice' } });

        expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
        expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });

    it('normalizes missing sort_order values and reorders by explicit positions', async () => {
        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: undefined, createdAt: '2024-01-01T10:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', createdAt: '2024-01-02T10:00:00.000Z' },
            { _id: 'c3', full_name: 'Cora Lane', address: '789 Citrus Rd', service_day: 'Monday', sort_order: undefined, createdAt: '2024-01-03T10:00:00.000Z' },
        ]);

        render(<BrowserRouter><Clients /></BrowserRouter>);

        // Normalization should assign deterministic sort orders.
        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c1', sort_order: 0 }));
        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c3', sort_order: 2 }));
        mockUpdateCustomer.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /Reorder/i }));
        const rowListBefore = screen.getAllByTestId(/client-item-/);
        expect(rowListBefore[0]).toHaveTextContent('Alice Smith');

        fireEvent.click(screen.getByRole('button', { name: /Move down c1/i }));

        await waitFor(() => {
            expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c1', sort_order: 1 });
            expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c2', sort_order: 0 });
        });

        const rowListAfter = screen.getAllByTestId(/client-item-/);
        expect(rowListAfter[0]).toHaveTextContent('Bob Jones');
        expect(rowListAfter[1]).toHaveTextContent('Alice Smith');
    });

    it('normalizes duplicate and missing sort_order values deterministically', async () => {
        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 1, createdAt: '2024-01-01T10:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', sort_order: 1, createdAt: '2024-01-02T10:00:00.000Z' },
            { _id: 'c3', full_name: 'Cora Lane', address: '789 Citrus Rd', service_day: 'Monday', createdAt: '2024-01-03T10:00:00.000Z' },
        ]);

        render(<BrowserRouter><Clients /></BrowserRouter>);

        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c1', sort_order: 0 }));
        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c3', sort_order: 2 }));

        const rows = screen.getAllByTestId(/client-item-/);
        expect(rows[0]).toHaveTextContent('Alice Smith');
        expect(rows[1]).toHaveTextContent('Bob Jones');
        expect(rows[2]).toHaveTextContent('Cora Lane');
    });

    it('supports creating a customer without sort_order then reordering immediately', async () => {
        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0, createdAt: '2026-03-24T09:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', sort_order: 1, createdAt: '2026-03-24T10:00:00.000Z' }
        ]);

        const { rerender } = render(<BrowserRouter><Clients /></BrowserRouter>);

        await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText('Bob Jones')).toBeInTheDocument());
        mockUpdateCustomer.mockClear();

        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0, createdAt: '2026-03-24T09:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', sort_order: 1, createdAt: '2026-03-24T10:00:00.000Z' },
            { _id: 'c3', full_name: 'Cora Lane', address: '789 Citrus Rd', service_day: 'Monday', sort_order: undefined, createdAt: '2026-03-24T11:00:00.000Z' }
        ]);
        rerender(<BrowserRouter><Clients /></BrowserRouter>);

        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c3', sort_order: 2 }));
        mockUpdateCustomer.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /Reorder/i }));

        const beforeMove = screen.getAllByTestId(/client-item-/);
        expect(beforeMove[0]).toHaveTextContent('Alice Smith');
        expect(beforeMove[1]).toHaveTextContent('Bob Jones');
        expect(beforeMove[2]).toHaveTextContent('Cora Lane');

        fireEvent.click(screen.getByRole('button', { name: /Move up c3/i }));

        await waitFor(() => {
            expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c2', sort_order: 2 });
            expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c3', sort_order: 1 });
        });

        const afterMove = screen.getAllByTestId(/client-item-/);
        expect(afterMove[0]).toHaveTextContent('Alice Smith');
        expect(afterMove[1]).toHaveTextContent('Cora Lane');
        expect(afterMove[2]).toHaveTextContent('Bob Jones');
    });

    it('keeps the intended order while reorder writes are still syncing', async () => {
        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0, createdAt: '2024-01-01T10:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', sort_order: 1, createdAt: '2024-01-02T10:00:00.000Z' },
            { _id: 'c3', full_name: 'Cora Lane', address: '789 Citrus Rd', service_day: 'Monday', sort_order: 2, createdAt: '2024-01-03T10:00:00.000Z' },
        ]);

        const updateResolvers = new Map();
        mockUpdateCustomer.mockImplementation(({ id }) => new Promise((resolve) => {
            updateResolvers.set(id, resolve);
        }));

        const { rerender } = render(<BrowserRouter><Clients /></BrowserRouter>);

        await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Reorder/i }));
        fireEvent.click(screen.getByRole('button', { name: /Move down c1/i }));

        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c1', sort_order: 1 }));
        await waitFor(() => expect(mockUpdateCustomer).toHaveBeenCalledWith({ id: 'c2', sort_order: 0 }));
        await waitFor(() => {
            const rowsAfterMove = screen.getAllByTestId(/client-item-/);
            expect(rowsAfterMove[0]).toHaveTextContent('Bob Jones');
            expect(rowsAfterMove[1]).toHaveTextContent('Alice Smith');
        });

        setMockCustomers([
            { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 1, createdAt: '2024-01-01T10:00:00.000Z' },
            { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Monday', sort_order: 1, createdAt: '2024-01-02T10:00:00.000Z' },
            { _id: 'c3', full_name: 'Cora Lane', address: '789 Citrus Rd', service_day: 'Monday', sort_order: 2, createdAt: '2024-01-03T10:00:00.000Z' },
        ]);
        rerender(<BrowserRouter><Clients /></BrowserRouter>);

        await waitFor(() => {
            const rowsDuringSync = screen.getAllByTestId(/client-item-/);
            expect(rowsDuringSync[0]).toHaveTextContent('Bob Jones');
            expect(rowsDuringSync[1]).toHaveTextContent('Alice Smith');
        });

        updateResolvers.get('c1')?.();
        updateResolvers.get('c2')?.();
    });
});

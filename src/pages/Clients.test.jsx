import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Clients from './Clients';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data and functions
const mockCustomers = [
    { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0 },
    { _id: 'c2', full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Tuesday', sort_order: 0 }
];
const mockUpdateCustomer = vi.fn();
const mockDeleteCustomer = vi.fn();
const mockUser = { email: 'test@example.com' };

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomersFilter: () => mockCustomers,
    useCustomerUpdate: () => mockUpdateCustomer,
    useCustomerDelete: () => mockDeleteCustomer
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
    default: ({ customer }) => <div>{customer.full_name}</div>
}));

// Mock UI components that might be complex
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children }) => <div>{children}</div>,
    TabsList: ({ children }) => <div>{children}</div>,
    TabsTrigger: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
    TabsContent: ({ children }) => <div>{children}</div>
}));

describe('Clients Page', () => {
    it('renders client list', () => {
        render(<BrowserRouter><Clients /></BrowserRouter>);
        // We mock ClientListItem to just show name, so we look for that
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });

    it('filters clients by search', () => {
        render(<BrowserRouter><Clients /></BrowserRouter>);
        const searchInput = screen.getByPlaceholderText(/Search clients/i);

        fireEvent.change(searchInput, { target: { value: 'Alice' } });

        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });
});

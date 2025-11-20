import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Home from './Home';
import { format } from 'date-fns';
import { BrowserRouter } from 'react-router-dom';

// Mock data with stable references
const mockCustomers = [
    { _id: 'c1', full_name: 'Alice', address: '123 St', service_day: format(new Date(), 'EEEE'), sort_order: 1 },
    { _id: 'c2', full_name: 'Bob', address: '456 Ave', service_day: format(new Date(), 'EEEE'), sort_order: 2 }
];
const mockLogs = [];

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => ({ email: 'test@example.com' }),
    useCustomersFilter: () => mockCustomers,
    useServiceLogs: () => mockLogs, // No logs yet
    useServiceLogsFilter: () => mockLogs,
    useServiceLogMutation: () => ({ createServiceLog: vi.fn() }),
    useCustomerMutation: () => ({ updateCustomer: vi.fn() })
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock child components
vi.mock('../components/home/CustomerCard', () => ({
    default: ({ customer, isCompleted }) => (
        <div>
            {customer.full_name}
            <span>{isCompleted ? 'Completed' : 'Not Serviced'}</span>
        </div>
    )
}));
vi.mock('../components/home/QuickStats', () => ({
    default: () => <div>QuickStats</div>
}));

// Mock UI
vi.mock('@/components/ui/card', () => ({
    Card: ({ children, className }) => <div className={className}>{children}</div>
}));
vi.mock('@/components/ui/button', () => ({
    Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>
}));

describe('Home Page (Today\'s Route)', () => {
    it('renders today\'s route title', () => {
        render(<BrowserRouter><Home /></BrowserRouter>);
        expect(screen.getByText(/Today's Route/i)).toBeInTheDocument();
    });

    it('displays customers scheduled for today', () => {
        render(<BrowserRouter><Home /></BrowserRouter>);
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('shows service status correctly', () => {
        render(<BrowserRouter><Home /></BrowserRouter>);
        // Should show "Not Serviced" for both since we mocked empty logs
        const statusElements = screen.getAllByText('Not Serviced');
        expect(statusElements.length).toBeGreaterThan(0);
    });
});

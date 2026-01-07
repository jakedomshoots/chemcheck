import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WeeklyReport from './WeeklyReport';
import { addWeeks, startOfWeek, endOfWeek, format } from 'date-fns';

// Mock the hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => ({ email: 'test@example.com', name: 'Test User' }),
    useCustomersFilter: () => [
        { _id: 'cust1', full_name: 'John Doe', address: '123 Main St', service_day: 'Monday' },
        { _id: 'cust2', full_name: 'Jane Smith', address: '456 Oak Ave', service_day: 'Tuesday' }
    ],
    useServiceLogs: () => {
        const today = new Date();
        const monday = startOfWeek(today, { weekStartsOn: 1 });

        return [
            {
                _id: 'log1',
                customer_id: 'cust1',
                service_date: format(monday, 'yyyy-MM-dd'), // Log for this week
                ph: '7.4',
                chlorine: '3.0'
            },
            {
                _id: 'log2',
                customer_id: 'cust2',
                service_date: '2023-01-01', // Old log
                ph: '7.2',
                chlorine: '2.0'
            }
        ];
    }
}));

// Mock UI components that might cause issues in tests
vi.mock('@/components/ui/button', () => ({
    Button: ({ children, onClick, disabled }) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    )
}));

vi.mock('@/components/ui/card', () => ({
    Card: ({ children, className }) => <div className={className}>{children}</div>
}));

describe('WeeklyReport', () => {
    it('renders the report title', () => {
        render(<WeeklyReport />);
        expect(screen.getByText('Weekly Report')).toBeInTheDocument();
    });

    it('calculates total services correctly', () => {
        render(<WeeklyReport />);
        // Should be 1 because only one log is in the current week
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('Total Services This Week')).toBeInTheDocument();
    });

    it('displays customer data for the correct day', () => {
        render(<WeeklyReport />);
        // John Doe has a log this week (Monday)
        expect(screen.getByText('Monday')).toBeInTheDocument();
        // We need to click/expand the day to see the customer, but the count should be visible
        expect(screen.getByText('1 service')).toBeInTheDocument();
    });
});

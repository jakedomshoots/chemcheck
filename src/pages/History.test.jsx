import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import History from './History';
import { BrowserRouter } from 'react-router-dom';
import { format } from 'date-fns';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const today = format(new Date(), 'yyyy-MM-dd');
const mockLogs = [
    { _id: 'l1', customer_id: 'c1', service_date: today, ph: '7.4', chlorine: '3.0' }
];
const mockCustomers = [
    { _id: 'c1', full_name: 'Alice Smith', service_day: 'Monday' }
];
const mockDeleteServiceLog = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useServiceLogs: () => mockLogs,
    useCustomersFilter: () => mockCustomers,
    useServiceLogDelete: () => mockDeleteServiceLog
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock child components
vi.mock('../components/history/CustomerHistoryCard', () => ({
    default: ({ customer }) => <div>{customer.full_name}</div>
}));

// Mock UI components
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children }) => <div>{children}</div>,
    TabsList: ({ children }) => <div>{children}</div>,
    TabsTrigger: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
    TabsContent: ({ children }) => <div>{children}</div>
}));

describe('History Page', () => {
    it('renders service history list', () => {
        render(<BrowserRouter><History /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /^Service History$/i })).toBeInTheDocument();
        // Since we mocked the date to today (Monday?), we might need to click the tab or ensure default is Monday
        // The component defaults to "Monday".
        // If today is Monday, our mock customer is on Monday.
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
});

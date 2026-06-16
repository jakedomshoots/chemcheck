import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import History from './History';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
let mockLogs = [
    { _id: 'l1', customer_id: 'c1', service_date: '2026-02-01', ph: '7.4', chlorine: '3.0', photo_count: 1, start_time: '2026-02-01T10:00:00.000Z', end_time: '2026-02-01T10:20:00.000Z' },
    { _id: 'l2', customer_id: 'c2', service_date: '2026-02-02', ph: '7.5', chlorine: '2.5', photo_count: 0 }
];
let mockCustomers = [
    { _id: 'c1', full_name: 'Alice Smith', service_day: 'Monday' },
    { _id: 'c2', full_name: 'Bob Johnson', service_day: 'Monday' },
];
const mockDeleteServiceLog = vi.fn();
const SelectMockContext = React.createContext({ onValueChange: () => { } });

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useServiceLogs: () => mockLogs,
    useCustomersFilter: () => mockCustomers,
    useServiceLogDelete: () => mockDeleteServiceLog
}));

vi.mock('convex/react', () => ({
    useQuery: () => null
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock child components
vi.mock('../components/history/CustomerHistoryCard', () => ({
    default: ({ customer, logs }) => (
        <div data-testid={`card-${customer._id}`}>
            {customer.full_name} ({logs.length})
        </div>
    )
}));

// Mock UI components
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children }) => <div>{children}</div>,
    TabsList: ({ children }) => <div>{children}</div>,
    TabsTrigger: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
    TabsContent: ({ children }) => <div>{children}</div>
}));

vi.mock('@/components/ui/select', () => ({
    Select: ({ children, onValueChange }) => {
        return (
            <SelectMockContext.Provider value={{ onValueChange }}>
                <div data-testid="proof-filter-select">{children}</div>
            </SelectMockContext.Provider>
        );
    },
    SelectTrigger: ({ children }) => <div>{children}</div>,
    SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ value, children }) => {
        const { onValueChange } = React.useContext(SelectMockContext);
        return <button onClick={() => onValueChange?.(value)}>{children}</button>;
    },
}));

vi.mock('@/components/ui/badge', () => ({
    Badge: ({ children }) => <span>{children}</span>
}));

describe('History Page', () => {
    it('renders service history list', () => {
        render(<BrowserRouter><History /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /^Service History$/i })).toBeInTheDocument();
        expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
        expect(screen.getByText(/Bob Johnson/i)).toBeInTheDocument();
    });

    it('does not show customers with zero matching logs when proof filter is active', () => {
        render(<BrowserRouter><History /></BrowserRouter>);

        // SelectItem mock renders options as buttons
        fireEvent.click(screen.getByRole('button', { name: /Has Photos/i }));

        expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
        expect(screen.queryByText(/Bob Johnson/i)).not.toBeInTheDocument();
    });

});

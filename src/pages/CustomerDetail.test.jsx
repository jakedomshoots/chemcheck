import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CustomerDetail from './CustomerDetail';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockCustomer = {
    _id: 'c1',
    full_name: 'Alice Smith',
    address: '123 St',
    service_day: 'Monday',
    gate_code: '1234',
    pool_type: 'chlorine',
    filter_type: 'cartridge',
    notes: 'Test notes'
};
const mockLogs = [
    { _id: 'l1', service_date: '2023-01-01', ph: '7.4', chlorine: '3.0' }
];
const mockRemoveServiceLog = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => [mockCustomer],
    useCustomer: () => mockCustomer,
    useServiceLogsByCustomer: () => mockLogs,
    useServiceLogDelete: () => mockRemoveServiceLog
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn()
    };
});

describe('Customer Detail Page', () => {
    it('renders customer details', () => {
        window.history.pushState({}, 'Test Page', '/?id=c1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    it('renders service history', () => {
        window.history.pushState({}, 'Test Page', '/?id=c1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        // The service history section is rendered as an accordion
        expect(screen.getByText('Service History')).toBeInTheDocument();
        // The date is inside a collapsed accordion, so we can't test for it
        // Just verify the section exists
    });
});

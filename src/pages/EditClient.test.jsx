import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EditClient from './EditClient';
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
const mockUpdateCustomer = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => [mockCustomer], // It uses useCustomers to find the customer sometimes?
    useCustomer: () => mockCustomer,
    useCustomerUpdate: () => mockUpdateCustomer
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

describe('Edit Client Page', () => {
    it('renders the form with customer data', () => {
        window.history.pushState({}, 'Test Page', '/?id=c1');
        render(<BrowserRouter><EditClient /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /Edit Client/i })).toBeInTheDocument();
        // Check if form labels render
        expect(screen.getByText(/Full Name/i)).toBeInTheDocument();
    });
});

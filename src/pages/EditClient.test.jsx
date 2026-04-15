import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data - use numeric IDs to match parseInt in the component
const mockCustomer = {
    _id: 1,
    full_name: 'Alice Smith',
    address: '123 St',
    service_day: 'Monday',
    gate_code: '1234',
    pool_type: 'Chlorine',
    surface_type: 'Plaster',
    notes: 'Test notes'
};
const mockUpdateCustomer = vi.fn();

// Mock hooks - return undefined initially to simulate loading, then return data
let mockCustomersData = [mockCustomer];

vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => ({ email: 'test@example.com' }),
    useCustomers: () => mockCustomersData,
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

// Mock the Select component to avoid Radix UI issues in tests
vi.mock('@/components/ui/select', () => ({
    Select: ({ children }) => <div data-testid="select">{children}</div>,
    SelectTrigger: ({ children, className }) => <button className={className}>{children}</button>,
    SelectValue: () => <span>Select value</span>,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>
}));

describe('Edit Client Page', () => {
    beforeEach(() => {
        mockCustomersData = [mockCustomer];
        window.history.pushState({}, 'Test Page', '/?id=1');
    });

    it('renders the form with customer data', async () => {
        // Dynamically import to ensure mocks are applied after setup
        const { default: EditClient } = await import('./EditClient');
        
        const { container } = render(<BrowserRouter><EditClient /></BrowserRouter>);
        
        // Wait for the component to finish loading
        await waitFor(() => {
            const heading = container.querySelector('h2');
            expect(heading).toBeTruthy();
        }, { timeout: 2000 });
        
        // Check if form labels render
        expect(screen.getByText(/Full Name/i)).toBeInTheDocument();
    });
});

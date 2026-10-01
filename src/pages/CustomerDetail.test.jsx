import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CustomerDetail from './CustomerDetail';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../components/servicelog/ServiceLogCard', () => ({
    default: ({ log }) => <div data-testid={`service-log-${log?._id || log?.id}`}>Service Log Card</div>
}));

// Mock stable data - use numeric IDs to match parseInt in the component
const mockUser = { email: 'test@example.com' };
const mockCustomer = {
    _id: 1,
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
const mockChemicalUsage = [
    { _id: 'c1', customer_id: 1, created_date: '2023-01-01', chemical_type: 'Muriatic Acid', quantity: '12 fl oz' }
];
const mockRemoveServiceLog = vi.fn();
const mockUpdateCustomer = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => [mockCustomer],
    useCustomer: () => mockCustomer,
    useServiceLogsByCustomer: () => mockLogs,
    useServiceLogDelete: () => mockRemoveServiceLog,
    useCustomerUpdate: () => mockUpdateCustomer,
    useChemicalUsageFilter: () => mockChemicalUsage,
}));

vi.mock('@/api/normalizedHooks', () => ({
    usePoolsByCustomer: () => [],
    useEquipmentByPool: () => [],
    usePoolCreate: () => vi.fn(),
    useEquipmentCreate: () => vi.fn(),
    useEquipmentUpdate: () => vi.fn(),
}));

// Mock Convex react hooks
vi.mock('convex/react', () => ({
    useAction: () => vi.fn().mockResolvedValue({ success: true }),
    useMutation: () => vi.fn().mockResolvedValue({ token: 'test-token' }),
    useQuery: () => null,
    useConvex: () => ({ query: vi.fn(), mutation: vi.fn(), action: vi.fn() })
}));

// Mock utils
vi.mock('@/utils', async () => {
    const actual = await vi.importActual('@/utils');
    return {
        ...actual,
        createPageUrl: (page) => `/page/${page}`,
        formatServiceDate: (date) => date,
        formatServiceDateFull: (date) => date
    };
});

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
        window.history.pushState({}, 'Test Page', '/?id=1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    it('mounts the equipment section with a deep-link anchor', () => {
        window.history.pushState({}, 'Test Page', '/?id=1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        const section = screen.getByTestId('customer-equipment');
        expect(section).toHaveAttribute('id', 'equipment');
        expect(screen.getByRole('button', { name: 'Add equipment' })).toBeInTheDocument();
    });

    it('mounts the readings trend for the customer', () => {
        window.history.pushState({}, 'Test Page', '/?id=1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        const trend = screen.getByTestId('readings-trend');
        expect(trend).toHaveTextContent('Readings trend');
        expect(screen.getByRole('tablist', { name: 'Trend range' })).toBeInTheDocument();
    });

    it('renders service history', () => {
        window.history.pushState({}, 'Test Page', '/?id=1');
        render(<BrowserRouter><CustomerDetail /></BrowserRouter>);
        // The service history section is rendered as an accordion
        expect(screen.getByText('Service History')).toBeInTheDocument();
        // The date is inside a collapsed accordion, so we can't test for it
        // Just verify the section exists
    });
});

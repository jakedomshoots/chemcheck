import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NewServiceLog from './NewServiceLog';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockCustomers = [{ _id: 1, full_name: 'Alice Smith', address: '123 St', pool_type: 'chlorine' }];
const mockCreateServiceLog = vi.fn();

// Mock hooks - returns mock data immediately (no loading state simulation)
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => mockCustomers,
    useServiceLogsByCustomerDateRange: () => [{
        service_date: '2026-07-20',
        ph: 'good',
        ph_value: 7.4,
        chlorine: 'low',
        alkalinity: 'good',
        alkalinity_value: 100,
        stabilizer: 'high',
    }],
    useServiceLogCreate: () => mockCreateServiceLog
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`,
    formatServiceDate: (date) => date === '2026-07-20' ? 'Jul 20' : date,
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock child components
vi.mock('../components/servicelog/SimplifiedChemicalInput', () => ({
    default: ({ label }) => <div>{label} Input</div>
}));

// Mock business settings hook
vi.mock('@/hooks/useBusinessSettings', () => ({
    useBusinessSettings: () => ({
        proofOfServiceSettings: { requirePhotos: false, requireBeforePhotos: false, requireAfterPhotos: false },
        isLoading: false
    })
}));

// Mock proof-of-service components
vi.mock('@/components/proof-of-service', () => ({
    PhotoCaptureSection: ({ title }) => <div>{title}</div>
}));

// Mock proof-of-service lib
vi.mock('@/lib/proof-of-service', () => ({
    deleteUnlinkedPhotos: vi.fn().mockResolvedValue(undefined),
    linkPhotosToServiceLog: vi.fn().mockResolvedValue(undefined),
    getPhotos: vi.fn().mockResolvedValue([]),
    validateServiceCompletion: () => ({ isValid: true, errors: [] }),
    getValidationErrorMessage: () => '',
    hasAnyRequirements: () => false,
    getRequirementsSummary: () => []
}));

vi.mock('convex/react', () => ({
    useQuery: () => null
}));

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

beforeEach(() => {
    mockNavigate.mockReset();
    window.localStorage.clear();
    // Default URL: no customerId param so the missing-client state applies.
    window.history.pushState({}, 'Test Page', '/newservicelog');
});

describe('New Service Log Page', () => {
    it('renders the form', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);
        expect(screen.getByRole('region', { name: 'Service Log' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Service Log', level: 1 })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back to Route' })).toBeInTheDocument();
        expect(screen.getByTestId('service-log-customer-name')).toHaveTextContent('Alice Smith');
        expect(screen.getByTestId('service-log-customer-name')).toHaveClass('text-base');
        expect(screen.getByRole('region', { name: "Last week's chemistry" })).toBeInTheDocument();
    });

    it('presents a restored draft as a compact live save status', async () => {
        window.localStorage.setItem('serviceLogDraft_1', JSON.stringify({
            formData: {},
            savedAt: '2026-07-27T18:35:00.000Z',
        }));
        window.history.pushState({}, 'Test Page', '/?customerId=1');

        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        const savedStatus = await screen.findByRole('status');
        expect(savedStatus).toHaveAccessibleName(/Draft saved at/i);
        expect(savedStatus).toHaveTextContent(/Saved/i);
    });

    it('allows entering readings', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        expect(screen.getByText(/pH Balance Input/i)).toBeInTheDocument();
        expect(screen.getByText(/Chlorine Level Input/i)).toBeInTheDocument();
    });

    it('renders a single Service Photos area containing Before Photos and After Photos', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        expect(screen.getByText('Service Photos')).toBeInTheDocument();
        expect(screen.getByText('Before Photos')).toBeInTheDocument();
        expect(screen.getByText('After Photos')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Service Type' })).not.toBeInTheDocument();
    });

    it('renders an actionable missing-client state when no customerId is provided', () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        // Heading invites the user to pick a client.
        expect(
            screen.getByRole('heading', { name: /choose a client first/i })
        ).toBeInTheDocument();

        // Users learn why they are stuck: a service log requires a client.
        expect(
            screen.getByText(/service log.*(needs|requires).*client/i)
        ).toBeInTheDocument();
    });

    it('does not render an indefinite loader-only state when no customerId is provided', () => {
        const { container } = render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        // An indefinite loader-only render provides no heading, no buttons,
        // and almost no copy. Asserting presence of actionable controls and a
        // meaningful body length rules out that regression.
        const actionableControls = container.querySelectorAll('button, a[href]');
        const headings = container.querySelectorAll('h1, h2, h3');
        const bodyText = (container.textContent || '').trim();

        expect(
            screen.queryByRole('heading', { name: /choose a client first/i })
        ).not.toBeNull();
        expect(headings.length).toBeGreaterThan(0);
        expect(actionableControls.length).toBeGreaterThan(0);
        expect(bodyText.length).toBeGreaterThan(40);
    });

    it('exposes a Go to Clients action that navigates to the Clients page', () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        const goToClients = screen.getByRole('button', { name: /go to clients/i });
        fireEvent.click(goToClients);

        expect(mockNavigate).toHaveBeenCalledWith('/page/Clients');
    });

    it('exposes a Back to Home action that navigates to the Home page', () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        const backToHome = screen.getByRole('button', { name: /back to home/i });
        fireEvent.click(backToHome);

        expect(mockNavigate).toHaveBeenCalledWith('/page/Home');
    });

    it('still renders the service log form when a valid customerId is provided', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        // With a valid customerId the missing-client state must NOT appear.
        expect(
            screen.queryByRole('heading', { name: /choose a client first/i })
        ).not.toBeInTheDocument();
        expect(screen.getByText(/Service Log/i)).toBeInTheDocument();
        expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });
});

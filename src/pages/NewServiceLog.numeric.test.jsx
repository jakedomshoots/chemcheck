import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NewServiceLog from './NewServiceLog';
import { BrowserRouter } from 'react-router-dom';

// Same shell mocks as NewServiceLog.test.jsx, but SimplifiedChemicalInput is
// NOT mocked: this suite guards the real parent/child state wiring.
const mockUser = { email: 'test@example.com' };
const mockCustomers = [{ _id: 1, full_name: 'Alice Smith', address: '123 St', pool_type: 'chlorine' }];
const mockCreateServiceLog = vi.fn();

vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => mockCustomers,
    useServiceLogsByCustomerDateRange: () => [],
    useServiceLogCreate: () => mockCreateServiceLog
}));

vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`,
    formatServiceDate: (date) => date,
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/hooks/useBusinessSettings', () => ({
    useBusinessSettings: () => ({
        proofOfServiceSettings: { requirePhotos: false, requireBeforePhotos: false, requireAfterPhotos: false },
        isLoading: false
    })
}));

vi.mock('@/components/proof-of-service', () => ({
    PhotoCaptureSection: ({ title }) => <div>{title}</div>
}));

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

vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, 'Test Page', '/?customerId=1');
});

describe('New Service Log numeric chemistry entry', () => {
    it('keeps the numeric value when the derived status differs from the current status', () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        const numericTabs = screen.getAllByRole('tab', { name: /^Numeric$/i });
        fireEvent.click(numericTabs[0]);

        // pH 8.4 is outside the ideal range, so the derived status ("high")
        // differs from the default "good" — the dual setFormData race must
        // not erase the typed value.
        const phInput = screen.getByTestId('ph-numeric-input');
        fireEvent.change(phInput, { target: { value: '8.4' } });

        expect(phInput).toHaveValue(8.4);
    });
});

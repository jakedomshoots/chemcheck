import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NewServiceLog from './NewServiceLog';
import { BrowserRouter } from 'react-router-dom';
import { validateServiceLog } from '@/lib/validation';

// Same shell mocks as NewServiceLog.test.jsx, but SimplifiedChemicalInput is
// NOT mocked: this suite guards the real parent/child state wiring.
const mockUser = { email: 'test@example.com' };
const mockCustomers = [{ _id: 1, full_name: 'Alice Smith', address: '123 St', pool_type: 'chlorine' }];
const mockCreateServiceLog = vi.fn();
const mockCreateChemicalUsage = vi.fn();
const mockActivePoolEquipment = {
    pool: null,
    pools: [],
    equipment: [],
    classification: { filter: null, filterKind: null, saltCell: null, heater: null, pump: null, other: [], hasAny: false },
};

vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomers: () => mockCustomers,
    useServiceLogsByCustomerDateRange: () => [],
    useServiceLogCreate: () => mockCreateServiceLog,
    useServiceLogsByCustomer: () => [],
    useChemicalUsageCreate: () => mockCreateChemicalUsage,
}));

vi.mock('@/api/equipmentHooks', async () => {
    const actual = await vi.importActual('@/api/equipmentHooks');
    return {
        ...actual,
        useActivePoolEquipment: () => mockActivePoolEquipment,
    };
});

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
    mockCreateServiceLog.mockReset();
    mockCreateServiceLog.mockResolvedValue(1);
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

    it('stamps lsi-v1 only when every required LSI input is measured', async () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        const numericTabs = screen.getAllByRole('tab', { name: /^Numeric$/i });
        fireEvent.click(numericTabs[0]);
        fireEvent.change(screen.getByTestId('ph-numeric-input'), { target: { value: '7.4' } });
        fireEvent.click(numericTabs[2]);
        fireEvent.change(screen.getByTestId('alkalinity-numeric-input'), { target: { value: '100' } });
        fireEvent.click(numericTabs[3]);
        fireEvent.change(screen.getByTestId('stabilizer-numeric-input'), { target: { value: '50' } });

        fireEvent.click(screen.getByRole('button', { name: /Enter LSI readings/i }));
        fireEvent.click(screen.getByText('Measured LSI', { exact: true }));
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Calcium hardness' }), { target: { value: '350' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Water temperature' }), { target: { value: '82' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Total dissolved solids' }), { target: { value: '900' } });
        fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

        await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
        expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({
            ph_value: 7.4,
            alkalinity_value: 100,
            stabilizer_value: 50,
            hardness_value: 350,
            hardness_source: 'calcium',
            water_temperature: 82,
            water_temperature_source: 'measured',
            tds_value: 900,
            tds_source: 'measured',
            lsi_calculation_version: 'lsi-v1',
        });
    });

    it('does not claim lsi-v1 for an incomplete measured entry', async () => {
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        fireEvent.click(screen.getByRole('button', { name: /Enter LSI readings/i }));
        fireEvent.click(screen.getByText('Measured LSI', { exact: true }));
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Calcium hardness' }), { target: { value: '350' } });
        fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

        await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
        expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({
            hardness_value: 350,
            hardness_source: 'calcium',
        });
        expect(mockCreateServiceLog.mock.calls[0][0].lsi_calculation_version).toBeUndefined();
    });

    it('saves normally when measured LSI is selected but no LSI readings are entered', async () => {
        mockCreateServiceLog.mockImplementationOnce(async (data) => {
            const validation = validateServiceLog(data);
            if (!validation.success) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }
            return 1;
        });

        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        fireEvent.click(screen.getByRole('button', { name: /Enter LSI readings/i }));
        fireEvent.click(screen.getByText('Measured LSI', { exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

        await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
        expect(screen.queryByText('Failed to save service log. Please try again.')).not.toBeInTheDocument();
        expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({
            hardness_value: undefined,
            hardness_source: undefined,
            lsi_calculation_version: undefined,
        });
    });
});

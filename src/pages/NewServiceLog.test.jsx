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
    useServiceLogCreate: () => mockCreateServiceLog
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock child components
vi.mock('../components/servicelog/SimplifiedChemicalInput', () => ({
    default: ({ label }) => <div>{label} Input</div>
}));

// Mock time tracker hook
vi.mock('@/hooks/useTimeTracker', () => ({
    useTimeTracker: () => ({
        state: { isTracking: false, startTime: null, endTime: null },
        startTracking: vi.fn(),
        stopTracking: vi.fn(),
        resetTracking: vi.fn(),
        getDurationDisplay: () => '0 min'
    })
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

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

describe('New Service Log Page', () => {
    it('renders the form', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);
        expect(screen.getByText(/Service Log/i)).toBeInTheDocument();
        expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });

    it('allows entering readings', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewServiceLog /></BrowserRouter>);

        expect(screen.getByText(/pH Balance Input/i)).toBeInTheDocument();
        expect(screen.getByText(/Chlorine Level Input/i)).toBeInTheDocument();
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import NewServiceLog from './NewServiceLog';

const mockCreateServiceLog = vi.fn();
let mockNavigate;
let mockLocation = {
  pathname: '/page/NewServiceLog',
  search: '?customerId=1',
  state: null,
};

const mockCustomers = [
  { _id: 1, full_name: 'Alice Smith', address: '123 St', pool_type: 'chlorine' },
  { _id: 2, full_name: 'Bob Jones', address: '456 St', pool_type: 'salt' },
];

vi.mock('@/api/convexHooks', () => ({
  useCurrentUser: () => ({ email: 'test@example.com' }),
  useCustomers: () => mockCustomers,
  useServiceLogCreate: () => mockCreateServiceLog,
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => ({ settings: { service_types: ['Regular Cleaning', 'Chemical Balance'] } })),
}));

vi.mock('@/utils', () => ({
  createPageUrl: (page) => `/page/${page}`,
}));

vi.mock('@/hooks/useBusinessSettings', () => ({
  useBusinessSettings: () => ({
    proofOfServiceSettings: {
      requirePhotos: false,
      require_before_photos: false,
      require_after_photos: false,
      min_photos_before: 0,
      min_photos_after: 0,
      beforePhotosRequiredForCompletion: false,
      afterPhotosRequiredForCompletion: false,
    },
    isLoading: false,
  }),
}));

vi.mock('@/components/proof-of-service', () => ({
  PhotoCaptureSection: ({ title }) => <div>{title}</div>,
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

vi.mock('@/lib/proof-of-service', () => ({
  deleteUnlinkedPhotos: vi.fn(),
  linkPhotosToServiceLog: vi.fn(),
  getPhotos: vi.fn(() => Promise.resolve([])),
  validateServiceCompletion: vi.fn(() => ({ isValid: true, errors: [] })),
  getValidationErrorMessage: () => '',
  hasAnyRequirements: vi.fn(() => true),
  getRequirementsSummary: vi.fn(() => ['Chemical readings', 'Service type']),
}));

vi.mock('@/components/servicelog/SimplifiedChemicalInput', () => ({
  default: ({ label }) => <div>{label}</div>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('New Service Log - flow polish', () => {
  beforeEach(() => {
    mockNavigate = vi.fn();
    mockCreateServiceLog.mockResolvedValue(101);
    mockLocation = {
      pathname: '/page/NewServiceLog',
      search: '?customerId=1',
      state: null,
    };
    window.history.replaceState({}, 'Test Page', '/page/NewServiceLog?customerId=1');
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, 'Test Page', '/');
    localStorage.clear();
  });

  it('shows route readiness strip with customer and field checklist', () => {
    render(
      <BrowserRouter>
        <NewServiceLog />
      </BrowserRouter>
    );

    expect(screen.getByTestId('service-log-readiness-strip')).toBeInTheDocument();
    expect(screen.getByText('Customer: Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Required for completion: Chemical readings, Service type')).toBeInTheDocument();
    expect(screen.getByText('Customer loaded')).toBeInTheDocument();
    expect(screen.getByText('Service type selected')).toBeInTheDocument();
  });

  it('stores a draft and shows draft saved time in readiness strip', () => {
    render(
      <BrowserRouter>
        <NewServiceLog />
      </BrowserRouter>
    );

    // localStorage draft persistence and strip indicator should appear shortly after mount.
    return waitFor(() => {
      expect(within(screen.getByTestId('service-log-readiness-strip')).getByText(/Draft saved at/i)).toBeInTheDocument();
      expect(localStorage.getItem('serviceLogDraft_1')).toBeTruthy();
    });
  });

  it('shows one clear next action after save and routes to next stop when continuing route', async () => {
    mockLocation = {
      pathname: '/page/NewServiceLog',
      search: '?customerId=1',
      state: {
        returnIntent: 'continue_route',
        routeOrderIds: [1, 2],
        routeDay: 'Monday',
        customer: mockCustomers[0],
      },
    };
    mockCreateServiceLog.mockResolvedValue(123);

    render(
      <BrowserRouter>
        <NewServiceLog />
      </BrowserRouter>
    );

    const saveButton = screen.getByRole('button', { name: /Complete Service/i });
    fireEvent.click(saveButton);

    const nextAction = await screen.findByTestId('service-log-next-action');
    expect(nextAction).toBeInTheDocument();
    expect(nextAction).toHaveTextContent('Continue to Bob Jones');

    fireEvent.click(nextAction);
    expect(mockNavigate).toHaveBeenCalledWith('/page/NewServiceLog?customerId=2', expect.any(Object));
  });
});

describe('New Service Log - validation summary', () => {
  it('shows required field summary whenever requirements exist', () => {
    render(
      <BrowserRouter>
        <NewServiceLog />
      </BrowserRouter>
    );

    expect(screen.getByTestId('service-log-validation-summary')).toBeInTheDocument();
  });
});

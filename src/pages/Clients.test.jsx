import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Clients from './Clients';
import { BrowserRouter } from 'react-router-dom';

const mockCustomers = [
  { _id: 1, full_name: 'Alice Smith', address: '123 Apple St', service_day: 'Monday', sort_order: 0 },
  { _id: 2, full_name: 'Bob Jones', address: '456 Banana Ave', service_day: 'Tuesday', sort_order: 0 },
];
const mockUpdateCustomer = vi.fn();
const mockDeleteCustomer = vi.fn();
const mockUser = { email: 'test@example.com' };
const mockBusinessSettings = { settings: { working_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] } };
let mockLocation = {
  pathname: '/clients',
  search: '?day=Monday',
};
let mockNavigate;

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
  useCurrentUser: () => mockUser,
  useCustomersFilter: () => mockCustomers,
  useCustomerUpdate: () => mockUpdateCustomer,
  useCustomerDelete: () => mockDeleteCustomer,
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => mockBusinessSettings),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

// Mock utils
vi.mock('@/utils', () => ({
  createPageUrl: (page) => `/page/${page}`,
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock child components
vi.mock('../components/clients/ClientListItem', () => ({
  default: ({ customer }) => <div>{customer.full_name}</div>,
}));

// Mock UI components that might be complex
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }) => <div>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
  TabsContent: ({ children }) => <div>{children}</div>,
}));

describe('Clients Page', () => {
  beforeEach(() => {
    mockNavigate = vi.fn();
    mockLocation = {
      pathname: '/clients',
      search: '?day=Monday',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders client list', () => {
    render(
      <BrowserRouter>
        <Clients />
      </BrowserRouter>
    );
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('renders quick start action from Home-driven day context and opens the next stop', () => {
    render(
      <BrowserRouter>
        <Clients />
      </BrowserRouter>
    );

    const quickAction = screen.getByRole('button', { name: /Open first due now|View today's order/i });
    expect(quickAction).toBeInTheDocument();

    fireEvent.click(quickAction);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/page/NewServiceLog?customerId=1',
      expect.objectContaining({
        state: expect.objectContaining({
          returnIntent: 'continue_route',
          routeDay: 'Monday',
          routeOrderIds: [1],
        }),
      }),
    );
  });

  it('shows empty-day recovery action when requested day has no customers', () => {
    mockLocation = {
      ...mockLocation,
      search: '?day=Wednesday',
    };

    render(
      <BrowserRouter>
        <Clients />
      </BrowserRouter>
    );

    expect(screen.getByText('No Clients for Wednesday')).toBeInTheDocument();
    expect(screen.getByText('Route has no customers yet. Continue directly to Route Plan to review today.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /View today's order/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('filters clients by search', () => {
    render(
      <BrowserRouter>
        <Clients />
      </BrowserRouter>
    );
    const searchInput = screen.getByPlaceholderText(/Search clients/i);

    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });
});

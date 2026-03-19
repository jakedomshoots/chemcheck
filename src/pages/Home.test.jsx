import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './Home';
import { renderWithProviders, screen, userEvent } from '@/test/testUtils';
import * as convexHooks from '@/api/convexHooks';

let mockNavigate;
let mockedDayOfWeek = 'Monday';

const mockDate = '2026-03-18';
const mockDisplayDate = 'Mar 18, 2026';

const makeLog = (customerId, date = mockDate) => ({
  id: `log-${customerId}`,
  _id: `log-${customerId}`,
  customer_id: customerId,
  service_date: date,
  status: 'completed',
  ph: 'good',
  chlorine: 'good',
  alkalinity: 'good',
  stabilizer: 'good',
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/api/convexHooks', () => ({
  useCustomersFilter: vi.fn(() => []),
  useServiceLogs: vi.fn(() => []),
  useServiceLogsFilter: vi.fn(() => []),
  useCustomers: vi.fn(() => []),
  useCurrentUser: vi.fn(() => ({ email: 'test@example.com' })),
  useAddServiceLog: vi.fn(() => vi.fn()),
  useUpdateServiceLog: vi.fn(() => vi.fn()),
  useDeleteServiceLog: vi.fn(() => vi.fn()),
  useAddCustomer: vi.fn(() => vi.fn()),
  useUpdateCustomer: vi.fn(() => vi.fn()),
  useDeleteCustomer: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils', () => ({
  createPageUrl: (page) => `/page/${page}`,
  parseLocalDate: (value) => new Date(value),
}));

vi.mock('@/components/home/CustomerCard', () => ({
  default: ({ customer, isCompleted, isNextInFlow }) => (
    <div data-testid={`customer-card-${customer.id}`}>
      <p>{customer.full_name}</p>
      <p>{isCompleted ? 'completed' : 'pending'}</p>
      <p>{isNextInFlow ? 'next' : 'queued'}</p>
    </div>
  ),
}));

vi.mock('@/components/home/QuickStats', () => ({
  default: () => <div data-testid="quick-stats" />,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('date-fns', async () => {
  const actual = await vi.importActual('date-fns');
  return {
    ...actual,
    format: (value, token) => {
      if (token === 'EEEE') return mockedDayOfWeek;
      if (token === 'MMM dd, yyyy') return mockDisplayDate;
      if (token === 'yyyy-MM-dd') return mockDate;
      return actual.format(value, token);
    },
  };
});

describe('Home Page - flow-first UX', () => {
  beforeEach(() => {
    mockNavigate = vi.fn();
    mockedDayOfWeek = 'Monday';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows one primary flow CTA and routes to next pending stop', async () => {
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([
      { _id: 1, id: 1, full_name: 'John Smith', service_day: mockedDayOfWeek, sort_order: 1, address: '123 Main St' },
      { _id: 2, id: 2, full_name: 'Jane Doe', service_day: mockedDayOfWeek, sort_order: 2, address: '456 Oak Ave' },
    ]);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([makeLog(1)]);

    const user = userEvent.setup();
    renderWithProviders(<Home />);

    const primaryActions = screen.getAllByTestId('home-primary-cta');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveTextContent('Start Next: Jane Doe');

    await user.click(primaryActions[0]);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/page/NewServiceLog?customerId=2'),
      expect.any(Object)
    );
  });

  it('shows weekend no-route guidance and route-plan intent', async () => {
    mockedDayOfWeek = 'Saturday';
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([]);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([]);

    const user = userEvent.setup();
    renderWithProviders(<Home />);

    expect(screen.getByText('Weekend operations')).toBeInTheDocument();
    expect(screen.getByText('No scheduled route today. Open Route Plan to jump to the next active day or add an exception stop.')).toBeInTheDocument();

    const primaryActions = screen.getAllByTestId('home-primary-cta');
    expect(primaryActions).toHaveLength(1);
    await user.click(primaryActions[0]);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/page/RouteOptimizer'));
  });

  it("shows missed-service state transition copy when today's route is complete", async () => {
    mockedDayOfWeek = 'Thursday';
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([
      { _id: 1, id: 1, full_name: 'Monday Client', service_day: 'Monday', sort_order: 1, address: '111 One' },
      { _id: 2, id: 2, full_name: 'Tuesday Client', service_day: 'Tuesday', sort_order: 2, address: '222 Two' },
      { _id: 3, id: 3, full_name: 'Thursday Client', service_day: mockedDayOfWeek, sort_order: 1, address: '333 Three' },
    ]);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([makeLog(3)]);

    const user = userEvent.setup();
    renderWithProviders(<Home />);

    expect(screen.getByText("Today's route is complete")).toBeInTheDocument();
    expect(screen.getByText('2 missed stops from this week remain. Open Route Plan to resume missed stops in order.')).toBeInTheDocument();

    const primaryActions = screen.getAllByTestId('home-primary-cta');
    expect(primaryActions).toHaveLength(1);

    await user.click(primaryActions[0]);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/page/RouteOptimizer?day=Thursday'));
  });

  it("shows explicit no-customer guidance text and add-client intent", async () => {
    mockedDayOfWeek = 'Tuesday';
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([]);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([]);

    const user = userEvent.setup();
    renderWithProviders(<Home />);

    const primaryActions = screen.getAllByTestId('home-primary-cta');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveTextContent('Add Client');
    expect(screen.getByText('You have no customers scheduled for Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Tip: add clients from Clients, then return here to start the route.')).toBeInTheDocument();

    await user.click(primaryActions[0]);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/page/Clients?day=Tuesday'
    );
  });

  it('shows clear done-routing guidance when all todays stops are completed', async () => {
    mockedDayOfWeek = 'Thursday';
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([
      { _id: 1, id: 1, full_name: 'Thursday Client', service_day: mockedDayOfWeek, sort_order: 1, address: '333 Three' },
    ]);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([makeLog(1)]);

    const user = userEvent.setup();
    renderWithProviders(<Home />);

    expect(screen.getByText("Today's route is complete")).toBeInTheDocument();
    expect(screen.getByText(/up to date for today/i)).toBeInTheDocument();
    expect(screen.getByText(/Open Route Plan to review tomorrow's sequence/i)).toBeInTheDocument();

    const primaryActions = screen.getAllByTestId('home-primary-cta');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveTextContent('Open Route Plan');

    await user.click(primaryActions[0]);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/page/RouteOptimizer?day=Thursday'));
  });
});

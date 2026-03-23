import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format } from 'date-fns';
import Home from './Home';
import { 
  renderWithProviders, 
  screen, 
  userEvent,
  mockCustomers,
  mockServiceLogs,
  performanceTest,
  a11yTest,
  errorTest,
  dbTest
} from '@/test/testUtils';
import * as convexHooks from '@/api/convexHooks';

// Mock hooks - must be defined inline due to vi.mock hoisting
vi.mock('@/api/convexHooks', () => ({
  useCustomersFilter: vi.fn(() => []),
  useServiceLogs: vi.fn(() => []),
  useCustomers: vi.fn(() => []),
  useCurrentUser: vi.fn(() => ({ id: 'user-1', name: 'Test User' })),
  useAddServiceLog: vi.fn(() => vi.fn()),
  useUpdateServiceLog: vi.fn(() => vi.fn()),
  useDeleteServiceLog: vi.fn(() => vi.fn()),
  useAddCustomer: vi.fn(() => vi.fn()),
  useUpdateCustomer: vi.fn(() => vi.fn()),
  useDeleteCustomer: vi.fn(() => vi.fn()),
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => ({ settings: { working_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] } })),
}));

// Enhanced mock data for comprehensive testing - defined after mocks
const getTodayCustomers = () => [
  {
    ...mockCustomers[0],
    service_day: format(new Date(), 'EEEE'),
    sort_order: 1
  },
  {
    ...mockCustomers[1], 
    service_day: format(new Date(), 'EEEE'),
    sort_order: 2
  }
];

const getCompletedServiceLog = (todayCustomers) => ({
  ...mockServiceLogs[0],
  customer_id: todayCustomers[0].id,
  service_date: format(new Date(), 'yyyy-MM-dd'),
  status: 'completed'
});

// Mock utils
vi.mock('@/utils', () => ({
  createPageUrl: (page) => `/page/${page}`,
  getTodayDate: () => format(new Date(), 'yyyy-MM-dd')
}));

// Mock child components with better testing support
vi.mock('../components/home/CustomerCard', () => ({
  default: ({ customer, isCompleted, onStart }) => (
    <div data-testid={`customer-card-${customer.id}`} role="article">
      <h3>{customer.full_name}</h3>
      <p>{customer.address}</p>
      <span data-testid="service-status">
        {isCompleted ? 'Completed' : 'Not Serviced'}
      </span>
      {!isCompleted && (
        <button 
          onClick={() => onStart?.(customer)}
          data-testid="complete-service-btn"
          tabIndex={0}
        >
          Complete Service
        </button>
      )}
    </div>
  )
}));

vi.mock('../components/home/QuickStats', () => ({
  default: ({ total, completed }) => (
    <div data-testid="quick-stats" role="region" aria-label="Quick Statistics">
      <div>Total Customers: {total || 0}</div>
      <div>Completed Today: {completed || 0}</div>
    </div>
  )
}));

// Mock UI components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }) => <div className={className} role="region">{children}</div>
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, variant, ...props }) => (
    <button onClick={onClick} data-variant={variant} tabIndex={0} {...props}>
      {children}
    </button>
  )
}));

describe('Home Page - Comprehensive Tests', () => {
  let todayCustomers;
  let completedServiceLog;

  beforeEach(async () => {
    await dbTest.clearTestData();
    await dbTest.seedTestData();
    
    // Set up test data
    todayCustomers = getTodayCustomers();
    completedServiceLog = getCompletedServiceLog(todayCustomers);
    
    // Configure mocks with test data
    vi.mocked(convexHooks.useCustomersFilter).mockReturnValue(todayCustomers);
    vi.mocked(convexHooks.useServiceLogs).mockReturnValue([completedServiceLog]);
    vi.mocked(convexHooks.useCustomers).mockReturnValue(todayCustomers);
    vi.mocked(convexHooks.useCurrentUser).mockReturnValue({ id: 'user-1', email: 'test@example.com', name: 'Test User' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders today\'s route title with correct date', () => {
      renderWithProviders(<Home />);
      expect(screen.getByText(/Today's Route/i)).toBeInTheDocument();
      expect(screen.getByText(format(new Date(), 'EEEE, MMM dd, yyyy'))).toBeInTheDocument();
    });

    it('displays customers scheduled for today', () => {
      renderWithProviders(<Home />);
      expect(screen.getByText('John Smith')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    it('shows quick statistics', () => {
      renderWithProviders(<Home />);
      const stats = screen.getByTestId('quick-stats');
      expect(stats).toBeInTheDocument();
      expect(screen.getByText('Total Customers: 2')).toBeInTheDocument();
    });

    it('uses service-only timing in daily ops brief', () => {
      renderWithProviders(<Home />);
      expect(screen.getByText('2 stops · 30 min')).toBeInTheDocument();
    });
  });

  describe('Service Status Logic', () => {
    it('shows correct service status for completed customers', () => {
      renderWithProviders(<Home />);
      const statusElements = screen.getAllByTestId('service-status');
      
      // First customer should be completed (has service log)
      expect(statusElements[0]).toHaveTextContent('Completed');
      // Second customer should not be serviced
      expect(statusElements[1]).toHaveTextContent('Not Serviced');
    });

    it('displays complete service button for unserviced customers', () => {
      renderWithProviders(<Home />);
      const completeButtons = screen.getAllByTestId('complete-service-btn');
      
      // Should only show button for unserviced customers
      expect(completeButtons).toHaveLength(1);
    });

    it('handles service completion interaction', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Home />);
      
      const completeButton = screen.getByTestId('complete-service-btn');
      await user.click(completeButton);
      
      // Should trigger service completion flow
      // (In real implementation, this would open a service log form)
    });
  });

  describe('Performance Tests', () => {
    it('renders quickly with multiple customers', async () => {
      const { duration } = await performanceTest.measureRenderTime(() => 
        renderWithProviders(<Home />)
      );
      
      performanceTest.expectFastRender(duration, 200); // 200ms max for home page
    });

    it('handles large customer lists efficiently', async () => {
      // Mock a large customer list
      const largeCustomerList = Array.from({ length: 100 }, (_, i) => ({
        ...mockCustomers[0],
        id: i + 1,
        _id: i + 1,
        full_name: `Customer ${i + 1}`,
        service_day: format(new Date(), 'EEEE')
      }));

      vi.mocked(convexHooks.useCustomersFilter).mockReturnValue(largeCustomerList);

      const { duration } = await performanceTest.measureRenderTime(() => 
        renderWithProviders(<Home />)
      );
      
      performanceTest.expectFastRender(duration, 500); // 500ms max for large lists
    });
  });

  describe('Accessibility Tests', () => {
    it('has proper ARIA labels and roles', () => {
      renderWithProviders(<Home />);
      
      const stats = screen.getByTestId('quick-stats');
      a11yTest.expectAriaLabel(stats, 'Quick Statistics');
      
      const customerCards = screen.getAllByRole('article');
      expect(customerCards).toHaveLength(2);
    });

    it('supports keyboard navigation', () => {
      renderWithProviders(<Home />);
      
      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        a11yTest.expectKeyboardNavigation(button);
      });
    });

    it('uses semantic HTML structure', () => {
      const { container } = renderWithProviders(<Home />);
      
      a11yTest.expectSemanticHTML(container, 'main');
      a11yTest.expectSemanticHTML(container, 'section');
    });
  });

  describe('Error Handling', () => {
    it('handles missing customer data gracefully', () => {
      vi.mocked(convexHooks.useCustomersFilter).mockReturnValue([]);
      
      renderWithProviders(<Home />);
      
      expect(screen.getByRole('heading', { name: /No Customers Scheduled/i })).toBeInTheDocument();
    });

    it('handles API errors gracefully', () => {
      vi.mocked(convexHooks.useCustomersFilter).mockImplementation(() => {
        throw new Error('API Error');
      });

      const { container } = errorTest.expectErrorBoundary(() => 
        renderWithProviders(<Home />)
      );

      // Should show error boundary
      expect(container).toBeInTheDocument();
    });

    it('handles malformed customer data', () => {
      const malformedCustomers = [
        { id: 1, full_name: null, address: undefined },
        { id: 2, service_day: 'InvalidDay' }
      ];

      vi.mocked(convexHooks.useCustomersFilter).mockReturnValue(malformedCustomers);

      renderWithProviders(<Home />);
      
      // Should not crash and show appropriate fallbacks
      expect(screen.getByText(/Today's Route/i)).toBeInTheDocument();
    });
  });

  describe('Data Integration', () => {
    it('correctly filters customers by today\'s service day', () => {
      renderWithProviders(<Home />);
      
      // Home fetches all owned customers, then filters for today in-memory
      expect(convexHooks.useCustomersFilter).toHaveBeenCalledWith({
        created_by: 'test@example.com'
      });
    });

    it('correctly matches service logs to customers', () => {
      renderWithProviders(<Home />);
      
      expect(convexHooks.useServiceLogs).toHaveBeenCalledWith('-service_date', 100);
    });

    it('sorts customers by sort_order', () => {
      const unsortedCustomers = [
        { ...getTodayCustomers()[1], sort_order: 1 },
        { ...getTodayCustomers()[0], sort_order: 2 }
      ];

      vi.mocked(convexHooks.useCustomersFilter).mockReturnValue(unsortedCustomers);

      renderWithProviders(<Home />);
      
      const customerCards = screen.getAllByTestId(/customer-card-/);
      // First card should be the one with sort_order: 1
      expect(customerCards[0]).toHaveAttribute('data-testid', 'customer-card-2');
    });
  });

  describe('User Interactions', () => {
    it('navigates to customer detail when card is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Home />);
      
      const customerCard = screen.getByTestId('customer-card-1');
      await user.click(customerCard);
      
      // Should navigate to customer detail page
      // (Implementation would depend on actual navigation logic)
    });

    it('opens service log form when complete service is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Home />);
      
      const completeButton = screen.getByTestId('complete-service-btn');
      await user.click(completeButton);
      
      // Should open service log creation form
      // (Implementation would depend on actual form logic)
    });
  });

  describe('Responsive Design', () => {
    it('adapts layout for mobile screens', () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      renderWithProviders(<Home />);
      
      // Should render mobile-friendly layout
      expect(screen.getByText(/Today's Route/i)).toBeInTheDocument();
    });

    it('shows desktop layout for larger screens', () => {
      // Mock desktop viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      renderWithProviders(<Home />);
      
      // Should render desktop layout
      expect(screen.getByText(/Today's Route/i)).toBeInTheDocument();
    });
  });
});

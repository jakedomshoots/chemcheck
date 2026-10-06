import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BrowserRouter } from 'react-router-dom';
import { format } from 'date-fns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

// ============================================
// Realistic mocked data for the three field pages
// ============================================

// A fixed mid-week date (Wednesday) so Home shows today's stops and a stop
// missed earlier in the week, regardless of when the suite runs.
const FIXED_WEEKDAY_DATE = new Date('2026-06-10T12:00:00.000-04:00');
const todayName = format(FIXED_WEEKDAY_DATE, 'EEEE');
const todayDate = format(FIXED_WEEKDAY_DATE, 'yyyy-MM-dd');
const yesterdayName = 'Monday';

const routeCustomers = [
  {
    _id: 1,
    full_name: 'Cypress Landing HOA',
    address: '144 Cypress Landing Way, Tampa, FL',
    phone: '(813) 555-0101',
    email: 'hoa@cypress.example',
    service_day: todayName,
    sort_order: 0,
    pool_type: 'Salt',
    pool_gallons: 16500,
    gate_code: '8832',
  },
  {
    _id: 2,
    full_name: 'Blue Heron Residence',
    address: '707 Blue Heron Blvd, Tampa, FL',
    phone: '(813) 555-0102',
    service_day: todayName,
    sort_order: 1,
    pool_type: 'Chlorine',
    pool_gallons: 12000,
  },
  {
    _id: 3,
    full_name: 'Marina Vista Condos',
    address: '12 Marina Vista Dr, Tampa, FL',
    service_day: todayName,
    sort_order: 2,
  },
  {
    _id: 4,
    full_name: 'Missed Yesterday Pool',
    address: '9 Yesterday Ln, Tampa, FL',
    service_day: yesterdayName,
    sort_order: 0,
  },
];

const routeLogs = [
  {
    _id: 'log-1',
    customer_id: 1,
    service_date: todayDate,
    ph: 'good',
    chlorine: 'good',
    alkalinity: 'good',
    stabilizer: 'good',
    has_before_photos: true,
    has_after_photos: true,
    notes: 'Brushed tile line.',
    start_time: `${todayDate}T13:00:00.000Z`,
    end_time: `${todayDate}T13:25:00.000Z`,
    duration_ms: 25 * 60 * 1000,
  },
];

let mockCustomers = routeCustomers;
let mockLogs = routeLogs;

// Stable mutation mocks: Clients keys an effect on these, so a fresh vi.fn()
// per render would re-run it forever.
const { updateCustomerMock, deleteCustomerMock } = vi.hoisted(() => ({
  updateCustomerMock: vi.fn(async () => undefined),
  deleteCustomerMock: vi.fn(async () => undefined),
}));

vi.mock('@/api/convexHooks', () => {
  const activePoolCustomerIds = { has: () => true };
  return {
    useActivePoolCustomerIds: () => activePoolCustomerIds,
    useCurrentUser: () => ({ id: 'user-1', email: 'tech@example.com', name: 'Field Tech', preferences: {} }),
    useCustomersFilter: () => mockCustomers,
    useCustomers: () => mockCustomers,
    useServiceLogs: () => mockLogs,
    useNotes: () => [],
    useChemicalUsage: () => [],
    useCustomerUpdate: () => updateCustomerMock,
    useCustomerDelete: () => deleteCustomerMock,
  };
});

// One stable business record: pages derive memoized schedules from it, and a
// new object per render would re-run those effects endlessly.
const { businessRecord } = vi.hoisted(() => ({
  businessRecord: {
    address: '100 Business Ave, Tampa, FL',
    settings: {
      working_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      working_hours_start: '08:00',
      working_hours_end: '17:00',
      route_optimization: true,
    },
  },
}));

vi.mock('convex/react', () => ({
  useQuery: () => businessRecord,
}));

vi.mock('@/lib/routeOptimizer', () => ({
  routeOptimizer: {
    geocodeAddress: vi.fn(async () => ({ latitude: 27.95, longitude: -82.46, address: '100 Business Ave' })),
    optimizeRoute: vi.fn(async (customers) => ({
      stops: customers.map((customer, index) => ({
        customer: { id: customer._id, name: customer.full_name, address: customer.address, location: null },
        travelTime: index === 0 ? 6 : 9,
        distance: index === 0 ? 2 : 4,
      })),
      totalTime: 60,
      routing: { remote: 0, fallback: 1 },
      warnings: [],
    })),
  },
}));

vi.mock('@/lib/native/location', () => ({
  startDriveTimeCapture: () => () => undefined,
  getObservedDriveProfile: () => new Map(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  useUser: () => ({ user: null }),
  ClerkProvider: ({ children }) => children,
  SignIn: () => <div>Sign In</div>,
  SignUp: () => <div>Sign Up</div>,
}));

import Home from '@/pages/Home';
import RouteOptimizer from '@/pages/RouteOptimizer';
import Clients from '@/pages/Clients';

// Simple test components for accessibility
const TestButton = () => (
  <button type="button" aria-label="Test action">
    Click me
  </button>
);

const TestForm = () => (
  <form aria-label="Test form">
    <label htmlFor="name">Name</label>
    <input id="name" type="text" name="name" />
    <button type="submit">Submit</button>
  </form>
);

const TestNavigation = () => (
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/clients">Clients</a></li>
      <li><a href="/history">History</a></li>
    </ul>
  </nav>
);

const TestCard = () => (
  <article aria-labelledby="card-title">
    <h2 id="card-title">Customer Card</h2>
    <p>Customer information goes here</p>
    <button type="button">View Details</button>
  </article>
);

function renderPage(ui) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ============================================
// Contrast helpers (OKLCH -> relative luminance)
// ============================================

function oklchToLinearRgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function readThemeTokens() {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const blocks = { light: css.match(/:root\s*\{([\s\S]*?)\n {2}\}/)[1], dark: css.match(/\.dark\s*\{([\s\S]*?)\n {2}\}/)[1] };
  const parse = (block, name) => {
    const match = block.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
    if (!match) throw new Error(`Token --${name} is not a literal oklch() value`);
    return oklchToLinearRgb(Number(match[1]), Number(match[2]), Number(match[3]));
  };
  return {
    light: { inkSecondary: parse(blocks.light, 'ink-secondary'), inkMuted: parse(blocks.light, 'ink-muted'), surface1: parse(blocks.light, 'surface-1') },
    dark: { inkSecondary: parse(blocks.dark, 'ink-secondary'), inkMuted: parse(blocks.dark, 'ink-muted'), surface1: parse(blocks.dark, 'surface-1') },
  };
}

describe('Accessibility Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_WEEKDAY_DATE });
    // jsdom has no layout: Clients centres the active day tab with scrollIntoView.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
    mockCustomers = routeCustomers;
    mockLogs = routeLogs;
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Radix tabs activate on pointer down, not click. */
  function selectDayTab(dayName) {
    const tab = screen.getByRole('tab', { name: new RegExp(`^${dayName},`) });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
  }

  describe('Basic Components', () => {
    it('button should have no accessibility violations', async () => {
      const { container } = render(<TestButton />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('form should have no accessibility violations', async () => {
      const { container } = render(<TestForm />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('navigation should have no accessibility violations', async () => {
      const { container } = render(
        <BrowserRouter>
          <TestNavigation />
        </BrowserRouter>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('card component should have no accessibility violations', async () => {
      const { container } = render(<TestCard />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Field pages (realistic data)', () => {
    it('Home has no axe violations with a mixed done / pending / missed route', async () => {
      const { container } = renderPage(<Home />);
      await screen.findByTestId('today-glance');
      expect(screen.getByText('1 Missed')).toBeInTheDocument();

      // Expand a stop so the details panel (call / map / skip actions) is audited too.
      fireEvent.click(screen.getByRole('button', { name: /Expand details for Blue Heron Residence/ }));

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Home exposes list semantics, live status and non-color stop state', async () => {
      renderPage(<Home />);
      await screen.findByTestId('today-glance');

      const stopList = within(screen.getByRole('region', { name: "Today's customers" })).getByRole('list');
      expect(within(stopList).getAllByRole('listitem')).toHaveLength(3);
      expect(screen.getByRole('list', { name: 'Missed services' })).toBeInTheDocument();

      expect(screen.getByRole('status', { name: '' })).toBeTruthy();
      expect(screen.getByRole('progressbar', { name: 'Stops logged' })).toHaveAttribute('aria-valuenow', '1');

      // Status is text + icon, never color alone.
      expect(screen.getByLabelText('Service status: Done')).toHaveTextContent('Done');
      expect(screen.getByTestId('status-icon-done')).toBeInTheDocument();
      expect(screen.getAllByTestId('status-icon-pending')).toHaveLength(2);

      // Every interactive element has a name.
      for (const button of screen.getAllByRole('button')) {
        expect(button).toHaveAccessibleName();
      }
    });

    it('RouteOptimizer has no axe violations before and after generating a plan', async () => {
      const { container } = renderPage(<RouteOptimizer />);
      const generate = await screen.findByRole('button', { name: 'Generate Route Plan' });
      await waitFor(() => expect(generate).toBeEnabled());
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(generate);
      await screen.findByTestId('optimized-stop-list');
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: 'Start Route' }));
      expect(screen.getByRole('heading', { name: 'Route in Progress' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      for (const button of screen.getAllByRole('button')) {
        expect(button).toHaveAccessibleName();
      }
      expect(screen.getByRole('progressbar', { name: 'Route progress' })).toHaveAttribute('aria-valuetext', 'Stop 1 of 3');
    });

    it('Clients has no axe violations in schedule and directory views', async () => {
      const { container } = renderPage(<Clients />);
      await screen.findByTestId('service-day-tabs');
      expect(await axe(container)).toHaveNoViolations();

      selectDayTab(todayName);
      await screen.findByText('Cypress Landing HOA');
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: /Expand details for Cypress Landing HOA/ }));
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(screen.getByRole('tab', { name: 'Directory' }));
      await screen.findByTestId('client-directory');
      expect(await axe(container)).toHaveNoViolations();

      for (const button of screen.getAllByRole('button')) {
        expect(button).toHaveAccessibleName();
      }
    });

    it('Clients delete dialog is a focus-trapping alertdialog that restores focus', async () => {
      renderPage(<Clients />);
      await screen.findByTestId('service-day-tabs');
      selectDayTab(todayName);
      await screen.findByText('Cypress Landing HOA');
      fireEvent.click(screen.getByRole('button', { name: /Expand details for Cypress Landing HOA/ }));

      const deleteButton = screen.getByRole('button', { name: 'Delete Cypress Landing HOA' });
      deleteButton.focus();
      fireEvent.click(deleteButton);

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveAccessibleName('Delete Client?');
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      expect(await axe(document.body)).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      await waitFor(() => expect(deleteButton).toHaveFocus());
    });
  });

  describe('Color Contrast', () => {
    it('text should have sufficient color contrast', async () => {
      const { container } = render(
        <div style={{ backgroundColor: '#ffffff', color: '#333333' }}>
          <h1>High Contrast Heading</h1>
          <p>This text should have good contrast</p>
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('--ink-secondary on --surface-1 meets 4.5:1 in both themes', () => {
      const tokens = readThemeTokens();
      expect(contrastRatio(tokens.light.inkSecondary, tokens.light.surface1)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.dark.inkSecondary, tokens.dark.surface1)).toBeGreaterThanOrEqual(4.5);
    });

    it('--ink-muted on --surface-1 meets 4.5:1 in both themes', () => {
      const tokens = readThemeTokens();
      expect(contrastRatio(tokens.light.inkMuted, tokens.light.surface1)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.dark.inkMuted, tokens.dark.surface1)).toBeGreaterThanOrEqual(4.5);
    });

    it('defines a global keyboard focus ring', () => {
      const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
      expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    });
  });

  describe('Interactive Elements', () => {
    it('links should be accessible', async () => {
      const { container } = render(
        <BrowserRouter>
          <a href="/test">Test Link</a>
        </BrowserRouter>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('inputs should have labels', async () => {
      const { container } = render(
        <div>
          <label htmlFor="email">Email Address</label>
          <input id="email" type="email" name="email" />
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Semantic Structure', () => {
    it('page should have proper heading hierarchy', async () => {
      const { container } = render(
        <main>
          <h1>Main Title</h1>
          <section>
            <h2>Section Title</h2>
            <p>Content here</p>
          </section>
        </main>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('lists should be properly structured', async () => {
      const { container } = render(
        <ul aria-label="Customer list">
          <li>Customer 1</li>
          <li>Customer 2</li>
          <li>Customer 3</li>
        </ul>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});

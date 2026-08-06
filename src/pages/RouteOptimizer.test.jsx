import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import { BrowserRouter } from "react-router-dom";
import RouteOptimizer from "./RouteOptimizer";

const navigateMock = vi.fn();
const optimizeRouteMock = vi.fn();
const geocodeAddressMock = vi.fn();
const toastInfoMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

let mockCustomers = [];
let mockBusiness;

vi.mock("@/api/convexHooks", () => ({
  useCurrentUser: () => ({ email: "tech@example.com" }),
  useCustomersFilter: () => mockCustomers,
  useServiceLogs: () => [],
}));

vi.mock("convex/react", () => ({
  useQuery: () => mockBusiness,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/utils", () => ({
  createPageUrl: (page) => `/${page.toLowerCase()}`,
}));

vi.mock("@/lib/routeOptimizer", () => ({
  routeOptimizer: {
    optimizeRoute: (...args) => optimizeRouteMock(...args),
    geocodeAddress: (...args) => geocodeAddressMock(...args),
  },
}));

vi.mock("@/lib/mapNavigation", () => ({
  openNavigation: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: (...args) => toastInfoMock(...args),
    error: (...args) => toastErrorMock(...args),
    success: (...args) => toastSuccessMock(...args),
  },
}));

const todayName = format(new Date(), "EEEE");
const otherDay = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  .find((day) => day !== todayName);

function renderPlanner() {
  return render(
    <BrowserRouter>
      <RouteOptimizer />
    </BrowserRouter>
  );
}

function buildRoute(customers, overrides = {}) {
  return {
    stops: customers.map((customer, index) => ({
      customer: {
        id: customer.id ?? customer._id,
        name: customer.full_name,
        address: customer.address,
        location: customer.location,
      },
      travelTime: index === 0 ? 0 : 8,
      distance: index === 0 ? 0 : 3,
    })),
    totalTime: 95,
    routing: { remote: 0, fallback: 1 },
    warnings: [],
    ...overrides,
  };
}

describe("Route Planner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomers = [];
    mockBusiness = {
      address: "",
      settings: {
        route_optimization: true,
        working_days: [todayName],
        working_hours_start: "08:00",
        working_hours_end: "17:00",
      },
    };
    optimizeRouteMock.mockImplementation(async (customers) => buildRoute(customers));
    geocodeAddressMock.mockResolvedValue({
      latitude: 34.05,
      longitude: -118.24,
      address: "100 Business Ave",
    });
  });

  it("turns the empty state into an add-customer recovery path for the selected day", async () => {
    const user = userEvent.setup();
    renderPlanner();

    await user.click(await screen.findByRole("button", { name: "Add First Customer" }));

    expect(navigateMock).toHaveBeenCalledWith("/newclient", {
      state: { serviceDay: todayName, source: "route_planner" },
    });
  });

  it("keeps a scheduled off-day available even when it is outside configured working days", async () => {
    mockCustomers = [
      { _id: "weekend-stop", full_name: "Weekend Pool", address: "10 Lake Rd", service_day: otherDay },
    ];
    renderPlanner();

    expect(await screen.findByRole("button", { name: `Plan ${otherDay}` })).toBeInTheDocument();
  });

  it("uses service-only timing and completes a one-stop route cleanly", async () => {
    const user = userEvent.setup();
    mockCustomers = [
      {
        _id: "convex-stop-1",
        full_name: "Bluebird Pool",
        address: "20 Bluebird Ln",
        service_day: todayName,
        estimatedDuration: 20,
      },
    ];
    renderPlanner();

    const generateButton = await screen.findByRole("button", { name: "Generate Route Plan" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    await user.click(generateButton);

    const summary = await screen.findByTestId("route-summary-metrics");
    expect(within(summary).getByText("20 min")).toBeInTheDocument();
    expect(within(summary).queryByText("1h 35m")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(screen.getByRole("heading", { name: "Route in Progress" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark Complete" }));

    expect(screen.getByText("Route complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Route Again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Route in Progress" })).not.toBeInTheDocument();
  });

  it("renders optimized stops as one compact route manifest", async () => {
    const user = userEvent.setup();
    mockCustomers = [
      {
        _id: "manifest-stop-1",
        full_name: "Cypress Landing",
        address: "144 Cypress Landing Way",
        service_day: todayName,
        pool_type: "Salt",
        pool_gallons: 16500,
        gate_code: "8832",
      },
      {
        _id: "manifest-stop-2",
        full_name: "Blue Heron",
        address: "707 Blue Heron Boulevard",
        service_day: todayName,
      },
    ];
    renderPlanner();

    const generateButton = await screen.findByRole("button", { name: "Generate Route Plan" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    await user.click(generateButton);

    const list = await screen.findByTestId("optimized-stop-list");
    expect(list).toHaveClass("divide-y", "border-y");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByLabelText("Stop 1")).toHaveTextContent("01");
    expect(within(list).getAllByRole("button", { name: "Navigate" })).toHaveLength(2);

    const firstStop = within(list).getByTestId("optimized-stop-1");
    expect(firstStop).not.toHaveClass("rounded-raised", "shadow-card");
    expect(within(firstStop).getByText("Salt")).toBeInTheDocument();
    expect(within(firstStop).getByText("16,500 gal")).toBeInTheDocument();
    expect(within(firstStop).getByText("Gate code: 8832")).toBeInTheDocument();
  });

  it("shows a persistent retry action when generation fails", async () => {
    const user = userEvent.setup();
    mockCustomers = [
      { _id: 7, full_name: "Retry Pool", address: "70 Retry Rd", service_day: todayName },
    ];
    optimizeRouteMock.mockRejectedValueOnce(new Error("offline"));
    renderPlanner();

    const generateButton = await screen.findByRole("button", { name: "Generate Route Plan" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    await user.click(generateButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t build the route plan");
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("surfaces missing addresses and prevents a broken navigation action", async () => {
    const user = userEvent.setup();
    mockCustomers = [
      { _id: 8, full_name: "Addressless Pool", address: "", service_day: todayName },
    ];
    renderPlanner();

    const readiness = await screen.findByTestId("route-readiness");
    expect(within(readiness).getByText("0/1")).toBeInTheDocument();

    const generateButton = screen.getByRole("button", { name: "Generate Route Plan" });
    await user.click(generateButton);

    const addressButton = await screen.findByRole("button", { name: "Address Needed" });
    expect(addressButton).toBeDisabled();
    expect(screen.getByText(/1 stop has no service address/i)).toBeInTheDocument();
  });
});

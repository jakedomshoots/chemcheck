import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { format } from "date-fns";
import Home from "./Home";
import { BrowserRouter } from "react-router-dom";

const navigateMock = vi.fn();
const trackUxEventMock = vi.fn();

const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const todayName = format(new Date(), "EEEE");
const alternateDay = weekDays.find((day) => day !== todayName) || "Tuesday";

const customers = [
  { _id: 101, full_name: "Today Client", address: "1 Today Ln", service_day: todayName, sort_order: 0 },
  { _id: 202, full_name: "Done Offday", address: "2 Done St", service_day: alternateDay, sort_order: 0 },
  { _id: 303, full_name: "Pending Offday", address: "3 Pending St", service_day: alternateDay, sort_order: 1 },
];

const todayDate = format(new Date(), "yyyy-MM-dd");
const logs = [
  { _id: "log-1", customer_id: 202, service_date: todayDate },
];

vi.mock("@/api/convexHooks", () => ({
  useCurrentUser: () => ({ email: "tester@example.com", preferences: {} }),
  useCustomersFilter: () => customers,
  useServiceLogs: () => logs,
}));

vi.mock("convex/react", () => ({
  useQuery: () => ({ settings: { working_days: [todayName, alternateDay] } }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/utils", async () => {
  const actual = await vi.importActual("@/utils");
  return {
    ...actual,
    createPageUrl: (page) => `/${page.toLowerCase()}`,
  };
});

vi.mock("@/lib/uxAnalytics", () => ({
  trackUxEvent: (...args) => trackUxEventMock(...args),
}));

vi.mock("../components/home/CustomerCard", () => ({
  default: ({ customer }) => <div>{customer.full_name}</div>,
}));

vi.mock("../components/home/QuickStats", () => ({
  default: () => <div>QuickStats</div>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  CustomerCardSkeleton: () => <div>CustomerSkeleton</div>,
  QuickStatsSkeleton: () => <div>QuickStatsSkeleton</div>,
}));

vi.mock("@/components/home/OffDayServicePickerDialog", () => ({
  default: ({ open, availableDays, clients, onStartClient }) => (
    <div data-testid="off-day-picker" data-open={open ? "open" : "closed"}>
      <div data-testid="available-days">{availableDays.join(",")}</div>
      <div data-testid="off-day-clients">{clients.map((c) => c.full_name).join(",")}</div>
      <button onClick={() => onStartClient(clients[0])} disabled={clients.length === 0}>
        start-first-client
      </button>
    </div>
  ),
}));

describe("Home off-day flow", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    trackUxEventMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("opens off-day picker, excludes today, hides serviced clients, and navigates with pending client", () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Service Another Day/i }));

    expect(screen.getByTestId("off-day-picker")).toHaveAttribute("data-open", "open");
    expect(screen.getByTestId("available-days").textContent).toBe(alternateDay);
    expect(screen.getByTestId("off-day-clients").textContent).toBe("Pending Offday");
    expect(screen.queryByText("Done Offday")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "start-first-client" }));

    expect(navigateMock).toHaveBeenCalledWith(`/newservicelog?customerId=303`, {
      state: expect.objectContaining({
        customer: expect.objectContaining({ _id: 303, full_name: "Pending Offday" }),
        serviceFlow: expect.objectContaining({
          source: "home_off_day_picker",
          selectedDay: alternateDay,
          returnPolicy: "reset_to_today",
        }),
      }),
    });
  });
});

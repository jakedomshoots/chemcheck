import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import Work from "./Work";

expect.extend(toHaveNoViolations);

const mocks = vi.hoisted(() => ({
  fns: {},
  queries: {},
  queryArgs: {},
  connection: { isWebSocketConnected: true, hasEverConnected: true },
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  const fn = (ref) => {
    const name = getFunctionName(ref);
    if (!mocks.fns[name]) mocks.fns[name] = vi.fn(async () => ({}));
    return mocks.fns[name];
  };
  return {
    useQuery: (ref, args) => {
      const name = getFunctionName(ref);
      if (args === "skip") return undefined;
      mocks.queryArgs[name] = args;
      const value = mocks.queries[name];
      return typeof value === "function" ? value(args) : value;
    },
    useMutation: fn,
    useAction: fn,
    useConvexConnectionState: () => mocks.connection,
  };
});

vi.mock("@/api/dexieHooks", () => ({ useCustomers: () => [] }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const SUMMARY = {
  outstanding: 785,
  open_requests: 2,
  paid_this_week: 405,
  recurring_active: 3,
  recurring_next_total: 400,
  recurring_next_run_at: Date.UTC(2026, 9, 1, 12),
  square: { connected: true, needs_reconnect: false },
};

const TICKETS = [
  {
    _id: "t1",
    customer_id: "c1",
    customer_name: "Smith Residence",
    kind: "charge",
    status: "requested",
    overdue: false,
    note: "Filter clean + O-ring",
    items: [],
    total: 145,
    photo_urls: [],
    timeline: [],
    created_at: 1,
    updated_at: 1,
  },
  {
    _id: "t3",
    customer_id: "c3",
    customer_name: "Oak Hollow HOA",
    kind: "charge",
    status: "requested",
    overdue: true,
    note: "Green-to-clean recovery",
    items: [],
    total: 640,
    photo_urls: [],
    timeline: [],
    created_at: 1,
    updated_at: 1,
  },
];

const SCHEDULE = {
  _id: "s1",
  customer_id: "c4",
  customer_name: "Patel Family",
  cadence: "monthly",
  bill_mode: "visits",
  rate: 55,
  items: [],
  note: "Monthly service",
  autopay: true,
  card_label: "Visa •• 4242",
  paused: false,
  next_run_at: Date.UTC(2026, 9, 1, 12),
  preview: {
    period_label: "October invoice",
    items: [
      { label: "4 visits × $55.00", amount: 220 },
      { label: "Extra chemicals · 1 lb shock", amount: 18 },
    ],
    total: 238,
    unpriced_chemicals: ["Algaecide"],
  },
  history: [{ ticket_id: "t4", period_label: "September", total: 220, status: "paid", square_invoice_number: "0139" }],
  last_error: undefined,
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderWork(path = "/workorders") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workorders/*" element={<Work />} />
        <Route path="/settings" element={<div>Settings Page</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

const location = () => screen.getByTestId("location").textContent;

describe("Work page", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.fns)) delete mocks.fns[key];
    mocks.queryArgs = {};
    mocks.connection = { isWebSocketConnected: true, hasEverConnected: true };
    mocks.queries = {
      "tickets:summary": SUMMARY,
      "tickets:list": TICKETS,
      "billingSchedules:list": [SCHEDULE],
      "billingSchedules:get": SCHEDULE,
      "tickets:get": null,
    };
  });

  it("renders the summary card and ticket rows", () => {
    renderWork();
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Money summary" });
    expect(within(summary).getByText("$785.00")).toBeInTheDocument();
    expect(within(summary).getByText("2 open requests")).toBeInTheDocument();
    expect(within(summary).getByText("Paid this week $405.00")).toBeInTheDocument();
    expect(within(summary).getByText(/3 on recurring billing · \$400.00 bills/)).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Tickets" });
    expect(within(list).getByText("Smith Residence")).toBeInTheDocument();
    expect(within(list).getByText("Overdue")).toBeInTheDocument();
    expect(mocks.queryArgs["tickets:list"]).toEqual({ filter: "all" });
    expect(screen.queryByText(/Connect Square/)).not.toBeInTheDocument();
  });

  it("filters through tickets.list and keeps the filter in the URL", () => {
    renderWork();
    const quotes = screen.getByRole("button", { name: "Quotes" });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(quotes);
    expect(quotes).toHaveAttribute("aria-pressed", "true");
    expect(mocks.queryArgs["tickets:list"]).toEqual({ filter: "quote" });
    expect(location()).toBe("/workorders?filter=quote");
  });

  it("shows billing schedules under Recurring", () => {
    renderWork("/workorders?filter=recurring");
    const list = screen.getByRole("list", { name: "Recurring billing" });
    expect(within(list).getByText("Patel Family")).toBeInTheDocument();
    expect(within(list).getByText("Monthly on the 1st · $55.00/visit + chemicals")).toBeInTheDocument();
    expect(within(list).getByText("Autopay")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /Patel Family/ }));
    expect(location()).toBe("/workorders/s/s1");
  });

  it("shows an empty state", () => {
    mocks.queries["tickets:list"] = [];
    renderWork("/workorders?filter=paid");
    expect(screen.getByText("Nothing paid yet.")).toBeInTheDocument();
  });

  it("links to Settings when Square is not connected", () => {
    mocks.queries["tickets:summary"] = { ...SUMMARY, square: { connected: false, needs_reconnect: false } };
    renderWork();
    expect(screen.getByText("Connect Square in Settings to send invoices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute("href", "/settings#integrations");
  });

  it("asks to reconnect Square when scopes are missing", () => {
    mocks.queries["tickets:summary"] = { ...SUMMARY, square: { connected: true, needs_reconnect: true } };
    renderWork();
    expect(screen.getByText("Reconnect Square to enable invoices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/settings#integrations");
  });

  it("shows the offline notice on the feed", () => {
    mocks.connection = { isWebSocketConnected: false, hasEverConnected: true };
    renderWork();
    expect(screen.getByText("You're offline — tickets need a connection")).toBeInTheDocument();
  });

  it("opens the new ticket screen and a ticket from the feed", () => {
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(location()).toBe("/workorders/new");
    expect(screen.getByRole("region", { name: "New ticket" })).toBeInTheDocument();
  });

  it("navigates to ticket detail routes", () => {
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: /Smith Residence/ }));
    expect(location()).toBe("/workorders/t/t1");
  });

  it.each([
    ["/workorders/invoices?invoice_id=inv1", "/workorders?filter=open"],
    ["/workorders/quotes", "/workorders?filter=quote"],
    ["/workorders/dispatch", "/workorders"],
    ["/workorders/comms", "/workorders"],
  ])("sends legacy link %s to the feed", async (from, to) => {
    renderWork(from);
    await waitFor(() => expect(location()).toBe(to));
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
  });

  it("confirms legacy Square checkout returns and cleans the URL", async () => {
    const { toast } = await import("sonner");
    renderWork("/workorders?square_payment=invoice_success&invoice_id=inv1");
    await waitFor(() => expect(location()).toBe("/workorders"));
    expect(mocks.fns["payments:syncPaymentStatus"]).toHaveBeenCalledWith({ invoice_id: "inv1" });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("redirects the sent screen to the feed when opened directly", async () => {
    renderWork("/workorders/sent");
    await waitFor(() => expect(location()).toBe("/workorders"));
  });

  describe("schedule detail", () => {
    it("shows preview, unpriced chemicals, Square note and history", () => {
      renderWork("/workorders/s/s1");
      expect(screen.getByRole("heading", { name: "Patel Family" })).toBeInTheDocument();
      expect(screen.getByText("October invoice")).toBeInTheDocument();
      expect(screen.getByText("$238.00")).toBeInTheDocument();
      expect(screen.getByText(/No price set for Algaecide/)).toBeInTheDocument();
      expect(screen.getByText(/charges Visa •• 4242/)).toBeInTheDocument();
      expect(screen.getByText("Invoice #0139")).toBeInTheDocument();
      expect(mocks.queryArgs["billingSchedules:get"]).toEqual({ id: "s1" });
    });

    it("pauses and resumes", async () => {
      renderWork("/workorders/s/s1");
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      await waitFor(() => expect(mocks.fns["billingSchedules:setPaused"]).toHaveBeenCalledWith({ id: "s1", paused: true }));
    });

    it("bills now and shows the sent screen", async () => {
      renderWork("/workorders/s/s1");
      mocks.fns["billingSchedules:billNow"].mockResolvedValue({ ticket_id: "t9", status: "requested", square_invoice_number: "0150" });
      fireEvent.click(screen.getByRole("button", { name: "Bill now" }));
      await waitFor(() => expect(location()).toBe("/workorders/sent"));
      expect(mocks.fns["billingSchedules:billNow"]).toHaveBeenCalledWith({ id: "s1" });
      expect(screen.getByRole("heading", { name: "Invoice sent" })).toBeInTheDocument();
      expect(screen.getByText(/Square invoice #0150 was sent to Patel Family/)).toBeInTheDocument();
    });

    it("shows the last error", () => {
      mocks.queries["billingSchedules:get"] = { ...SCHEDULE, last_error: "Card declined" };
      renderWork("/workorders/s/s1");
      expect(screen.getByRole("alert")).toHaveTextContent("Card declined");
    });

    it("edits and removes from the overflow menu", async () => {
      renderWork("/workorders/s/s1");
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Edit" }));
      const edit = await screen.findByRole("dialog", { name: "Edit recurring billing" });
      fireEvent.change(within(edit).getByRole("textbox", { name: /Rate per visit/ }), { target: { value: "60" } });
      fireEvent.click(within(edit).getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(mocks.fns["billingSchedules:update"]).toHaveBeenCalledWith({
          id: "s1",
          cadence: "monthly",
          bill_mode: "visits",
          rate: 60,
          note: "Monthly service",
          autopay: true,
          items: [],
        })
      );

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit recurring billing" })).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
      const confirm = await screen.findByRole("dialog", { name: "Remove recurring billing?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(mocks.fns["billingSchedules:remove"]).toHaveBeenCalledWith({ id: "s1" }));
      await waitFor(() => expect(location()).toBe("/workorders?filter=recurring"));
    });
  });

  it("has no detectable accessibility violations on the feed", async () => {
    const { container } = renderWork();
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});

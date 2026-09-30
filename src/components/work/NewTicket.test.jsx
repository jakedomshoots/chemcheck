import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import NewTicket from "./NewTicket";

const mocks = vi.hoisted(() => ({
  fns: {},
  connection: { isWebSocketConnected: true, hasEverConnected: true },
  customers: [],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  const fn = (ref) => {
    const name = getFunctionName(ref);
    if (!mocks.fns[name]) mocks.fns[name] = vi.fn(async () => undefined);
    return mocks.fns[name];
  };
  return {
    useQuery: () => undefined,
    useMutation: fn,
    useAction: fn,
    useConvexConnectionState: () => mocks.connection,
  };
});

vi.mock("@/api/dexieHooks", () => ({
  useCustomers: () => mocks.customers,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const SMITH = { id: 1, full_name: "Smith Residence", email: "smith@example.com", convex_id: "cust_smith" };
const PATEL = { id: 2, full_name: "Patel Family", phone: "(512) 555-0188", convex_id: "cust_patel" };
const OFFLINE_ONLY = { id: 3, full_name: "Unsynced Pool", phone: "(512) 555-0100" };

function setOnline(value) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

function typeAmount(text) {
  for (const ch of text) {
    const name = ch === "." ? "Decimal point" : ch;
    fireEvent.click(within(screen.getByRole("group", { name: "Amount keypad" })).getByRole("button", { name }));
  }
}

function amountText() {
  return screen.getByTestId("ticket-amount").textContent;
}

async function chooseCustomer(name) {
  fireEvent.click(screen.getByRole("button", { name: /^To:/ }));
  const dialog = await screen.findByRole("dialog", { name: "Choose customer" });
  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(name) }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose customer" })).not.toBeInTheDocument());
}

function setFor(text) {
  fireEvent.change(screen.getByRole("textbox", { name: "For" }), { target: { value: text } });
}

function renderNew() {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<NewTicket onDone={onDone} onClose={onClose} />);
  return { onDone, onClose };
}

describe("NewTicket", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.fns)) delete mocks.fns[key];
    mocks.connection = { isWebSocketConnected: true, hasEverConnected: true };
    mocks.customers = [SMITH, PATEL, OFFLINE_ONLY];
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it("enters amounts with the keypad rules (one point, two decimals, five digits, backspace)", () => {
    renderNew();
    expect(amountText()).toBe("$0");

    typeAmount("123456");
    expect(amountText()).toBe("$12345");

    typeAmount("..999");
    expect(amountText()).toBe("$12345.99");

    fireEvent.click(screen.getByRole("button", { name: "Delete digit" }));
    expect(amountText()).toBe("$12345.9");
  });

  it("adds and removes line items and keeps the total", () => {
    renderNew();
    typeAmount("95");
    setFor("Filter clean");
    fireEvent.click(screen.getByRole("button", { name: "Add as line item" }));

    typeAmount("50");
    setFor("Lid O-ring");
    fireEvent.click(screen.getByRole("button", { name: "Add as line item" }));

    expect(amountText()).toBe("$145.00");
    expect(screen.getByText("2 line items")).toBeInTheDocument();

    typeAmount("5");
    expect(amountText()).toBe("$150.00");
    expect(screen.getByText("Includes $5 not yet added as a line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Filter clean" }));
    expect(amountText()).toBe("$55.00");
  });

  it("asks for an amount and a note before adding a line", () => {
    renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Add as line item" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type an amount and what it is for");
  });

  it("labels the submit button for each mode", () => {
    renderNew();
    expect(screen.getByRole("button", { name: "Request" })).toBeInTheDocument();
    typeAmount("12");
    expect(screen.getByRole("button", { name: "Request $12.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paid in person" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(screen.getByRole("button", { name: "Quote" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Send quote $12.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paid in person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Repeat" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Charge" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getByRole("button", { name: "Start weekly billing" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("button", { name: "Start monthly billing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paid in person" })).not.toBeInTheDocument();
  });

  it("requires a customer before sending", async () => {
    renderNew();
    typeAmount("40");
    fireEvent.click(screen.getByRole("button", { name: "Request $40.00" }));
    expect(await screen.findByRole("dialog", { name: "Choose customer" })).toBeInTheDocument();
    expect(mocks.fns["tickets:send"]).not.toHaveBeenCalled();
  });

  it("sends a charge through tickets.send with dollar amounts", async () => {
    const { onDone } = renderNew();
    await chooseCustomer("Smith Residence");
    typeAmount("95");
    setFor("Filter clean");
    typeAmount("");
    mocks.fns["tickets:send"].mockResolvedValue({ id: "t1", status: "requested", square_invoice_number: "0142", delivered_via: "email" });

    fireEvent.click(screen.getByRole("button", { name: "Request $95.00" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.fns["tickets:send"]).toHaveBeenCalledWith({
      customer_id: "cust_smith",
      kind: "charge",
      note: "Filter clean",
      items: [{ label: "Filter clean", amount: 95 }],
    });
    expect(onDone.mock.calls[0][0]).toMatchObject({ title: "Request sent", amountText: "$95.00", ticketId: "t1" });
    expect(onDone.mock.calls[0][0].detail).toContain("Square invoice #0142");
  });

  it("sends a multi-line quote with every line item", async () => {
    const { onDone } = renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    await chooseCustomer("Patel Family");
    typeAmount("120");
    setFor("Shaft seal kit");
    fireEvent.click(screen.getByRole("button", { name: "Add as line item" }));
    typeAmount("260.5");
    setFor("Labor · 2 hr");
    mocks.fns["tickets:send"].mockResolvedValue({ id: "t2", status: "quote", delivered_via: "sms" });

    fireEvent.click(screen.getByRole("button", { name: "Send quote $380.50" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.fns["tickets:send"]).toHaveBeenCalledWith({
      customer_id: "cust_patel",
      kind: "quote",
      note: "Shaft seal kit + Labor · 2 hr",
      items: [
        { label: "Shaft seal kit", amount: 120 },
        { label: "Labor · 2 hr", amount: 260.5 },
      ],
    });
    expect(onDone.mock.calls[0][0].title).toBe("Quote sent");
  });

  it("records a payment in person with the chosen method", async () => {
    const { onDone } = renderNew();
    await chooseCustomer("Smith Residence");
    typeAmount("85");
    setFor("Heater igniter");
    fireEvent.click(screen.getByRole("button", { name: "Paid in person" }));
    const sheet = await screen.findByRole("dialog", { name: /Paid in person/ });
    mocks.fns["tickets:recordPaidInPerson"].mockResolvedValue({ id: "t9" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Check" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.fns["tickets:recordPaidInPerson"]).toHaveBeenCalledWith({
      customer_id: "cust_smith",
      note: "Heater igniter",
      items: [{ label: "Heater igniter", amount: 85 }],
      method: "check",
    });
    expect(onDone.mock.calls[0][0].title).toBe("Marked paid");
  });

  it("starts recurring billing through billingSchedules.create", async () => {
    const { onDone } = renderNew();
    await chooseCustomer("Patel Family");
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.click(screen.getByRole("button", { name: "Per visit + chemicals" }));
    await waitFor(() => expect(mocks.fns["billingSchedules:customerCard"]).toHaveBeenCalledWith({ customer_id: "cust_patel" }));
    typeAmount("55");
    setFor("Weekly service");
    mocks.fns["billingSchedules:create"].mockResolvedValue("sched1");

    fireEvent.click(screen.getByRole("button", { name: "Start monthly billing" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.fns["billingSchedules:create"]).toHaveBeenCalledWith({
      customer_id: "cust_patel",
      cadence: "monthly",
      bill_mode: "visits",
      rate: 55,
      items: [],
      note: "Weekly service",
      autopay: true,
    });
    expect(onDone.mock.calls[0][0]).toMatchObject({ title: "Recurring billing on", amountText: "$55.00/visit" });
  });

  it("sends fixed recurring billing with its line items and autopay choice", async () => {
    renderNew();
    await chooseCustomer("Smith Residence");
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    const autopay = screen.getByRole("button", { name: /Autopay/ });
    expect(autopay).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(autopay);
    expect(autopay).toHaveAttribute("aria-pressed", "false");
    typeAmount("150");
    setFor("Weekly pool service");
    mocks.fns["billingSchedules:create"].mockResolvedValue("sched2");

    fireEvent.click(screen.getByRole("button", { name: "Start weekly billing" }));

    await waitFor(() => expect(mocks.fns["billingSchedules:create"]).toHaveBeenCalled());
    expect(mocks.fns["billingSchedules:create"]).toHaveBeenCalledWith({
      customer_id: "cust_smith",
      cadence: "weekly",
      bill_mode: "fixed",
      rate: 150,
      items: [{ label: "Weekly pool service", amount: 150 }],
      note: "Weekly pool service",
      autopay: false,
    });
  });

  it("shows the server error and allows a retry after a failed send", async () => {
    const { toast } = await import("sonner");
    const { onDone } = renderNew();
    await chooseCustomer("Smith Residence");
    typeAmount("20");
    mocks.fns["tickets:send"].mockRejectedValueOnce(
      new Error("[CONVEX A(tickets:send)] Server Error\nUncaught Error: Connect your Square account in Settings to send invoices.")
    );
    const submit = screen.getByRole("button", { name: "Request $20.00" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connect your Square account in Settings to send invoices."));
    expect(mocks.fns["tickets:send"]).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Request $20.00" })).not.toBeDisabled());
  });

  it("disables sending while offline", () => {
    setOnline(false);
    renderNew();
    typeAmount("20");
    expect(screen.getByText("You're offline — tickets need a connection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request $20.00" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Paid in person" })).toBeDisabled();
  });

  it("treats a dropped Convex connection as offline", () => {
    mocks.connection = { isWebSocketConnected: false, hasEverConnected: true };
    renderNew();
    expect(screen.getByRole("button", { name: "Request" })).toBeDisabled();
  });

  it("does not let unsynced customers be billed", async () => {
    renderNew();
    fireEvent.click(screen.getByRole("button", { name: /^To:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Choose customer" });
    expect(within(dialog).getByRole("button", { name: /Unsynced Pool/ })).toBeDisabled();
    expect(within(dialog).getByText(/can be billed once they sync/)).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { axe } = await import("jest-axe");
    const { container } = render(<NewTicket onDone={vi.fn()} onClose={vi.fn()} />);
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("filters the customer list by search", async () => {
    renderNew();
    fireEvent.click(screen.getByRole("button", { name: /^To:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Choose customer" });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search customers" }), { target: { value: "patel" } });
    expect(within(dialog).getByRole("button", { name: /Patel Family/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Smith Residence/ })).not.toBeInTheDocument();
  });
});

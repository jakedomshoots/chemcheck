import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TicketDetail from "./TicketDetail";

const mocks = vi.hoisted(() => ({
  fns: {},
  queries: {},
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
    useQuery: (ref, args) => (args === "skip" ? undefined : mocks.queries[getFunctionName(ref)]),
    useMutation: fn,
    useAction: fn,
    useConvexConnectionState: () => mocks.connection,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const NOW = Date.now();

function ticket(overrides = {}) {
  return {
    _id: "t1",
    customer_id: "cust_smith",
    customer_name: "Smith Residence",
    kind: "charge",
    status: "requested",
    overdue: false,
    note: "Filter clean + O-ring",
    items: [
      { label: "Cartridge filter clean", amount: 95 },
      { label: "Lid O-ring", amount: 50 },
    ],
    total: 145,
    photo_urls: ["https://example.com/p1.jpg"],
    square_invoice_number: "0142",
    timeline: [
      { type: "sent", text: "Request sent by text", at: NOW - 2 * 86_400_000 },
      { type: "viewed", text: "Opened pay link", at: NOW - 86_400_000 },
    ],
    created_at: NOW - 2 * 86_400_000,
    updated_at: NOW,
    ...overrides,
  };
}

function renderDetail(t) {
  mocks.queries["tickets:get"] = t;
  const onBack = vi.fn();
  const onDeleted = vi.fn();
  render(<TicketDetail ticketId={t?._id || "missing"} onBack={onBack} onDeleted={onDeleted} />);
  return { onBack, onDeleted };
}

describe("TicketDetail", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.fns)) delete mocks.fns[key];
    mocks.queries = {};
    mocks.connection = { isWebSocketConnected: true, hasEverConnected: true };
  });

  it("shows the ticket header, Square badge, items, photos and activity", () => {
    renderDetail(ticket());
    expect(screen.getByRole("heading", { name: "Smith Residence" })).toBeInTheDocument();
    expect(screen.getAllByText("$145.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Square invoice #0142")).toBeInTheDocument();
    expect(screen.getByText("Cartridge filter clean")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    expect(screen.getByText("Request sent by text")).toBeInTheDocument();
    expect(screen.getByText("2d")).toBeInTheDocument();
  });

  it("shows the overdue chip", () => {
    renderDetail(ticket({ overdue: true }));
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("requested: Remind calls tickets.remind", async () => {
    renderDetail(ticket());
    fireEvent.click(screen.getByRole("button", { name: "Remind" }));
    await waitFor(() => expect(mocks.fns["tickets:remind"]).toHaveBeenCalledWith({ id: "t1" }));
  });

  it("requested: Mark paid asks cash/check/other and calls tickets.markPaid", async () => {
    renderDetail(ticket());
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    const sheet = await screen.findByRole("dialog", { name: /Mark \$145.00 paid/ });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cash" }));
    await waitFor(() => expect(mocks.fns["tickets:markPaid"]).toHaveBeenCalledWith({ id: "t1", method: "cash" }));
  });

  it("requested: the overflow can cancel the Square invoice", async () => {
    renderDetail(ticket());
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "More actions" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(mocks.fns["tickets:cancel"]).toHaveBeenCalledWith({ id: "t1" }));
  });

  it("quote: Declined and Approved · Request call the quote functions", async () => {
    renderDetail(ticket({ kind: "quote", status: "quote", square_invoice_number: undefined }));
    expect(screen.getByText("Quote sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Declined" }));
    await waitFor(() => expect(mocks.fns["tickets:declineQuote"]).toHaveBeenCalledWith({ id: "t1" }));
    fireEvent.click(screen.getByRole("button", { name: "Approved · Request" }));
    await waitFor(() => expect(mocks.fns["tickets:approveQuote"]).toHaveBeenCalledWith({ id: "t1" }));
  });

  it("draft: Delete removes the draft and Send request sends it", async () => {
    const draft = ticket({ status: "draft", square_invoice_number: undefined });
    const { onDeleted } = renderDetail(draft);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() =>
      expect(mocks.fns["tickets:send"]).toHaveBeenCalledWith({
        id: "t1",
        customer_id: "cust_smith",
        kind: "charge",
        note: "Filter clean + O-ring",
        items: draft.items,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.fns["tickets:deleteDraft"]).toHaveBeenCalledWith({ id: "t1" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("paid: links to the Square invoice and offers no other actions", () => {
    renderDetail(ticket({ status: "paid", square_invoice_url: "https://squareup.com/pay-invoice/abc" }));
    expect(screen.getByRole("link", { name: /View in Square/ })).toHaveAttribute("href", "https://squareup.com/pay-invoice/abc");
    expect(screen.queryByRole("button", { name: "Remind" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("canceled: shows no actions", () => {
    renderDetail(ticket({ status: "canceled" }));
    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remind|Mark paid|Declined|Delete|Send/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View in Square/ })).not.toBeInTheDocument();
  });

  it("disables actions while offline", () => {
    mocks.connection = { isWebSocketConnected: false, hasEverConnected: true };
    renderDetail(ticket());
    expect(screen.getByText("You're offline — tickets need a connection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remind" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeDisabled();
  });

  it("handles a missing ticket", () => {
    renderDetail(null);
    expect(screen.getByRole("heading", { name: "Ticket not found" })).toBeInTheDocument();
  });
});

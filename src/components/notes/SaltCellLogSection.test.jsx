import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getTodayDate } from "@/db/chemcheck-db";
import { SaltCellLogSection } from "./SaltCellLogSection";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const originalDomMethods = {
  hasPointerCapture: Element.prototype.hasPointerCapture,
  setPointerCapture: Element.prototype.setPointerCapture,
  releasePointerCapture: Element.prototype.releasePointerCapture,
  scrollIntoView: Element.prototype.scrollIntoView,
};

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperties(Element.prototype, {
    hasPointerCapture: { configurable: true, value: vi.fn().mockReturnValue(false) },
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
});

afterAll(async () => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.entries(originalDomMethods).forEach(([name, original]) => {
    if (original) {
      Object.defineProperty(Element.prototype, name, { configurable: true, value: original });
    } else {
      delete Element.prototype[name];
    }
  });
});

const mondaySaltCustomer = {
  id: 101,
  _id: 101,
  full_name: "Harbor Pines",
  service_day: "Monday",
  pool_type: "Salt",
};

const wednesdaySaltCustomer = {
  id: 202,
  _id: 202,
  full_name: "Cypress Landing",
  service_day: "Wednesday",
  pool_type: "Salt",
};

const chlorineCustomer = {
  id: 303,
  _id: 303,
  full_name: "Coral Court",
  service_day: "Monday",
  pool_type: "Chlorine",
};

describe("SaltCellLogSection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete();
    await db.open();
  });

  it("uses the same compact collapsed rail and service-day workflow as filter maintenance", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SaltCellLogSection customers={[mondaySaltCustomer, wednesdaySaltCustomer, chlorineCustomer]} />
    );

    expect(await screen.findByRole("heading", { name: "Salt Cell Cleanings" })).toBeInTheDocument();
    const section = container.querySelector("[aria-labelledby='salt-cell-log-title']");
    expect(section).toHaveClass("border-y", "bg-surface-1");
    expect(section).not.toHaveClass("rounded-sheet", "shadow-card");

    const expandButton = screen.getByRole("button", { name: "Expand salt cell cleaning log" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tablist", { name: "Salt cell service day" })).not.toBeInTheDocument();

    await user.click(expandButton);

    expect(screen.getByRole("tab", { name: "Monday, 1 salt pool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Harbor Pines")).toBeInTheDocument();
    expect(screen.queryByText("Cypress Landing")).not.toBeInTheDocument();
    expect(screen.queryByText("Coral Court")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Wednesday, 1 salt pool" }));

    expect(screen.getByText("Cypress Landing")).toBeInTheDocument();
    expect(screen.queryByText("Harbor Pines")).not.toBeInTheDocument();
  });

  it("logs a cleaning from the selected customer row and opens its history", async () => {
    const user = userEvent.setup();
    render(<SaltCellLogSection customers={[mondaySaltCustomer]} />);

    await user.click(await screen.findByRole("button", { name: "Expand salt cell cleaning log" }));
    await user.click(screen.getByRole("button", { name: "Log salt cell cleaning for Harbor Pines" }));

    expect(screen.getByRole("dialog", { name: "Log Salt Cell Cleaning" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Customer" })).toHaveTextContent("Harbor Pines");
    await user.type(screen.getByLabelText("Notes (optional)"), "Cell rinsed and inspected");
    await user.click(screen.getByRole("button", { name: "Save Cleaning Log" }));

    await waitFor(async () => {
      const savedLog = await db.saltCellLogs.where("customer_id").equals("101").first();
      expect(savedLog).toMatchObject({
        cleaning_date: getTodayDate(),
        condition: "good",
        notes: "Cell rinsed and inspected",
        sync_status: "pending",
      });
    });

    expect(await screen.findByText("Light Buildup")).toBeInTheDocument();
    expect(screen.getByText("Cell rinsed and inspected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp("Delete salt cell cleaning") })).toHaveClass("h-11", "w-11");
  });

  it("shows existing history inside the customer row instead of separate cards", async () => {
    const user = userEvent.setup();
    await db.saltCellLogs.add({
      customer_id: "101",
      cleaning_date: "2026-07-10",
      condition: "heavy",
      notes: "Heavy scale at inspection",
      sync_status: "synced",
      local_updated_at: Date.now(),
    });
    render(<SaltCellLogSection customers={[mondaySaltCustomer]} />);

    await user.click(await screen.findByRole("button", { name: "Expand salt cell cleaning log" }));
    expect(screen.getByText(/Jul 10, 2026/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show cleaning history for Harbor Pines" }));

    expect(screen.getByText("Heavy scale at inspection")).toBeInTheDocument();
    expect(screen.getAllByText("Heavy Buildup").length).toBeGreaterThanOrEqual(1);
  });
});

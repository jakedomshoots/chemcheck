import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getTodayDate } from "@/db/chemcheck-db";
import { FilterMaintenanceSection } from "./FilterMaintenanceSection";

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

async function seedCustomer() {
  const customer = {
    full_name: "Cypress Landing",
    address: "144 Cypress Landing Way",
    service_day: "Wednesday",
    pool_gallons: 16500,
    pool_type: "Salt",
    surface_type: "Plaster",
    created_by: "local",
    sync_status: "synced",
    local_updated_at: Date.now(),
  };
  const customerId = await db.customers.add(customer);
  const poolId = await db.pools.add({
    customer_id: customerId,
    name: "Primary Pool",
    address: customer.address,
    service_day: customer.service_day,
    pool_gallons: customer.pool_gallons,
    pool_type: customer.pool_type,
    surface_type: customer.surface_type,
    active: true,
    sync_status: "synced",
    local_updated_at: Date.now(),
  });
  return { customer: { ...customer, id: customerId, _id: customerId }, customerId, poolId };
}

describe("FilterMaintenanceSection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete();
    await db.open();
  });

  it("stays compact until the annual due list is opened", async () => {
    const user = userEvent.setup();
    const { customer } = await seedCustomer();
    const { container } = render(<FilterMaintenanceSection customers={[customer]} />);

    expect(await screen.findByRole("heading", { name: "Annual Filter Clean" })).toBeInTheDocument();
    const maintenanceSection = container.querySelector("[aria-labelledby='filter-maintenance-title']");
    expect(maintenanceSection).toHaveClass("border-y", "bg-surface-1");
    expect(maintenanceSection).not.toHaveClass("rounded-sheet", "shadow-card");
    const expandButton = screen.getByRole("button", { name: "Expand annual filter cleaning checklist" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("progressbar", { name: new RegExp("filter cleaning progress") })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByTestId("filter-maintenance-list")).not.toBeInTheDocument();

    await user.click(expandButton);

    expect(screen.getByRole("button", { name: "Collapse annual filter cleaning checklist" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tab", { name: "Wednesday, 1 customer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Cypress Landing")).toBeInTheDocument();
    expect(screen.getByText(/Filter type needed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`Mark Cypress Landing filter cleaned for ${getTodayDate().slice(0, 4)}`) })).toBeInTheDocument();
  });

  it("switches service days like the Clients schedule", async () => {
    const user = userEvent.setup();
    const { customer } = await seedCustomer();
    const mondayCustomer = {
      ...customer,
      id: customer.id + 100,
      _id: customer._id + 100,
      full_name: "Harbor Pines",
      service_day: "Monday",
    };
    render(<FilterMaintenanceSection customers={[customer, mondayCustomer]} />);

    await user.click(await screen.findByRole("button", { name: "Expand annual filter cleaning checklist" }));

    expect(screen.getByRole("tab", { name: "Monday, 1 customer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Harbor Pines")).toBeInTheDocument();
    expect(screen.queryByText("Cypress Landing")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Wednesday, 1 customer" }));

    expect(screen.getByRole("tab", { name: "Wednesday, 1 customer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Cypress Landing")).toBeInTheDocument();
    expect(screen.queryByText("Harbor Pines")).not.toBeInTheDocument();
  });

  it("saves filter type and replacement details to synchronized equipment", async () => {
    const user = userEvent.setup();
    const { customer, customerId } = await seedCustomer();
    render(<FilterMaintenanceSection customers={[customer]} />);

    await user.click(await screen.findByRole("button", { name: "Expand annual filter cleaning checklist" }));
    await user.click(await screen.findByRole("button", { name: "Edit filter details for Cypress Landing" }));
    await user.click(screen.getByRole("combobox", { name: "Filter type" }));
    await user.click(await screen.findByRole("option", { name: "Cartridge" }));
    await user.type(screen.getByLabelText("Model or replacement part"), "Pentair CCP420");
    await user.click(screen.getByRole("button", { name: "Save Filter Details" }));

    await waitFor(async () => {
      const equipment = await db.equipment.where("customer_id").equals(customerId).first();
      expect(equipment).toMatchObject({
        equipment_type: "filter",
        name: "Cartridge",
        model: "Pentair CCP420",
        sync_status: "pending",
      });
    });
    expect(await screen.findByText(/Cartridge · Pentair CCP420/)).toBeInTheDocument();
  });

  it("checks a configured filter off for the current year", async () => {
    const user = userEvent.setup();
    const { customer, customerId, poolId } = await seedCustomer();
    const equipmentId = await db.equipment.add({
      customer_id: customerId,
      pool_id: poolId,
      equipment_type: "filter",
      name: "D.E.",
      model: "Pentair FNS Plus 48",
      status: "active",
      sync_status: "synced",
      local_updated_at: Date.now(),
    });
    render(<FilterMaintenanceSection customers={[customer]} />);

    await user.click(await screen.findByRole("button", { name: "Expand annual filter cleaning checklist" }));
    await user.click(await screen.findByRole("button", { name: new RegExp(`Mark Cypress Landing filter cleaned for ${getTodayDate().slice(0, 4)}`) }));

    await waitFor(async () => {
      const equipment = await db.equipment.get(equipmentId);
      expect(equipment.last_service_date).toBe(getTodayDate());
      expect(equipment.next_service_due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(equipment.sync_status).toBe("pending");
    });
    expect(await screen.findByText(new RegExp(`Cleaned ${formatTodayForUi()}`))).toBeInTheDocument();
  });
});

function formatTodayForUi() {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${getTodayDate()}T12:00:00Z`));
}

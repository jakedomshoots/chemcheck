import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChemicalPricesSection } from "./ChemicalPricesSection";

const mocks = vi.hoisted(() => ({
  canManage: true,
  prices: undefined,
  set: vi.fn(async () => null),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref, args) => {
      const name = getFunctionName(ref);
      if (name === "chemicalPrices:canManage") return mocks.canManage;
      return args === "skip" ? undefined : mocks.prices;
    },
    useMutation: () => mocks.set,
    useConvexConnectionState: () => ({ isWebSocketConnected: true, hasEverConnected: true }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("ChemicalPricesSection", () => {
  beforeEach(() => {
    mocks.set.mockClear();
    mocks.canManage = true;
    mocks.prices = [{ chemical_type: "Liquid Chlorine", unit: "gal", price: 6.5 }];
  });

  it("is hidden from team members who cannot manage billing settings", () => {
    mocks.canManage = false;
    render(<ChemicalPricesSection />);
    expect(screen.queryByRole("heading", { name: "Chemical prices" })).not.toBeInTheDocument();
  });

  it("prefills known chemical types and saved prices, then saves priced rows in dollars", async () => {
    render(<ChemicalPricesSection chemicalTypes={["Liquid Chlorine", "Salt", "Other"]} />);

    expect(screen.getByRole("textbox", { name: "Liquid Chlorine price per unit" })).toHaveValue("6.5");
    expect(screen.getByRole("textbox", { name: "Salt unit" })).toHaveValue("lb");
    expect(screen.queryByRole("textbox", { name: "Other price per unit" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Salt price per unit" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chemical prices" }));

    await waitFor(() =>
      expect(mocks.set).toHaveBeenCalledWith({
        prices: [
          { chemical_type: "Liquid Chlorine", unit: "gal", price: 6.5 },
          { chemical_type: "Salt", unit: "lb", price: 12 },
        ],
      })
    );
  });

  it("shows a loading state until prices arrive", () => {
    mocks.prices = undefined;
    render(<ChemicalPricesSection />);
    expect(screen.getByText("Loading prices…")).toBeInTheDocument();
  });
});

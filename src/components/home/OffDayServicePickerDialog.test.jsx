import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import OffDayServicePickerDialog from "./OffDayServicePickerDialog";

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

afterAll(() => {
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
describe("OffDayServicePickerDialog", () => {
  it("renders alternate days and starts selected client", async () => {
    const user = userEvent.setup();
    const handleDayChange = vi.fn();
    const handleSearchChange = vi.fn();
    const handleStartClient = vi.fn();

    render(
      <OffDayServicePickerDialog
        open={true}
        onOpenChange={vi.fn()}
        todayDay="Monday"
        availableDays={["Tuesday", "Wednesday"]}
        selectedDay="Tuesday"
        onSelectedDayChange={handleDayChange}
        searchQuery=""
        onSearchQueryChange={handleSearchChange}
        clients={[
          { _id: 1, full_name: "Ava Pool", address: "101 Main St" },
          { _id: 2, full_name: "Ben Blue", address: "202 Oak Ave" },
        ]}
        onStartClient={handleStartClient}
      />
    );

    expect(screen.getByText("Service Another Day")).toBeInTheDocument();
    const daySelect = screen.getByRole("combobox", { name: "Service day" });
    expect(daySelect).toHaveTextContent("Tuesday");
    expect(screen.getByText("Ava Pool")).toBeInTheDocument();
    expect(screen.getByText("Ben Blue")).toBeInTheDocument();

    await user.click(daySelect);
    await user.click(await screen.findByRole("option", { name: "Wednesday" }));
    expect(handleDayChange).toHaveBeenCalledWith("Wednesday");

    fireEvent.change(screen.getByPlaceholderText("Search Tuesday clients..."), {
      target: { value: "ava" },
    });
    expect(handleSearchChange).toHaveBeenCalledWith("ava");

    await user.click(screen.getAllByRole("button", { name: /Start/i })[0]);
    expect(handleStartClient).toHaveBeenCalledWith({
      _id: 1,
      full_name: "Ava Pool",
      address: "101 Main St",
    });
  });

  it("shows an empty-state message when no pending clients exist", () => {
    render(
      <OffDayServicePickerDialog
        open={true}
        onOpenChange={vi.fn()}
        todayDay="Monday"
        availableDays={["Tuesday"]}
        selectedDay="Tuesday"
        onSelectedDayChange={vi.fn()}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        clients={[]}
        onStartClient={vi.fn()}
      />
    );

    expect(screen.getByText("No pending clients found for Tuesday.")).toBeInTheDocument();
  });
});

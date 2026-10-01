import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("restores focus to the opener when the sheet closes", async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Service another day</button>
          <OffDayServicePickerDialog
            open={open}
            onOpenChange={setOpen}
            todayDay="Monday"
            availableDays={["Tuesday"]}
            selectedDay="Tuesday"
            onSelectedDayChange={vi.fn()}
            searchQuery=""
            onSearchQueryChange={vi.fn()}
            clients={[{ _id: 1, full_name: "Pending Client", address: "1 Pending St" }]}
            onStartClient={vi.fn()}
          />
        </div>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Service another day" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole("textbox", { name: "Search Tuesday clients" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start service for Pending Client" })).toHaveClass("h-11");
    expect(screen.getByRole("list", { name: "Tuesday clients" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

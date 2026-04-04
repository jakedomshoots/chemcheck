import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OffDayServicePickerDialog from "./OffDayServicePickerDialog";

describe("OffDayServicePickerDialog", () => {
  it("renders alternate days and starts selected client", () => {
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
    expect(screen.getByRole("button", { name: "Tuesday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wednesday" })).toBeInTheDocument();
    expect(screen.getByText("Ava Pool")).toBeInTheDocument();
    expect(screen.getByText("Ben Blue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    expect(handleDayChange).toHaveBeenCalledWith("Wednesday");

    fireEvent.change(screen.getByPlaceholderText("Search Tuesday clients..."), {
      target: { value: "ava" },
    });
    expect(handleSearchChange).toHaveBeenCalledWith("ava");

    fireEvent.click(screen.getAllByRole("button", { name: /Start/i })[0]);
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

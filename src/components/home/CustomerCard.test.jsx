import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CustomerCard from "./CustomerCard";

const customer = {
  _id: "customer-1",
  full_name: "john snow",
  address: "123 main",
  phone: "555-0100",
};

describe("CustomerCard", () => {
  it("replaces the collapsed address with a quick chemical view", () => {
    render(
      <CustomerCard
        customer={customer}
        isCompleted={false}
        isSkipped={false}
        lastWeekLog={{
          ph: "good",
          chlorine: "low",
          alkalinity: "high",
          stabilizer: "good",
          service_date: "2026-06-16",
        }}
      />
    );

    const quickView = screen.getByLabelText("Quick chemical view");

    expect(screen.queryByText("123 main")).not.toBeInTheDocument();
    expect(within(quickView).getByText("pH")).toBeInTheDocument();
    expect(within(quickView).getByText("Cl")).toBeInTheDocument();
    expect(within(quickView).getByText("Alk")).toBeInTheDocument();
    expect(within(quickView).getAllByText("good")).toHaveLength(2);
    expect(within(quickView).getByText("low")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand details/i }));

    expect(screen.getByText("123 main")).toBeInTheDocument();
  });

  it("surfaces start and skip as compact direct actions", () => {
    const onStart = vi.fn();
    const onMap = vi.fn();
    const onSkip = vi.fn();

    render(
      <CustomerCard
        customer={customer}
        isCompleted={false}
        isSkipped={false}
        onStart={onStart}
        onMap={onMap}
        onSkip={onSkip}
      />
    );

    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /map/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(onMap).not.toHaveBeenCalled();
  });

  it("moves map into expanded details", () => {
    const onMap = vi.fn();
    const onStart = vi.fn();

    render(
      <CustomerCard
        customer={customer}
        isCompleted={false}
        isSkipped={false}
        onMap={onMap}
        onStart={onStart}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /expand details/i }));
    fireEvent.click(screen.getByRole("button", { name: /map/i }));

    expect(onMap).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps skip from duplicating in expanded details", () => {
    render(
      <CustomerCard
        customer={customer}
        isCompleted={false}
        isSkipped={false}
        onSkip={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /expand details/i }));

    expect(screen.getAllByRole("button", { name: /skip/i })).toHaveLength(1);
  });

  it("uses unskip for skipped customers", () => {
    const onUnskip = vi.fn();
    const onSkip = vi.fn();

    render(
      <CustomerCard
        customer={customer}
        isCompleted={false}
        isSkipped
        onSkip={onSkip}
        onUnskip={onUnskip}
      />
    );

    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unskip/i }));

    expect(onUnskip).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });
});

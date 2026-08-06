import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ClientListItem from "./ClientListItem";

const customer = {
  _id: "customer-1",
  full_name: "Sample · Seabreeze House",
  address: "101 Demo Pool Way",
  phone: "555-0101",
  email: "sample@example.test",
  gate_code: "1234",
  pool_type: "Salt",
  pool_gallons: 15000,
  surface_type: "Plaster",
};

function renderItem(overrides = {}) {
  const props = {
    customer,
    stopNumber: 2,
    onClick: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    isFirst: false,
    isLast: false,
    isMoving: false,
    reorderMode: false,
    ...overrides,
  };

  render(<ClientListItem {...props} />);
  return props;
}

describe("ClientListItem", () => {
  it("renders a flat numbered manifest row", () => {
    renderItem();

    expect(screen.getByLabelText("Stop 2")).toHaveTextContent("02");
    expect(screen.getByTestId("client-list-item-customer-1")).toHaveClass("bg-surface-1");
    expect(screen.getByTestId("client-list-item-customer-1")).not.toHaveClass("rounded-xl", "shadow-sm");
    expect(screen.getByRole("button", { name: /expand details/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals profile actions in a flat inset detail region", () => {
    const props = renderItem();

    fireEvent.click(screen.getByRole("button", { name: /expand details/i }));

    expect(screen.getByRole("button", { name: /collapse details/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Pool profile")).toBeInTheDocument();
    expect(screen.getByText("15,000 gal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view client/i }));
    fireEvent.click(screen.getByRole("button", { name: /edit sample/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete sample/i }));

    expect(props.onClick).toHaveBeenCalledWith(customer);
    expect(props.onEdit).toHaveBeenCalledWith(customer);
    expect(props.onDelete).toHaveBeenCalledWith(customer);
  });

  it("uses full-size directional controls in reorder mode", () => {
    const props = renderItem({ reorderMode: true });

    const moveUp = screen.getByRole("button", { name: /move sample .* up/i });
    const moveDown = screen.getByRole("button", { name: /move sample .* down/i });

    expect(moveUp).toHaveClass("h-11", "w-11");
    expect(moveDown).toHaveClass("h-11", "w-11");

    fireEvent.click(moveUp);
    fireEvent.click(moveDown);

    expect(props.onMoveUp).toHaveBeenCalledWith(customer);
    expect(props.onMoveDown).toHaveBeenCalledWith(customer);
  });
});

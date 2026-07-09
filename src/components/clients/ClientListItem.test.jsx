import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ClientListItem from "./ClientListItem";

const customer = {
  _id: "customer-1",
  full_name: "Alice Smith",
  address: "123 Main Street",
  gate_code: "1234",
};

describe("ClientListItem", () => {
  it("masks a gate code until the technician deliberately reveals it", () => {
    render(
      <ClientListItem
        customer={customer}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Alice Smith"));

    expect(screen.queryByText("1234")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal gate code" }));
    expect(screen.getByText("1234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide gate code" }));
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
  });
});

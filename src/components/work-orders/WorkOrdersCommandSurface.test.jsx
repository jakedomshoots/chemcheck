import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  WorkOrdersEmptyState,
  WorkOrdersMetricStrip,
  WorkOrdersSectionNav,
} from "./WorkOrdersCommandSurface";

describe("WorkOrdersCommandSurface", () => {
  it("exposes route navigation with counts and the active section", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <WorkOrdersSectionNav
        activeSection="dispatch"
        counts={{ dispatch: 3, quotes: 2, invoices: 1, comms: 4 }}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("button", { name: /dispatch/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("2 quotes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /invoices/i }));
    expect(onChange).toHaveBeenCalledWith("invoices");
  });

  it("renders connected metrics with their labels and values", () => {
    render(
      <WorkOrdersMetricStrip
        items={[
          { label: "Jobs", value: 8 },
          { label: "In progress", value: 2 },
          { label: "Completed", value: 5 },
          { label: "High priority", value: 1 },
        ]}
      />
    );

    expect(screen.getByText("High priority")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("keeps the empty-state action functional", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <WorkOrdersEmptyState
        title="No jobs scheduled"
        description="Create the first job."
        actionLabel="Create work order"
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole("button", { name: "Create work order" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

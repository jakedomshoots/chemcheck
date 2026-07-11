import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconBadge, PoolIcon, poolIconNames } from "./iconography";

describe("ChemCheck iconography", () => {
  it("exposes the pool-service semantic icon set", () => {
    expect(poolIconNames).toEqual(expect.arrayContaining([
      "home",
      "clients",
      "workOrders",
      "chemicals",
      "route",
      "poolSchool",
      "waterLevel",
    ]));
  });

  it("hides decorative icons from assistive technology by default", () => {
    render(<PoolIcon name="route" data-testid="route-icon" />);

    expect(screen.getByTestId("route-icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps an accessible label on a standalone icon badge", () => {
    render(<IconBadge name="clients" aria-label="Client roster" data-testid="client-badge" />);

    const badge = screen.getByTestId("client-badge");
    expect(badge).toHaveAttribute("aria-label", "Client roster");
    expect(badge).not.toHaveAttribute("aria-hidden");
  });

  it("fails loudly for an unknown semantic icon name", () => {
    expect(() => render(<PoolIcon name="not-a-real-icon" />)).toThrow("Unknown ChemCheck icon");
  });
});

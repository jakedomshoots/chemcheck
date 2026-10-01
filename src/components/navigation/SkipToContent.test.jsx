import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "vitest";
import SkipToContent from "./SkipToContent";

expect.extend(toHaveNoViolations);

describe("SkipToContent", () => {
  it("links to the main landmark and moves focus to it", () => {
    render(
      <div>
        <SkipToContent />
        <main id="main-content">Page body</main>
      </div>
    );

    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link).toHaveClass("skip-link");

    fireEvent.click(link);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveFocus();
  });

  it("supports a custom target and label", () => {
    render(
      <div>
        <SkipToContent targetId="route-list" label="Skip to route" />
        <section id="route-list" tabIndex={-1}>Route</section>
      </div>
    );
    fireEvent.click(screen.getByRole("link", { name: "Skip to route" }));
    expect(document.getElementById("route-list")).toHaveFocus();
  });

  it("does nothing harmful when the target is missing", () => {
    render(<SkipToContent targetId="nope" />);
    expect(() => fireEvent.click(screen.getByRole("link"))).not.toThrow();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <SkipToContent />
        <main id="main-content">Body</main>
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

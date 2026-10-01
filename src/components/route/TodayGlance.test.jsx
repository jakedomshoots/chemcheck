import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "vitest";
import TodayGlance from "./TodayGlance";

expect.extend(toHaveNoViolations);

const nextStop = { _id: 7, full_name: "Blue Heron", address: "707 Blue Heron Blvd" };

describe("TodayGlance", () => {
  it("renders nothing when there are no stops", () => {
    const { container } = render(<TodayGlance total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows done/remaining, next stop, maps link, finish time and progress", () => {
    const finishAt = new Date(2026, 5, 8, 16, 45);
    render(
      <TodayGlance
        total={8}
        completed={3}
        skipped={1}
        nextStop={nextStop}
        finishAt={finishAt}
        remainingMinutes={135}
      />
    );

    expect(screen.getByText("done · 4 remaining")).toBeInTheDocument();
    expect(screen.getByTestId("today-glance-next-name")).toHaveTextContent("Blue Heron");
    expect(screen.getByText("707 Blue Heron Blvd")).toBeInTheDocument();
    expect(screen.getByText("4:45 PM")).toBeInTheDocument();
    expect(screen.getByText("(about 2 hr 15 min left)")).toHaveClass("sr-only");

    const link = screen.getByRole("link", { name: "Open Blue Heron in Maps" });
    expect(link).toHaveAttribute("href", expect.stringContaining("707%20Blue%20Heron%20Blvd"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const progress = screen.getByRole("progressbar", { name: "Route progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "3");
    expect(progress).toHaveAttribute("aria-valuemax", "8");
    expect(progress).toHaveAttribute("aria-valuetext", "3 of 8 stops done");
  });

  it("omits the maps link when the next stop has no address", () => {
    render(<TodayGlance total={2} completed={0} nextStop={{ _id: 1, full_name: "No Address" }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("No address on file")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("celebrates a finished day without a next stop", () => {
    render(<TodayGlance total={3} completed={3} finishAt={new Date()} />);
    expect(screen.getByText("Every stop is logged.")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText(/Next stop/)).not.toBeInTheDocument();
  });

  it("explains an all-skipped remainder", () => {
    render(<TodayGlance total={3} completed={1} skipped={2} nextStop={null} />);
    expect(screen.getByText(/remaining stops are skipped/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TodayGlance total={5} completed={2} nextStop={nextStop} finishAt={new Date()} remainingMinutes={90} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

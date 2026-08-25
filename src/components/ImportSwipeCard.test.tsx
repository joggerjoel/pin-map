import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportSwipeCard } from "./ImportSwipeCard";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

const candidate: ImportCandidate = {
  id: "c1",
  externalKey: "key1",
  placeName: "Busselton, Western Australia",
  suggestedLat: -33.65,
  suggestedLng: 115.34,
  geocodeConfidence: "low",
  visitTime: "2011-11-30T21:49:51.000Z",
  note: "Ironman weekend",
  status: "pending",
};

describe("ImportSwipeCard", () => {
  it("shows the place name, date, and note", () => {
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Busselton, Western Australia"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ironman weekend")).toBeInTheDocument();
  });

  it("links to a Google Maps search for the place name, opening in a new tab", () => {
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: "Open in Google Maps" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Busselton%2C%20Western%20Australia",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("calls onApprove/onReject/onLater from the on-screen buttons", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Later" }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("disables Approve when the candidate has no coordinates", () => {
    render(
      <ImportSwipeCard
        candidate={{ ...candidate, suggestedLat: null, suggestedLng: null }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/no location found/)).toBeInTheDocument();
  });

  it("triggers the matching action on arrow-key press", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("calls onReject after dragging left past the threshold", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
      />,
    );

    const card = screen.getByRole("group", {
      name: /Review Busselton/,
    });
    fireEvent.mouseDown(card, { clientX: 500, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 300 });

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onLater).not.toHaveBeenCalled();
  });

  it("calls onLater after dragging down past the threshold", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
      />,
    );

    const card = screen.getByRole("group", {
      name: /Review Busselton/,
    });
    fireEvent.mouseDown(card, { clientX: 500, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 450 });
    fireEvent.mouseUp(window, { clientX: 500, clientY: 450 });

    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("does not trigger any action when a drag stays under the threshold", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    render(
      <ImportSwipeCard
        candidate={candidate}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
      />,
    );

    const card = screen.getByRole("group", {
      name: /Review Busselton/,
    });
    fireEvent.mouseDown(card, { clientX: 500, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 530, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 530, clientY: 300 });

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(onLater).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportSwipeView } from "./ImportSwipeView";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

function makeCandidate(
  overrides: Partial<ImportCandidate> & { id: string },
): ImportCandidate {
  return {
    externalKey: `key-${overrides.id}`,
    placeName: `Place ${overrides.id}`,
    suggestedLat: 1,
    suggestedLng: 1,
    geocodeConfidence: "low",
    visitTime: "2020-01-01T00:00:00.000Z",
    note: null,
    status: "pending",
    ...overrides,
  };
}

describe("ImportSwipeView", () => {
  it("shows the front card in newest-first order by default", () => {
    const older = makeCandidate({
      id: "older",
      visitTime: "2019-01-01T00:00:00.000Z",
    });
    const newer = makeCandidate({
      id: "newer",
      visitTime: "2021-01-01T00:00:00.000Z",
    });
    render(
      <ImportSwipeView
        candidates={[older, newer]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText("Place newer")).toBeInTheDocument();
    expect(screen.queryByText("Place older")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to review", () => {
    render(
      <ImportSwipeView
        candidates={[]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing left to review/)).toBeInTheDocument();
  });

  it("advances to the next card in the queue once the current one is removed (approve/reject)", () => {
    const a = makeCandidate({
      id: "a",
      visitTime: "2021-01-01T00:00:00.000Z",
    });
    const b = makeCandidate({
      id: "b",
      visitTime: "2020-01-01T00:00:00.000Z",
    });
    const { rerender } = render(
      <ImportSwipeView
        candidates={[a, b]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText("Place a")).toBeInTheDocument();

    // Simulate the parent removing "a" after it was approved.
    rerender(
      <ImportSwipeView
        candidates={[b]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );

    expect(screen.getByText("Place b")).toBeInTheDocument();
  });

  it("moves a deferred card to the back of the queue instead of showing it again immediately", async () => {
    const a = makeCandidate({
      id: "a",
      visitTime: "2021-01-01T00:00:00.000Z",
    });
    const b = makeCandidate({
      id: "b",
      visitTime: "2020-01-01T00:00:00.000Z",
    });
    const onDefer = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportSwipeView
        candidates={[a, b]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={onDefer}
      />,
    );
    expect(screen.getByText("Place a")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Later" }));

    expect(onDefer).toHaveBeenCalledWith("a");
    // "a" is still in candidates (defer doesn't remove it — status just
    // becomes 'later') but should no longer be the front card.
    expect(screen.getByText("Place b")).toBeInTheDocument();
  });

  it("re-derives the queue from scratch when the order preference changes", () => {
    const a = makeCandidate({
      id: "a",
      visitTime: "2021-01-01T00:00:00.000Z",
    });
    const b = makeCandidate({
      id: "b",
      visitTime: "2020-01-01T00:00:00.000Z",
    });
    const { rerender } = render(
      <ImportSwipeView
        candidates={[a, b]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText("Place a")).toBeInTheDocument();

    rerender(
      <ImportSwipeView
        candidates={[a, b]}
        order="oldest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );

    expect(screen.getByText("Place b")).toBeInTheDocument();
  });

  it("appends newly arrived candidates to the back without disturbing the current front card", () => {
    const a = makeCandidate({
      id: "a",
      visitTime: "2019-01-01T00:00:00.000Z",
    });
    const { rerender } = render(
      <ImportSwipeView
        candidates={[a]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText("Place a")).toBeInTheDocument();

    // A brand-new, much more recent candidate arrives — under a fresh
    // newest-first sort it would jump to the front, but the queue should
    // keep "a" in place and just append the newcomer.
    const c = makeCandidate({
      id: "c",
      visitTime: "2025-01-01T00:00:00.000Z",
    });
    rerender(
      <ImportSwipeView
        candidates={[a, c]}
        order="newest"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );

    expect(screen.getByText("Place a")).toBeInTheDocument();
  });

  it("calls onApprove/onReject with the current card's id", async () => {
    const a = makeCandidate({ id: "a" });
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportSwipeView
        candidates={[a]}
        order="newest"
        onApprove={onApprove}
        onReject={vi.fn()}
        onDefer={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith("a");
  });
});

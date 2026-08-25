import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportsGridView } from "./ImportsGridView";
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
    visitTime: "2020-06-01T00:00:00.000Z",
    note: null,
    status: "pending",
    ...overrides,
  };
}

describe("ImportsGridView", () => {
  it("shows the empty state when every bucket is empty", () => {
    render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[]}
        stillGeocoding={[]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );
    expect(
      screen.getByText("No candidates to review yet."),
    ).toBeInTheDocument();
  });

  it("groups needs-review candidates by year, collapsed by default", () => {
    const y2019 = makeCandidate({
      id: "a",
      visitTime: "2019-05-01T00:00:00.000Z",
    });
    const y2021 = makeCandidate({
      id: "b",
      visitTime: "2021-05-01T00:00:00.000Z",
    });
    render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[y2019, y2021]}
        stillGeocoding={[]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );

    expect(screen.getByText("2021 (1)")).toBeInTheDocument();
    expect(screen.getByText("2019 (1)")).toBeInTheDocument();
    // Collapsed by default — a <details> without `open` doesn't render its
    // content as accessible/visible via getByText for the (open) card.
    const yearDetails = screen.getByText("2021 (1)").closest("details");
    expect(yearDetails).not.toHaveAttribute("open");
  });

  it("shows a bulk-approve button for the high-confidence bucket and calls onBulkApproveHighConfidence", async () => {
    const high = [
      makeCandidate({ id: "h1", geocodeConfidence: "high" }),
      makeCandidate({ id: "h2", geocodeConfidence: "high" }),
    ];
    const onBulkApproveHighConfidence = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportsGridView
        highConfidence={high}
        needsReview={[]}
        stillGeocoding={[]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={onBulkApproveHighConfidence}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );

    expect(screen.getByText("2 ready to approve")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve all 2" }));
    expect(onBulkApproveHighConfidence).toHaveBeenCalled();
  });

  it("shows a still-geocoding count", () => {
    render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[]}
        stillGeocoding={[
          makeCandidate({ id: "g1", geocodeConfidence: null }),
          makeCandidate({ id: "g2", geocodeConfidence: null }),
        ]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );
    expect(screen.getByText("2 still geocoding…")).toBeInTheDocument();
  });

  it("calls onGeocodeRemaining from the geocode-remaining button, and disables it while in progress", async () => {
    const onGeocodeRemaining = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[]}
        stillGeocoding={[makeCandidate({ id: "g1", geocodeConfidence: null })]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={onGeocodeRemaining}
        isGeocodingRemaining={false}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Geocode remaining 1" }),
    );
    expect(onGeocodeRemaining).toHaveBeenCalled();

    rerender(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[]}
        stillGeocoding={[makeCandidate({ id: "g1", geocodeConfidence: null })]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={onGeocodeRemaining}
        isGeocodingRemaining={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Geocoding…" })).toBeDisabled();
  });

  it("shows a merge bar once 2+ cards are selected, and calls onMerge with survivor + losers", async () => {
    const a = makeCandidate({ id: "a", visitTime: "2020-01-01T00:00:00Z" });
    const b = makeCandidate({ id: "b", visitTime: "2020-02-01T00:00:00Z" });
    const onMerge = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[a, b]}
        stillGeocoding={[]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={vi.fn()}
        onMerge={onMerge}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );

    // Both fall in the same 2020 year group — open it to reach the cards.
    const yearDetails = screen.getByText("2020 (2)").closest("details")!;
    await user.click(within(yearDetails).getByText("2020 (2)"));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select Place a for merge"));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select Place b for merge"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Merge into one pin" }),
    );
    expect(onMerge).toHaveBeenCalledWith("a", ["b"]);
    // Selection clears after merging.
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("passes onSplit through to cards, scoped to the specific candidate", async () => {
    const a = makeCandidate({ id: "a" });
    const onSplit = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportsGridView
        highConfidence={[]}
        needsReview={[a]}
        stillGeocoding={[]}
        order="newest"
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
        onSplit={onSplit}
        onMerge={vi.fn()}
        onBulkApproveHighConfidence={vi.fn()}
        onGeocodeRemaining={vi.fn()}
        isGeocodingRemaining={false}
      />,
    );

    const yearDetails = screen.getByText("2020 (1)").closest("details")!;
    await user.click(within(yearDetails).getByText("2020 (1)"));
    await user.click(
      screen.getByRole("button", { name: "Split into separate pins" }),
    );
    await user.type(screen.getByLabelText("Split part 1 place name"), "Part A");
    await user.type(screen.getByLabelText("Split part 2 place name"), "Part B");
    await user.click(screen.getByRole("button", { name: "Confirm split" }));

    expect(onSplit).toHaveBeenCalledWith(a, [
      { placeName: "Part A" },
      { placeName: "Part B" },
    ]);
  });
});

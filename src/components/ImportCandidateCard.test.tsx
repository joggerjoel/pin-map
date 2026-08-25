import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportCandidateCard } from "./ImportCandidateCard";
import * as geocoderModule from "../lib/geocoder";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

vi.mock("../lib/geocoder", () => ({
  searchPlaces: vi.fn(),
}));

const geocodedCandidate: ImportCandidate = {
  id: "c1",
  externalKey: "key1",
  placeName: "Singapore, Singapore",
  suggestedLat: 1.35,
  suggestedLng: 103.82,
  geocodeConfidence: "high",
  visitTime: "2011-03-28T08:22:52.000Z",
  note: "Great trip",
  status: "pending",
};

const needsLocationCandidate: ImportCandidate = {
  ...geocodedCandidate,
  id: "c2",
  placeName: "Moontrekker Start Line",
  suggestedLat: null,
  suggestedLng: null,
  geocodeConfidence: "low",
  note: null,
};

describe("ImportCandidateCard", () => {
  it("shows the place name, date, note, and a 'located' badge when geocoded", () => {
    render(
      <ImportCandidateCard
        candidate={geocodedCandidate}
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Place name")).toHaveValue(
      "Singapore, Singapore",
    );
    expect(screen.getByText("located")).toBeInTheDocument();
    expect(screen.getByText("Great trip")).toBeInTheDocument();
  });

  it("shows a 'needs a location' badge and disables Approve when uncgeocoded", () => {
    render(
      <ImportCandidateCard
        candidate={needsLocationCandidate}
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(
      screen.getByText("needs a location — search above"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("calls onReject/onDefer/onApprove when their buttons are clicked", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onDefer = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportCandidateCard
        candidate={geocodedCandidate}
        mapboxToken="pk.test"
        onApprove={onApprove}
        onReject={onReject}
        onDefer={onDefer}
        onUpdate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onReject).toHaveBeenCalled();
    expect(onDefer).toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalled();
  });

  it("calls onUpdate with the edited name on blur", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportCandidateCard
        candidate={geocodedCandidate}
        mapboxToken="pk.test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDefer={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    const input = screen.getByLabelText("Place name");
    await user.clear(input);
    await user.type(input, "Singapore City");
    await user.tab();

    expect(onUpdate).toHaveBeenCalledWith({ placeName: "Singapore City" });
  });

  describe("search-as-you-type", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("shows suggestions after typing and debouncing, and applies one on click", async () => {
      vi.spyOn(geocoderModule, "searchPlaces").mockResolvedValue([
        {
          query: "moontrekker",
          name: "Moontrekker Course, Hong Kong",
          lat: 22.3,
          lng: 114.2,
        },
      ]);
      const onUpdate = vi.fn();
      const user = userEvent.setup({ delay: null });
      render(
        <ImportCandidateCard
          candidate={needsLocationCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={onUpdate}
        />,
      );

      const input = screen.getByLabelText("Place name");
      await user.clear(input);
      await user.type(input, "moontrekker");
      await vi.advanceTimersByTimeAsync(300);

      const suggestion = await screen.findByRole("button", {
        name: "Moontrekker Course, Hong Kong",
      });
      await user.click(suggestion);

      expect(onUpdate).toHaveBeenCalledWith({
        placeName: "Moontrekker Course, Hong Kong",
        suggestedLat: 22.3,
        suggestedLng: 114.2,
      });
    });

    it("does not fetch suggestions for a query under 2 characters", async () => {
      const searchSpy = vi.spyOn(geocoderModule, "searchPlaces");
      const user = userEvent.setup({ delay: null });
      render(
        <ImportCandidateCard
          candidate={needsLocationCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={vi.fn()}
        />,
      );

      const input = screen.getByLabelText("Place name");
      await user.clear(input);
      await user.type(input, "M");
      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).not.toHaveBeenCalled();
    });
  });
});

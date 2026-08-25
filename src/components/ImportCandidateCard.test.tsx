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

  it("links to a Google Maps search for the current place name, opening in a new tab", () => {
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

    const link = screen.getByRole("link", { name: "Open in Google Maps" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Singapore%2C%20Singapore",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("updates the Google Maps link as the place name is edited", async () => {
    const user = userEvent.setup();
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

    const nameInput = screen.getByLabelText("Place name");
    await user.clear(nameInput);
    await user.type(nameInput, "Sentosa Island");

    expect(
      screen.getByRole("link", { name: "Open in Google Maps" }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Sentosa%20Island",
    );
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
      screen.getByText("needs a location — search below"),
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
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
      // The dedicated search field clears after a selection — it's an
      // action field, not a persisted display value.
      expect(input).toHaveValue("");
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.clear(input);
      await user.type(input, "M");
      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).not.toHaveBeenCalled();
    });
  });

  describe("pasting a Google Maps link or coordinates into the search field", () => {
    it("shows a visible confirmation after a successful paste, since the field just clears otherwise", async () => {
      const user = userEvent.setup();
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

      expect(screen.queryByText("✓ Location set")).not.toBeInTheDocument();

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.click(input);
      await user.paste("22.35, 114.15");

      expect(screen.getByText("✓ Location set")).toBeInTheDocument();
    });

    it("sets coordinates from a pasted lat,lng pair and clears the search field", async () => {
      const onUpdate = vi.fn();
      const user = userEvent.setup();
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.click(input);
      await user.paste("22.35, 114.15");

      expect(onUpdate).toHaveBeenCalledWith({
        suggestedLat: 22.35,
        suggestedLng: 114.15,
        geocodeConfidence: "high",
      });
      expect(input).toHaveValue("");
      // The name field is untouched by a coordinate paste.
      expect(screen.getByLabelText("Place name")).toHaveValue(
        needsLocationCandidate.placeName,
      );
    });

    it("sets coordinates from a pasted Google Maps link", async () => {
      const onUpdate = vi.fn();
      const user = userEvent.setup();
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.click(input);
      await user.paste(
        "https://www.google.com/maps/search/?api=1&query=22.35,114.15",
      );

      expect(onUpdate).toHaveBeenCalledWith({
        suggestedLat: 22.35,
        suggestedLng: 114.15,
        geocodeConfidence: "high",
      });
    });

    it("does not fetch Mapbox suggestions when pasting coordinates", async () => {
      const searchSpy = vi.spyOn(geocoderModule, "searchPlaces");
      vi.useFakeTimers({ shouldAdvanceTime: true });
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.click(input);
      await user.paste("22.35, 114.15");
      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("does not apply coordinates prematurely while manually typing a partial pair", async () => {
      // Regression test: "22.35, 114.15" typed character by character
      // passes through "22.35, 1", which itself already matches the
      // lat,lng pattern — coordinate detection must not fire on every
      // keystroke, only on paste or once typing is finished (blur).
      const onUpdate = vi.fn();
      const user = userEvent.setup();
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.type(input, "22.35, 1");

      expect(onUpdate).not.toHaveBeenCalled();
      expect(input).toHaveValue("22.35, 1");
    });

    it("applies coordinates on blur once manual typing is complete", async () => {
      const onUpdate = vi.fn();
      const user = userEvent.setup();
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

      const input = screen.getByLabelText(
        "Search or paste a map link for this place",
      );
      await user.type(input, "22.35, 114.15");
      await user.tab();

      expect(onUpdate).toHaveBeenCalledWith({
        suggestedLat: 22.35,
        suggestedLng: 114.15,
        geocodeConfidence: "high",
      });
      expect(input).toHaveValue("");
    });
  });

  describe("split into separate pins", () => {
    it("is hidden entirely when onSplit isn't provided", () => {
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
      expect(
        screen.queryByText("Split into separate pins"),
      ).not.toBeInTheDocument();
    });

    it("reveals a form, and Confirm split is disabled with fewer than 2 filled parts", async () => {
      const onSplit = vi.fn();
      const user = userEvent.setup();
      render(
        <ImportCandidateCard
          candidate={geocodedCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={vi.fn()}
          onSplit={onSplit}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Split into separate pins" }),
      );

      expect(
        screen.getByRole("button", { name: "Confirm split" }),
      ).toBeDisabled();

      await user.type(
        screen.getByLabelText("Split part 1 place name"),
        "Start line",
      );
      expect(
        screen.getByRole("button", { name: "Confirm split" }),
      ).toBeDisabled();

      await user.type(
        screen.getByLabelText("Split part 2 place name"),
        "Finish line",
      );
      expect(
        screen.getByRole("button", { name: "Confirm split" }),
      ).toBeEnabled();
    });

    it("calls onSplit with the trimmed, non-empty parts and closes the form", async () => {
      const onSplit = vi.fn();
      const user = userEvent.setup();
      render(
        <ImportCandidateCard
          candidate={geocodedCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={vi.fn()}
          onSplit={onSplit}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Split into separate pins" }),
      );
      await user.type(
        screen.getByLabelText("Split part 1 place name"),
        "  Start line  ",
      );
      await user.type(
        screen.getByLabelText("Split part 2 place name"),
        "Finish line",
      );
      await user.click(
        screen.getByRole("button", { name: "Add another part" }),
      );
      // Third part left blank — should be dropped, not sent as an empty
      // placeName.
      await user.click(screen.getByRole("button", { name: "Confirm split" }));

      expect(onSplit).toHaveBeenCalledWith([
        { placeName: "Start line" },
        { placeName: "Finish line" },
      ]);
      expect(
        screen.queryByLabelText("Split part 1 place name"),
      ).not.toBeInTheDocument();
    });

    it("Cancel closes the form without calling onSplit", async () => {
      const onSplit = vi.fn();
      const user = userEvent.setup();
      render(
        <ImportCandidateCard
          candidate={geocodedCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={vi.fn()}
          onSplit={onSplit}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Split into separate pins" }),
      );
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onSplit).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Split into separate pins" }),
      ).toBeInTheDocument();
    });
  });

  describe("merge selection", () => {
    it("is hidden entirely when onToggleMergeSelect isn't provided", () => {
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
      expect(
        screen.queryByLabelText(/Select .* for merge/),
      ).not.toBeInTheDocument();
    });

    it("reflects isSelectedForMerge and calls onToggleMergeSelect when clicked", async () => {
      const onToggleMergeSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <ImportCandidateCard
          candidate={geocodedCandidate}
          mapboxToken="pk.test"
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onDefer={vi.fn()}
          onUpdate={vi.fn()}
          isSelectedForMerge={true}
          onToggleMergeSelect={onToggleMergeSelect}
        />,
      );

      const checkbox = screen.getByLabelText(
        "Select Singapore, Singapore for merge",
      );
      expect(checkbox).toBeChecked();

      await user.click(checkbox);
      expect(onToggleMergeSelect).toHaveBeenCalled();
    });
  });
});

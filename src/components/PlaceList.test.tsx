import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceList } from "./PlaceList";
import type { GeocodeResult } from "../lib/geocoder";

const paris: GeocodeResult = {
  query: "Paris",
  name: "Paris, France",
  lng: 2.35,
  lat: 48.86,
};

describe("PlaceList", () => {
  it("renders pinned place names", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        highlightedQuery={null}
      />,
    );
    expect(screen.getByText("Paris, France")).toBeInTheDocument();
  });

  it("calls onSelect with the query when a place name is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={onSelect}
        onRemove={vi.fn()}
        highlightedQuery={null}
      />,
    );

    await user.click(screen.getByText("Paris, France"));

    expect(onSelect).toHaveBeenCalledWith("Paris");
  });

  it("calls onRemove with the query when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={onRemove}
        highlightedQuery={null}
      />,
    );

    await user.click(screen.getByLabelText("Remove Paris, France"));

    expect(onRemove).toHaveBeenCalledWith("Paris");
  });

  it("shows a couldn't-find section only when there are failed lines", () => {
    const { rerender } = render(
      <PlaceList
        pinnedPlaces={[]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        highlightedQuery={null}
      />,
    );
    expect(screen.queryByText("Couldn't find")).not.toBeInTheDocument();

    rerender(
      <PlaceList
        pinnedPlaces={[]}
        failedLines={["Nowhereville"]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        highlightedQuery={null}
      />,
    );
    expect(screen.getByText("Couldn't find")).toBeInTheDocument();
    expect(screen.getByText("Nowhereville")).toBeInTheDocument();
  });

  it("adds a highlight class to the matching item", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        highlightedQuery="Paris"
      />,
    );
    const item = screen.getByText("Paris, France").closest("li");
    expect(item).toHaveClass("place-list__item--highlighted");
  });

  it("does not highlight anything when highlightedQuery is null", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        highlightedQuery={null}
      />,
    );
    const item = screen.getByText("Paris, France").closest("li");
    expect(item).not.toHaveClass("place-list__item--highlighted");
  });
});

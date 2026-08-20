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
      />,
    );
    expect(screen.queryByText("Couldn't find")).not.toBeInTheDocument();

    rerender(
      <PlaceList
        pinnedPlaces={[]}
        failedLines={["Nowhereville"]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Couldn't find")).toBeInTheDocument();
    expect(screen.getByText("Nowhereville")).toBeInTheDocument();
  });
});

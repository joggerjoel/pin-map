import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceList } from "./PlaceList";
import type { PinnedPlace } from "../hooks/useGeocoder";

const paris: PinnedPlace = {
  query: "Paris",
  name: "Paris, France",
  lng: 2.35,
  lat: 48.86,
};

const tokyo: PinnedPlace = {
  query: "Tokyo",
  name: "Tokyo, Japan",
  lng: 139.69,
  lat: 35.68,
};

describe("PlaceList", () => {
  it("renders pinned place names", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
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
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
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
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
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
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.queryByText("Couldn't find")).not.toBeInTheDocument();

    rerender(
      <PlaceList
        pinnedPlaces={[]}
        failedLines={["Nowhereville"]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
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
        onChangeTag={vi.fn()}
        highlightedQuery="Paris"
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    const item = screen.getByText("Paris, France").closest("li");
    expect(item).toHaveClass("place-list__item--highlighted");
  });

  it("expands the tag picker for a place when it becomes highlighted (e.g. its marker was clicked)", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery="Paris"
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Visited" })).toBeInTheDocument();
  });

  it("does not highlight anything when highlightedQuery is null", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    const item = screen.getByText("Paris, France").closest("li");
    expect(item).not.toHaveClass("place-list__item--highlighted");
  });

  it("expands a tag picker when a place name is clicked", async () => {
    const user = userEvent.setup();
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Visited" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Paris, France"));

    expect(screen.getByRole("button", { name: "Visited" })).toBeInTheDocument();
  });

  it("collapses the tag picker when the same place is clicked again", async () => {
    const user = userEvent.setup();
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Paris, France"));
    expect(screen.getByRole("button", { name: "Visited" })).toBeInTheDocument();

    await user.click(screen.getByText("Paris, France"));
    expect(
      screen.queryByRole("button", { name: "Visited" }),
    ).not.toBeInTheDocument();
  });

  it("calls onChangeTag with the picked tag and collapses the picker", async () => {
    const onChangeTag = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={onChangeTag}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Paris, France"));
    await user.click(screen.getByRole("button", { name: "Hometown" }));

    expect(onChangeTag).toHaveBeenCalledWith("Paris", { category: "hometown" });
    expect(
      screen.queryByRole("button", { name: "Hometown" }),
    ).not.toBeInTheDocument();
  });

  it("calls onChangeTag with a customTag payload when a custom swatch is picked", async () => {
    const onChangeTag = vi.fn();
    const user = userEvent.setup();
    const marathon = { id: "marathon", label: "Marathon", color: "#8b5cf6" };
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={onChangeTag}
        highlightedQuery={null}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Paris, France"));
    await user.click(screen.getByRole("button", { name: "Marathon" }));

    expect(onChangeTag).toHaveBeenCalledWith("Paris", { customTag: marathon });
  });

  it("calls onReorder with the dragged and target indexes on drop", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <PlaceList
        pinnedPlaces={[paris, tokyo]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={onReorder}
      />,
    );

    const handles = container.querySelectorAll(".place-list__drag-handle");
    expect(handles).toHaveLength(2);

    const dragStartEvent = new Event("dragstart", { bubbles: true });
    handles[0]?.dispatchEvent(dragStartEvent);

    const dropEvent = new Event("drop", { bubbles: true });
    handles[1]?.dispatchEvent(dropEvent);

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it("renders a Google Maps link with the place's exact coordinates", () => {
    render(
      <PlaceList
        pinnedPlaces={[paris]}
        failedLines={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onChangeTag={vi.fn()}
        highlightedQuery={null}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", {
      name: `View ${paris.name} on Google Maps`,
    });
    expect(link).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${paris.lat},${paris.lng}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
});

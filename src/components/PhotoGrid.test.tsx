import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoGrid } from "./PhotoGrid";
import type { UnsortedPhoto } from "../lib/photosRepository";

function photo(
  id: string,
  overrides: Partial<UnsortedPhoto> = {},
): UnsortedPhoto {
  return {
    id,
    storagePath: `user-1/${id}.jpg`,
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "image",
    label: null,
    placeQuery: null,
    skippedAt: null,
    caption: null,
    tags: null,
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    photos: [photo("p0")],
    isSelectMode: false,
    isSelected: vi.fn(() => false),
    onToggleSelect: vi.fn(),
    onOpenLightbox: vi.fn(),
    onMoreLikeThis: vi.fn(),
    showRemoveButton: false,
    ...overrides,
  };
}

describe("PhotoGrid", () => {
  it("shows no checkbox outside select mode, and one per card inside it", () => {
    const { rerender } = render(
      <PhotoGrid {...baseProps({ isSelectMode: false })} />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    rerender(<PhotoGrid {...baseProps({ isSelectMode: true })} />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("clicking the checkbox calls onToggleSelect with the photo id", () => {
    const onToggleSelect = vi.fn();
    render(
      <PhotoGrid {...baseProps({ isSelectMode: true, onToggleSelect })} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleSelect).toHaveBeenCalledWith("p0");
  });

  it("hides 'More like this' entirely when caption is null", () => {
    render(
      <PhotoGrid
        {...baseProps({ photos: [photo("p0", { caption: null })] })}
      />,
    );
    expect(screen.queryByText("More like this")).not.toBeInTheDocument();
  });

  it("shows 'More like this' when caption is set, and it triggers onMoreLikeThis", () => {
    const onMoreLikeThis = vi.fn();
    const p = photo("p0", { caption: "a cat" });
    render(<PhotoGrid {...baseProps({ photos: [p], onMoreLikeThis })} />);
    fireEvent.click(screen.getByText("More like this"));
    expect(onMoreLikeThis).toHaveBeenCalledWith(p);
  });

  it("shows a remove button only when showRemoveButton is true", () => {
    const { rerender } = render(
      <PhotoGrid {...baseProps({ showRemoveButton: false })} />,
    );
    expect(screen.queryByText("×")).not.toBeInTheDocument();

    const onRemove = vi.fn();
    const p = photo("p0");
    rerender(
      <PhotoGrid
        {...baseProps({ photos: [p], showRemoveButton: true, onRemove })}
      />,
    );
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledWith(p);
  });

  it("shows the placeQuery only for an assigned photo", () => {
    const { rerender } = render(
      <PhotoGrid
        {...baseProps({ photos: [photo("p0", { placeQuery: null })] })}
      />,
    );
    expect(screen.queryByText("Paris")).not.toBeInTheDocument();

    rerender(
      <PhotoGrid
        {...baseProps({ photos: [photo("p0", { placeQuery: "Paris" })] })}
      />,
    );
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("falls back to the id prefix when label is null", () => {
    render(
      <PhotoGrid
        {...baseProps({
          photos: [photo("11111111-abcd", { label: null })],
        })}
      />,
    );
    expect(screen.getByText("11111111")).toBeInTheDocument();
  });
});

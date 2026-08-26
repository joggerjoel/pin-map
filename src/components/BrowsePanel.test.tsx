import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsePanel } from "./BrowsePanel";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { PhotoGroup, UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";

vi.mock("../lib/photosRepository", () => ({
  PHOTO_TAG_TAXONOMY: [
    "landscape",
    "people",
    "screenshot",
    "document",
    "food",
    "animal",
    "other",
  ],
  fetchAllPhotos: vi.fn(),
  fetchAllPhotosCount: vi.fn(),
  fetchGroups: vi.fn(),
  addPhotosToGroup: vi.fn(),
  findSimilarPhotos: vi.fn(),
  unsortedPhotoUrl: vi.fn(
    (photo: UnsortedPhoto, variant: string) =>
      `https://cdn.example.com/${photo.storagePath}?${variant}`,
  ),
}));

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

function group(id: string, name: string): PhotoGroup {
  return { id, name, createdAt: "2026-01-01T00:00:00.000Z", memberCount: 0 };
}

const pinnedPlaces: PinnedPlace[] = [];

function baseProps() {
  return {
    userId: "user-1",
    pinnedPlaces,
    canCreatePin: true,
    onPinPlace: vi.fn(),
    onOpenLightbox: vi.fn(),
    onClose: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([]);
  vi.mocked(photosRepositoryModule.fetchAllPhotosCount).mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrowsePanel", () => {
  it("shows photos across all statuses (no status filter applied)", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0", { placeQuery: "Paris" }),
      photo("p1", { skippedAt: "2026-01-01T00:00:00Z" }),
      photo("p2"),
    ]);
    render(<BrowsePanel {...baseProps()} />);

    expect(await screen.findByText("Paris")).toBeInTheDocument();
    expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ tag: undefined, groupId: undefined }),
    );
  });

  it("clicking a tag chip re-fetches with that tag", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalled(),
    );
    await user.click(screen.getByRole("button", { name: "animal" }));

    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: "animal" }),
      ),
    );
  });

  it("selecting a group from the dropdown re-fetches with that groupId, composing with the tag filter", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland"),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await user.click(await screen.findByRole("button", { name: "food" }));
    await user.selectOptions(
      await screen.findByLabelText("Filter by group"),
      "g1",
    );

    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: "food", groupId: "g1" }),
      ),
    );
  });

  it("Select mode + Add to group calls addPhotosToGroup with the selection", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland"),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0"),
      photo("p1"),
    ]);
    vi.mocked(photosRepositoryModule.addPhotosToGroup).mockResolvedValue({
      added: 2,
    });
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.selectOptions(screen.getByLabelText("Add to group"), "g1");

    await waitFor(() =>
      expect(photosRepositoryModule.addPhotosToGroup).toHaveBeenCalledWith(
        "g1",
        ["p0", "p1"],
      ),
    );
  });

  it("a mixed-status selection offers no triage-status action", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0", { placeQuery: "Paris" }),
      photo("p1"),
    ]);
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).not.toHaveTextContent("Assign");
    expect(toolbar).not.toHaveTextContent("Unassign");
  });

  it("'More like this' switches into similar-photos mode", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0", { caption: "a cat" }),
    ]);
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue([
      photo("p1"),
      photo("p2"),
    ]);
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await user.click(await screen.findByText("More like this"));

    expect(
      await screen.findByText(/Showing 2 of 2 similar photos/),
    ).toBeInTheDocument();
  });

  it("shows filter-aware empty-state copy when a filter matches nothing", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<BrowsePanel {...baseProps()} />);
    await waitFor(() =>
      expect(screen.getByText("No photos yet.")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "food" }));
    expect(
      await screen.findByText("No photos match this filter."),
    ).toBeInTheDocument();
  });
});

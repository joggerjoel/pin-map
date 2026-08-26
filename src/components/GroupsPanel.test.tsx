import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsPanel } from "./GroupsPanel";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { PhotoGroup, UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";

vi.mock("../lib/photosRepository", () => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  fetchAllPhotos: vi.fn(),
  fetchAllPhotosCount: vi.fn(),
  fetchGroups: vi.fn(),
  removePhotosFromGroup: vi.fn(),
  findSimilarPhotos: vi.fn(),
  unsortedPhotoUrl: vi.fn(
    (photo: UnsortedPhoto, variant: string) =>
      `https://cdn.example.com/${photo.storagePath}?${variant}`,
  ),
}));

function group(id: string, name: string, memberCount = 0): PhotoGroup {
  return { id, name, createdAt: "2026-01-01T00:00:00.000Z", memberCount };
}

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
  vi.mocked(photosRepositoryModule.fetchAllPhotosCount).mockResolvedValue(0);
  // useAllPhotos runs unconditionally (it's a hook), even while the list
  // view is showing and activeGroupId is null -- default it so list-view
  // tests that never open a group don't have to stub it themselves.
  vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroupsPanel list view", () => {
  it("a failed fetch shows an error with retry, not an infinite Loading state", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValueOnce(null);
    render(<GroupsPanel {...baseProps()} />);

    expect(
      await screen.findByText("Couldn't load groups."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValueOnce([
      group("g1", "Iceland", 0),
    ]);
    await userEvent.setup().click(screen.getByText("Try again"));
    expect(await screen.findByText("Iceland (0)")).toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([]);
    render(<GroupsPanel {...baseProps()} />);

    expect(
      await screen.findByText("No groups yet — create one above."),
    ).toBeInTheDocument();
  });

  it("lists groups with name and member count", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 4),
    ]);
    render(<GroupsPanel {...baseProps()} />);

    expect(await screen.findByText("Iceland (4)")).toBeInTheDocument();
  });

  it("creating a group calls createGroup and refreshes the list", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([group("g1", "Japan", 0)]);
    vi.mocked(photosRepositoryModule.createGroup).mockResolvedValue(
      group("g1", "Japan", 0),
    );
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await screen.findByText("No groups yet — create one above.");

    await user.type(screen.getByPlaceholderText("New group name"), "Japan");
    await user.click(screen.getByText("Create group"));

    await waitFor(() =>
      expect(photosRepositoryModule.createGroup).toHaveBeenCalledWith(
        "user-1",
        "Japan",
      ),
    );
    expect(await screen.findByText("Japan (0)")).toBeInTheDocument();
  });

  it("shows a notice when the group cap is hit", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([]);
    vi.mocked(photosRepositoryModule.createGroup).mockResolvedValue("limit");
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await screen.findByText("No groups yet — create one above.");
    await user.type(screen.getByPlaceholderText("New group name"), "One more");
    await user.click(screen.getByText("Create group"));

    expect(
      await screen.findByText("Group limit reached (200 per account)."),
    ).toBeInTheDocument();
  });

  it("deleting a group calls deleteGroup and refreshes the list", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups)
      .mockResolvedValueOnce([group("g1", "Iceland", 0)])
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.deleteGroup).mockResolvedValue("ok");
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await screen.findByText("Iceland (0)");
    await user.click(screen.getByLabelText("Delete group Iceland"));

    await waitFor(() =>
      expect(photosRepositoryModule.deleteGroup).toHaveBeenCalledWith("g1"),
    );
    expect(
      await screen.findByText("No groups yet — create one above."),
    ).toBeInTheDocument();
  });
});

describe("GroupsPanel member view", () => {
  it("opening a group shows its members via the group-filtered fetch", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 1),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await user.click(await screen.findByText("Iceland (1)"));

    expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ groupId: "g1" }),
    );
    expect(await screen.findByText("Iceland")).toBeInTheDocument();
  });

  it("the per-card × removes a single photo via removePhotosFromGroup", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 1),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    vi.mocked(photosRepositoryModule.removePhotosFromGroup).mockResolvedValue({
      removed: 1,
    });
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await user.click(await screen.findByText("Iceland (1)"));
    await user.click(
      await screen.findByLabelText("Remove photo p0 from group"),
    );

    await waitFor(() =>
      expect(photosRepositoryModule.removePhotosFromGroup).toHaveBeenCalledWith(
        "g1",
        ["p0"],
      ),
    );
  });

  it("Select mode + Remove from group bulk-removes the selection", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 2),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0"),
      photo("p1"),
    ]);
    vi.mocked(photosRepositoryModule.removePhotosFromGroup).mockResolvedValue({
      removed: 2,
    });
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await user.click(await screen.findByText("Iceland (2)"));
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByText("Remove from group"));

    await waitFor(() =>
      expect(photosRepositoryModule.removePhotosFromGroup).toHaveBeenCalledWith(
        "g1",
        ["p0", "p1"],
      ),
    );
  });

  it("'Back to My Groups' returns to the list view", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 0),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await user.click(await screen.findByText("Iceland (0)"));
    await user.click(await screen.findByText("‹ My Groups"));

    expect(await screen.findByText("My Groups")).toBeInTheDocument();
  });

  it("'More like this' switches into similar-photos mode with a Back control", async () => {
    vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([
      group("g1", "Iceland", 1),
    ]);
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0", { caption: "a cat" }),
    ]);
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue([
      photo("p1"),
    ]);
    const user = userEvent.setup();

    render(<GroupsPanel {...baseProps()} />);
    await user.click(await screen.findByText("Iceland (1)"));
    await user.click(await screen.findByText("More like this"));

    expect(
      await screen.findByText(/Showing 1 of 1 similar photos/),
    ).toBeInTheDocument();
    await user.click(screen.getByText("‹ Back"));
    expect(screen.getByText("p0")).toBeInTheDocument();
  });
});

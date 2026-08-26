import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsortedPhotosPanel } from "./UnsortedPhotosPanel";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";

vi.mock("../lib/photosRepository", () => ({
  fetchUnsortedPhotos: vi.fn(),
  fetchUnsortedPhotoCount: vi.fn(),
  assignPhotoPlace: vi.fn(),
  skipPhoto: vi.fn(),
  unskipPhoto: vi.fn(),
  unassignPhoto: vi.fn(),
  setPhotoLabel: vi.fn(),
  fetchGroups: vi.fn(),
  createGroup: vi.fn(),
  addPhotosToGroup: vi.fn(),
  removePhotosFromGroup: vi.fn(),
  findSimilarPhotos: vi.fn(),
  PHOTO_LABEL_MAX_LENGTH: 100,
  PHOTO_TAG_TAXONOMY: [
    "landscape",
    "people",
    "screenshot",
    "document",
    "food",
    "animal",
    "other",
  ],
  unsortedPhotoUrl: vi.fn(
    (photo: UnsortedPhoto, variant: string) =>
      `https://cdn.example.com/${photo.storagePath}?${variant}`,
  ),
}));

beforeEach(() => {
  // Tab-count badges aren't what most of these tests are about — default
  // them to a settled value so every test doesn't have to stub it just to
  // avoid an unresolved promise.
  vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
    0,
  );
  // Same reasoning for the "My Groups" fetch the panel now issues on mount.
  vi.mocked(photosRepositoryModule.fetchGroups).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function photo(
  id: string,
  kind: "image" | "video" = "image",
  label: string | null = null,
  placeQuery: string | null = null,
): UnsortedPhoto {
  return {
    id,
    storagePath: `user-1/${id}.${kind === "video" ? "mp4" : "jpg"}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    kind,
    label,
    placeQuery,
    skippedAt: null,
    caption: null,
    tags: null,
  };
}

const pinnedPlaces: PinnedPlace[] = [
  { query: "Paris", name: "Paris, France", lat: 48.86, lng: 2.35 },
];

function baseProps() {
  return {
    userId: "user-1",
    pinnedPlaces,
    canCreatePin: true,
    onPinPlace: vi.fn(),
    onOpenLightbox: vi.fn(),
    onAssigned: vi.fn(),
    onEmpty: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("UnsortedPhotosPanel", () => {
  it("shows a loading state during isInitialLoading", () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockReturnValue(
      new Promise(() => {}),
    );

    render(<UnsortedPhotosPanel {...baseProps()} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "‹ Back to places" }),
    ).toBeInTheDocument();
  });

  it("shows the retry notice on photosLoadError and retry() re-fires the load", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([photo("p0")]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);

    expect(
      await screen.findByText("Couldn't load unsorted photos."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't load unsorted photos."),
      ).not.toBeInTheDocument(),
    );
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(2);
  });

  it("shows 'All caught up' and calls onEmpty when confirmed empty", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);
    const props = baseProps();

    render(<UnsortedPhotosPanel {...props} />);

    expect(
      await screen.findByText("All caught up — nothing left to triage."),
    ).toBeInTheDocument();
    expect(props.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("renders a page of thumbnails; video items render as <video>", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "image"),
      photo("p1", "video"),
    ]);

    render(<UnsortedPhotosPanel {...baseProps()} />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(
      screen.getByRole("button", { name: /Preview unsorted photo/ }),
    ).toBeInTheDocument();
    // Video card has no separate Preview button — only Assign.
    expect(
      screen.getByRole("button", { name: /Assign unsorted video/ }),
    ).toBeInTheDocument();
    // A visible, stable per-card label so a person can reference a
    // specific photo when reporting a problem.
    expect(screen.getByText("p0")).toBeInTheDocument();
    expect(screen.getByText("p1")).toBeInTheDocument();
  });

  it("clicking a card's ID label copies the full ID to the clipboard", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<UnsortedPhotosPanel {...baseProps()} />);
    // fireEvent, not userEvent, for this one: userEvent's pointer-position
    // machinery misses this button in jsdom (zero-size bounding rect with
    // no real layout engine) -- confirmed as a testing-library/jsdom
    // interaction quirk, not an app bug (fireEvent.click and a real browser
    // both fire it correctly; only userEvent's synthetic pointer sequence
    // doesn't).
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy photo ID p0" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("p0"));
    expect(await screen.findByText("Copied p0")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("clicking Preview calls onOpenLightbox with the untransformed URL", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await screen.findByRole("button", { name: /Preview/ });

    await user.click(screen.getByRole("button", { name: /Preview/ }));

    expect(props.onOpenLightbox).toHaveBeenCalledWith(
      "https://cdn.example.com/user-1/p0.jpg?full",
      "p0.jpg",
    );
  });

  it("selecting an existing match assigns, removes the photo, and calls onAssigned", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0")])
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValue("ok");
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Par");
    await user.click(screen.getByRole("button", { name: "Paris" }));

    await waitFor(() => expect(props.onAssigned).toHaveBeenCalledTimes(1));
    expect(photosRepositoryModule.assignPhotoPlace).toHaveBeenCalledWith(
      "p0",
      "Paris",
    );
    expect(await screen.findByText("Saved")).toHaveAttribute("role", "status");
  });

  it("the create-new-pin path calls onPinPlace then assign and removes the photo on success", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValue("ok");
    const props = baseProps();
    vi.mocked(props.onPinPlace).mockResolvedValue({
      status: "ok",
      query: "Tokyo",
    });
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Tokyo");
    await user.click(
      screen.getByRole("button", { name: 'Create new pin: "Tokyo"' }),
    );

    await waitFor(() =>
      expect(photosRepositoryModule.assignPhotoPlace).toHaveBeenCalledWith(
        "p0",
        "Tokyo",
      ),
    );
    expect(props.onPinPlace).toHaveBeenCalledWith(
      "Tokyo",
      expect.objectContaining({ kind: "category" }),
    );
  });

  it("a null result from onPinPlace shows its own inline error without attempting assign", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    const props = baseProps();
    vi.mocked(props.onPinPlace).mockResolvedValue({
      status: "geocode-error",
    });
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Nowhere");
    await user.click(
      screen.getByRole("button", { name: 'Create new pin: "Nowhere"' }),
    );

    expect(
      await screen.findByText("Couldn't create that pin — try again."),
    ).toBeInTheDocument();
    expect(photosRepositoryModule.assignPhotoPlace).not.toHaveBeenCalled();
  });

  it("an 'error' from assign shows its own inline error and keeps the photo", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValue(
      "error",
    );
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Par");
    await user.click(screen.getByRole("button", { name: "Paris" }));

    expect(
      await screen.findByText("Couldn't save — try again."),
    ).toBeInTheDocument();
    expect(props.onAssigned).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("canCreatePin: false disables Create new pin while existing-pin matches still work", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    const props = { ...baseProps(), canCreatePin: false };
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Anywhere");

    expect(
      screen.getByRole("button", { name: 'Create new pin: "Anywhere"' }),
    ).toBeDisabled();
  });

  it("the '‹ Back to places' control is always present and calls onClose", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockReturnValue(
      new Promise(() => {}),
    );
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "‹ Back to places" }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Skip persists via skipPhoto, removes the photo, and doesn't touch assign", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0"), photo("p1")])
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValue("ok");
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );

    await user.click(
      screen.getAllByRole("button", { name: /Skip unsorted photo/ })[0],
    );

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    expect(photosRepositoryModule.skipPhoto).toHaveBeenCalledWith("p0");
    expect(photosRepositoryModule.assignPhotoPlace).not.toHaveBeenCalled();
    expect(props.onAssigned).not.toHaveBeenCalled();
    // findByText("Skipped") collides with the Skipped tab's bare label text
    // node, so scope this to the notice via its role instead.
    expect(await screen.findByRole("status")).toHaveTextContent("Skipped");
  });

  it("a failed skip shows a notice and keeps the photo", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValue("error");
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Skip unsorted photo/ }),
    );

    expect(
      await screen.findByText("Couldn't skip — try again."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("Skip on a video card works too and collapses an expanded row", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "video"),
    ]);
    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValue("ok");
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted video/ }),
    );
    expect(screen.getByPlaceholderText("Place name")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Skip unsorted video/ }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument(),
    );
    expect(screen.queryByPlaceholderText("Place name")).not.toBeInTheDocument();
  });

  it("switching tabs re-fetches with the new status and shows tab-appropriate actions", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0")]) // unassigned (initial)
      .mockResolvedValueOnce([photo("p1")]); // skipped (after tab switch)
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Assign unsorted photo/ }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: /Skipped/ }));

    await waitFor(() =>
      expect(
        photosRepositoryModule.fetchUnsortedPhotos,
      ).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ status: "skipped" }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: /Move unsorted photo back/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Assign unsorted photo/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Skip unsorted photo/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Skipped/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("the Assigned tab shows the place and an Unassign action, but no Assign/Skip/rename", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0")]) // unassigned (initial)
      .mockResolvedValueOnce([photo("p1", "image", null, "Paris")]); // assigned
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByRole("button", { name: /Assign unsorted photo/ });

    await user.click(screen.getByRole("tab", { name: /Assigned/ }));

    await screen.findByRole("button", { name: /Preview unsorted photo/ });
    expect(screen.getByText("Paris")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Unassign photo/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Assign unsorted photo/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Skip unsorted photo/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Move unsorted photo back/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rename photo/ }),
    ).not.toBeInTheDocument();
  });

  it("Unassign on the Assigned tab calls unassignPhoto and removes the photo from view", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([]) // unassigned (initial)
      .mockResolvedValueOnce([photo("p0", "image", null, "Paris")]); // assigned
    vi.mocked(photosRepositoryModule.unassignPhoto).mockResolvedValue("ok");
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("All caught up — nothing left to triage.");

    await user.click(screen.getByRole("tab", { name: /Assigned/ }));
    await user.click(
      await screen.findByRole("button", { name: /Unassign photo/ }),
    );

    expect(photosRepositoryModule.unassignPhoto).toHaveBeenCalledWith("p0");
    await waitFor(() =>
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument(),
    );
  });

  it("Unskip on the Skipped tab calls unskipPhoto and removes the photo from view", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([]) // unassigned (initial)
      .mockResolvedValueOnce([photo("p0")]); // skipped
    vi.mocked(photosRepositoryModule.unskipPhoto).mockResolvedValue("ok");
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("All caught up — nothing left to triage.");

    await user.click(screen.getByRole("tab", { name: /Skipped/ }));
    await user.click(
      await screen.findByRole("button", {
        name: /Move unsorted photo back/,
      }),
    );

    expect(photosRepositoryModule.unskipPhoto).toHaveBeenCalledWith("p0");
    await waitFor(() =>
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument(),
    );
  });

  it("switching tabs clears an in-progress Assign expansion", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0")])
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    expect(screen.getByPlaceholderText("Place name")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Skipped/ }));

    expect(screen.queryByPlaceholderText("Place name")).not.toBeInTheDocument();
  });

  it("auto-loads the next page when the load-more sentinel intersects the viewport", async () => {
    const observedCallbacks: IntersectionObserverCallback[] = [];
    class ControllableIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observedCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", ControllableIntersectionObserver);

    const fullPage = Array.from({ length: 60 }, (_, i) => photo(`p${i}`));
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([photo("extra")]);

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await waitFor(() => expect(observedCallbacks.length).toBeGreaterThan(0));

    act(() => {
      for (const callback of observedCallbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }
    });

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
  });

  it("closing/unmounting mid-assign produces no further updates once the pending call resolves", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    let resolveAssign: (value: "ok") => void = () => {};
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockReturnValue(
      new Promise((resolve) => {
        resolveAssign = resolve;
      }),
    );
    const props = baseProps();
    const user = userEvent.setup();

    const { unmount } = render(<UnsortedPhotosPanel {...props} />);
    await user.click(
      await screen.findByRole("button", { name: /Assign unsorted photo/ }),
    );
    await user.type(screen.getByPlaceholderText("Place name"), "Par");
    await user.click(screen.getByRole("button", { name: "Paris" }));

    unmount();

    // Resolving after unmount must not throw or warn about a state update
    // on an unmounted component — the mountedRef guard is what prevents it.
    await act(async () => {
      resolveAssign("ok");
      await Promise.resolve();
    });
  });

  it("shows the custom label instead of the id prefix once one is set", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "image", "the beach one"),
    ]);

    render(<UnsortedPhotosPanel {...baseProps()} />);

    expect(await screen.findByText("the beach one")).toBeInTheDocument();
    expect(screen.queryByText("p0")).not.toBeInTheDocument();
  });

  it("renaming a photo: pencil opens a prefilled input, Enter saves it", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "image", "old name"),
    ]);
    vi.mocked(photosRepositoryModule.setPhotoLabel).mockResolvedValue("ok");
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(
      await screen.findByRole("button", { name: "Rename photo p0" }),
    );

    const input = screen.getByDisplayValue("old name");
    await user.clear(input);
    await user.type(input, "new name{Enter}");

    await waitFor(() =>
      expect(photosRepositoryModule.setPhotoLabel).toHaveBeenCalledWith(
        "p0",
        "new name",
      ),
    );
    expect(await screen.findByText("new name")).toBeInTheDocument();
    expect(await screen.findByText("Renamed")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("Escape cancels a rename without saving", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "image", "old name"),
    ]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(
      await screen.findByRole("button", { name: "Rename photo p0" }),
    );
    const input = screen.getByDisplayValue("old name");
    await user.type(input, " more{Escape}");

    expect(photosRepositoryModule.setPhotoLabel).not.toHaveBeenCalled();
    expect(await screen.findByText("old name")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/old name/)).not.toBeInTheDocument();
  });

  it("a failed rename shows a notice", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    vi.mocked(photosRepositoryModule.setPhotoLabel).mockResolvedValue("error");
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(
      await screen.findByRole("button", { name: "Rename photo p0" }),
    );
    await user.type(screen.getByRole("textbox"), "x{Enter}");

    expect(
      await screen.findByText("Couldn't rename — try again."),
    ).toBeInTheDocument();
  });
});

describe("UnsortedPhotosPanel tag filter", () => {
  it("clicking a tag chip re-fetches with that tag, narrowing the active tab", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("All caught up — nothing left to triage.");

    await user.click(screen.getByRole("button", { name: "animal" }));

    await waitFor(() =>
      expect(
        photosRepositoryModule.fetchUnsortedPhotos,
      ).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ status: "unassigned", tag: "animal" }),
      ),
    );
  });

  it("the 'Untagged' chip filters via the reserved 'untagged' value", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("All caught up — nothing left to triage.");

    await user.click(screen.getByRole("button", { name: "Untagged" }));

    await waitFor(() =>
      expect(
        photosRepositoryModule.fetchUnsortedPhotos,
      ).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: "untagged" }),
      ),
    );
  });

  it("clicking 'All' after a chip clears the tag filter", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("All caught up — nothing left to triage.");
    await user.click(screen.getByRole("button", { name: "food" }));
    await user.click(screen.getByRole("button", { name: "All" }));

    await waitFor(() =>
      expect(
        photosRepositoryModule.fetchUnsortedPhotos,
      ).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: undefined }),
      ),
    );
  });
});

describe("UnsortedPhotosPanel mass actions", () => {
  it("Select mode shows a checkbox per card; toggling one selects it", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
      photo("p1"),
    ]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    await user.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("a homogeneous all-unassigned selection offers Assign and Skip, and Mass Skip calls skipPhoto per selected photo", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
      photo("p1"),
    ]);
    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValue("ok");
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    // Disambiguate from the per-card "Skip" buttons that already exist on
    // each unassigned card -- only the toolbar's own Skip button lives
    // inside role="toolbar".
    const toolbar = within(screen.getByRole("toolbar"));
    await user.click(toolbar.getByText("Skip"));

    await waitFor(() =>
      expect(photosRepositoryModule.skipPhoto).toHaveBeenCalledTimes(2),
    );
    expect(photosRepositoryModule.skipPhoto).toHaveBeenCalledWith("p0");
    expect(photosRepositoryModule.skipPhoto).toHaveBeenCalledWith("p1");
  });

  it("'Select all N' walks every page via fetchUnsortedPhotos, not just the on-screen page", async () => {
    const manyPhotos = Array.from({ length: 3 }, (_, i) => photo(`p${i}`));
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(manyPhotos)
      .mockResolvedValueOnce(manyPhotos) // walkAllPages' own first page
      .mockResolvedValueOnce([]); // walkAllPages exhausts on a short page
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      3,
    );
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);

    await waitFor(() =>
      expect(screen.getByText("Select all 3")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Select all 3"));

    await waitFor(() =>
      expect(screen.getByText("3 selected")).toBeInTheDocument(),
    );
  });

  it("mixed-status selection is impossible from within one tab (each tab is single-status)", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "image", null, null),
    ]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await screen.findByText("p0");
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getAllByRole("checkbox")[0]);

    // Single-tab selections are always homogeneous by construction (the
    // fetch itself is status-filtered), so exactly one triage action shows.
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveTextContent("Assign");
    expect(toolbar).not.toHaveTextContent("Unskip");
    expect(toolbar).not.toHaveTextContent("Unassign");
  });
});

describe("UnsortedPhotosPanel more like this", () => {
  it("hides the link entirely when caption is null", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0"),
    ]);
    render(<UnsortedPhotosPanel {...baseProps()} />);

    await screen.findByText("p0");
    expect(screen.queryByText("More like this")).not.toBeInTheDocument();
  });

  it("clicking 'More like this' switches into similar-photos mode, filtered to the active tab's status", async () => {
    const captioned: UnsortedPhoto = {
      ...photo("p0"),
      caption: "a cat",
    };
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      captioned,
    ]);
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue([
      { ...photo("p1"), placeQuery: null, skippedAt: null }, // unassigned: matches
      { ...photo("p2"), placeQuery: "Paris" }, // assigned: filtered out
    ]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(await screen.findByText("More like this"));

    expect(
      await screen.findByText(/Showing 1 of 2 similar photos/),
    ).toBeInTheDocument();
    expect(photosRepositoryModule.findSimilarPhotos).toHaveBeenCalledWith("p0");
  });

  it("'Back to Unassigned' exits similar-photos mode", async () => {
    const captioned: UnsortedPhoto = { ...photo("p0"), caption: "a cat" };
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      captioned,
    ]);
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...baseProps()} />);
    await user.click(await screen.findByText("More like this"));
    await screen.findByText(/Showing 0 of 0 similar photos/);

    await user.click(screen.getByText("‹ Back to Unassigned"));
    expect(await screen.findByText("p0")).toBeInTheDocument();
  });
});

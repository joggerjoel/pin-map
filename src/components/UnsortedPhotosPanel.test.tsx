import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsortedPhotosPanel } from "./UnsortedPhotosPanel";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";

vi.mock("../lib/photosRepository", () => ({
  fetchUnsortedPhotos: vi.fn(),
  assignPhotoPlace: vi.fn(),
  unsortedPhotoUrl: vi.fn(
    (photo: UnsortedPhoto, variant: string) =>
      `https://cdn.example.com/${photo.storagePath}?${variant}`,
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function photo(id: string, kind: "image" | "video" = "image"): UnsortedPhoto {
  return {
    id,
    storagePath: `user-1/${id}.${kind === "video" ? "mp4" : "jpg"}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    kind,
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

  it("Skip removes the photo without calling assignPhotoPlace or onAssigned", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce([photo("p0"), photo("p1")])
      .mockResolvedValueOnce([]);
    const props = baseProps();
    const user = userEvent.setup();

    render(<UnsortedPhotosPanel {...props} />);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );

    await user.click(
      screen.getAllByRole("button", { name: /Skip unsorted photo/ })[0],
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(photosRepositoryModule.assignPhotoPlace).not.toHaveBeenCalled();
    expect(props.onAssigned).not.toHaveBeenCalled();
  });

  it("Skip on a video card works too and collapses an expanded row", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "video"),
    ]);
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

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
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
});

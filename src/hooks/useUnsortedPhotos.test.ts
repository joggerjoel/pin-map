import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsortedPhotos } from "./useUnsortedPhotos";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  fetchUnsortedPhotos: vi.fn(),
  assignPhotoPlace: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function photo(id: string, createdAt: string): UnsortedPhoto {
  return { id, storagePath: `user-1/${id}.jpg`, createdAt, kind: "image" };
}

describe("useUnsortedPhotos", () => {
  it("isInitialLoading is true until the first page settles, and blocks loadMore/retry", async () => {
    let resolveFirst: (value: UnsortedPhoto[] | null) => void = () => {};
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    expect(result.current.isInitialLoading).toBe(true);

    act(() => {
      result.current.loadMore();
      result.current.retry();
    });
    // Still only the initial call — loadMore/retry no-op during initial load.
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst([]);
      await Promise.resolve();
    });
    expect(result.current.isInitialLoading).toBe(false);
  });

  it("a null first-page result sets photosLoadError without populating photos", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue(
      null,
    );

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.photosLoadError).toBe(true);
    expect(result.current.photos).toEqual([]);
  });

  it("retry() re-runs the initial load", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValueOnce(
      null,
    );
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photosLoadError).toBe(true));

    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValueOnce(
      [photo("1", "2026-01-01T00:00:00.000Z")],
    );
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.photosLoadError).toBe(false));
    expect(result.current.photos).toHaveLength(1);
  });

  it("loadMore appends using the tracked cursor and respects hasMore, including after every loaded photo is assigned away", async () => {
    const page1 = Array.from({ length: 2 }, (_, i) =>
      photo(`p${i}`, `2026-01-0${i + 1}T00:00:00.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([photo("p2", "2026-01-03T00:00:00.000Z")]);

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.hasMore).toBe(false); // short page (2 < default 60)

    // Assign both away; since hasMore is false, no auto-refill should fire.
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValue("ok");
    await act(async () => {
      await result.current.assign(page1[0], "Paris");
      await result.current.assign(page1[1], "Paris");
    });
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(1);
    expect(result.current.photos).toEqual([]);
  });

  it("assigning away the last loaded photo while hasMore is true auto-triggers exactly one refill", async () => {
    const fullPage = Array.from({ length: 60 }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValue("ok");

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    for (const p of fullPage) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.assign(p, "Paris");
      });
    }

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(result.current.photos).toEqual([]);
  });

  it("a loadMore failure sets loadMoreError without changing hasMore or the cursor, and a later success clears it", async () => {
    const page1 = [photo("p0", "2026-01-01T00:00:00.000Z")];
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(
        Array.from({ length: 60 }, (_, i) =>
          photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
        ),
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(page1);

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(false));
    expect(result.current.photos).toHaveLength(61);
  });

  it("two loadMore() calls issued before any state update result in exactly one fetch", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(
        Array.from({ length: 60 }, (_, i) =>
          photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
        ),
      )
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2, // 1 initial + 1 loadMore (the second call was a no-op)
      ),
    );
  });

  it("assign removes on 'ok'/'conflict', keeps on 'error'", async () => {
    const p = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValueOnce(
      "error",
    );
    await act(async () => {
      const outcome = await result.current.assign(p, "Paris");
      expect(outcome).toBe("error");
    });
    expect(result.current.photos).toHaveLength(1);

    vi.mocked(photosRepositoryModule.assignPhotoPlace).mockResolvedValueOnce(
      "conflict",
    );
    await act(async () => {
      await result.current.assign(p, "Paris");
    });
    expect(result.current.photos).toHaveLength(0);
  });

  it("skip removes a photo from view without calling the repository", async () => {
    const page1 = [
      photo("p0", "2026-01-01T00:00:00.000Z"),
      photo("p1", "2026-01-02T00:00:00.000Z"),
    ];
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue(
      page1,
    );
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(2));

    act(() => {
      result.current.skip(page1[0]);
    });

    expect(result.current.photos).toEqual([page1[1]]);
    expect(photosRepositoryModule.assignPhotoPlace).not.toHaveBeenCalled();
  });

  it("skipping away the last loaded photo while hasMore is true auto-triggers exactly one refill", async () => {
    const fullPage = Array.from({ length: 60 }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      for (const p of fullPage) {
        result.current.skip(p);
      }
    });

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(result.current.photos).toEqual([]);
  });

  it("skipped photos are not persisted — a fresh mount of the hook sees them again", async () => {
    const p = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p,
    ]);
    const first = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(first.result.current.photos).toHaveLength(1));

    act(() => {
      first.result.current.skip(p);
    });
    expect(first.result.current.photos).toEqual([]);

    const second = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(second.result.current.photos).toHaveLength(1));
  });
});

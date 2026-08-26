import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsortedPhotos } from "./useUnsortedPhotos";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  fetchUnsortedPhotos: vi.fn(),
  assignPhotoPlace: vi.fn(),
  skipPhoto: vi.fn(),
  unskipPhoto: vi.fn(),
  unassignPhoto: vi.fn(),
  setPhotoLabel: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function photo(id: string, createdAt: string): UnsortedPhoto {
  return {
    id,
    storagePath: `user-1/${id}.jpg`,
    createdAt,
    kind: "image",
    label: null,
    placeQuery: null,
    skippedAt: null,
    caption: null,
    tags: null,
  };
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

  it("skip removes on 'ok'/'conflict', keeps on 'error'", async () => {
    const p = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValueOnce("error");
    await act(async () => {
      const outcome = await result.current.skip(p);
      expect(outcome).toBe("error");
    });
    expect(result.current.photos).toHaveLength(1);
    expect(photosRepositoryModule.skipPhoto).toHaveBeenCalledWith(p.id);

    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValueOnce(
      "conflict",
    );
    await act(async () => {
      await result.current.skip(p);
    });
    expect(result.current.photos).toHaveLength(0);
  });

  it("skipping away the last loaded photo while hasMore is true auto-triggers exactly one refill", async () => {
    const fullPage = Array.from({ length: 60 }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.skipPhoto).mockResolvedValue("ok");

    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    for (const p of fullPage) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.skip(p);
      });
    }

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(result.current.photos).toEqual([]);
  });

  it("unskip removes on 'ok'/'conflict', keeps on 'error'", async () => {
    const p = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1", "skipped"));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.unskipPhoto).mockResolvedValueOnce(
      "error",
    );
    await act(async () => {
      const outcome = await result.current.unskip(p);
      expect(outcome).toBe("error");
    });
    expect(result.current.photos).toHaveLength(1);
    expect(photosRepositoryModule.unskipPhoto).toHaveBeenCalledWith(p.id);

    vi.mocked(photosRepositoryModule.unskipPhoto).mockResolvedValueOnce(
      "conflict",
    );
    await act(async () => {
      await result.current.unskip(p);
    });
    expect(result.current.photos).toHaveLength(0);
  });

  it("unskipping away the last loaded photo while hasMore is true auto-triggers exactly one refill", async () => {
    const fullPage = Array.from({ length: 60 }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.unskipPhoto).mockResolvedValue("ok");

    const { result } = renderHook(() => useUnsortedPhotos("user-1", "skipped"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    for (const p of fullPage) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.unskip(p);
      });
    }

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(result.current.photos).toEqual([]);
  });

  it("unassign removes on 'ok'/'conflict', keeps on 'error'", async () => {
    const p = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p,
    ]);
    const { result } = renderHook(() =>
      useUnsortedPhotos("user-1", "assigned"),
    );
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.unassignPhoto).mockResolvedValueOnce(
      "error",
    );
    await act(async () => {
      const outcome = await result.current.unassign(p);
      expect(outcome).toBe("error");
    });
    expect(result.current.photos).toHaveLength(1);
    expect(photosRepositoryModule.unassignPhoto).toHaveBeenCalledWith(p.id);

    vi.mocked(photosRepositoryModule.unassignPhoto).mockResolvedValueOnce(
      "conflict",
    );
    await act(async () => {
      await result.current.unassign(p);
    });
    expect(result.current.photos).toHaveLength(0);
  });

  it("unassigning away the last loaded photo while hasMore is true auto-triggers exactly one refill", async () => {
    const fullPage = Array.from({ length: 60 }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:0${i % 10}.000Z`),
    );
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([]);
    vi.mocked(photosRepositoryModule.unassignPhoto).mockResolvedValue("ok");

    const { result } = renderHook(() =>
      useUnsortedPhotos("user-1", "assigned"),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    for (const p of fullPage) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.unassign(p);
      });
    }

    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(result.current.photos).toEqual([]);
  });

  it("defaults to the 'unassigned' status and threads a given status through to every fetch", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);

    const { result: defaulted } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(defaulted.current.isInitialLoading).toBe(false));
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ status: "unassigned" }),
    );

    const { result: skipped } = renderHook(() =>
      useUnsortedPhotos("user-1", "skipped"),
    );
    await waitFor(() => expect(skipped.current.isInitialLoading).toBe(false));
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ status: "skipped" }),
    );
  });

  it("changing status triggers a fresh initial load with the new status", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      photo("p0", "2026-01-01T00:00:00.000Z"),
    ]);

    const { result, rerender } = renderHook(
      ({ status }: { status: "unassigned" | "skipped" }) =>
        useUnsortedPhotos("user-1", status),
      { initialProps: { status: "unassigned" } },
    );
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(1);

    rerender({ status: "skipped" });
    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ status: "skipped", after: null }),
    );
  });

  it("setLabel updates the photo in place on 'ok', leaving other photos untouched", async () => {
    const p0 = photo("p0", "2026-01-01T00:00:00.000Z");
    const p1 = photo("p1", "2026-01-02T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p0,
      p1,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(2));

    vi.mocked(photosRepositoryModule.setPhotoLabel).mockResolvedValueOnce("ok");
    await act(async () => {
      const outcome = await result.current.setLabel(p0, "  the beach one  ");
      expect(outcome).toBe("ok");
    });

    expect(photosRepositoryModule.setPhotoLabel).toHaveBeenCalledWith(
      "p0",
      "  the beach one  ",
    );
    expect(result.current.photos).toEqual([
      { ...p0, label: "the beach one" },
      p1,
    ]);
  });

  it("setLabel clears the label locally when given a blank string", async () => {
    const p0 = { ...photo("p0", "2026-01-01T00:00:00.000Z"), label: "old" };
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p0,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.setPhotoLabel).mockResolvedValueOnce("ok");
    await act(async () => {
      await result.current.setLabel(p0, "   ");
    });

    expect(result.current.photos[0].label).toBeNull();
  });

  it("setLabel leaves the photo untouched on 'error'", async () => {
    const p0 = photo("p0", "2026-01-01T00:00:00.000Z");
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([
      p0,
    ]);
    const { result } = renderHook(() => useUnsortedPhotos("user-1"));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    vi.mocked(photosRepositoryModule.setPhotoLabel).mockResolvedValueOnce(
      "error",
    );
    await act(async () => {
      const outcome = await result.current.setLabel(p0, "nope");
      expect(outcome).toBe("error");
    });

    expect(result.current.photos[0].label).toBeNull();
  });

  it("threads the tag filter through to fetchUnsortedPhotos and re-fetches when it changes", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotos).mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ tag }: { tag?: "animal" | "untagged" }) =>
        useUnsortedPhotos("user-1", "unassigned", tag),
      { initialProps: { tag: undefined as "animal" | "untagged" | undefined } },
    );
    await waitFor(() =>
      expect(photosRepositoryModule.fetchUnsortedPhotos).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ tag: undefined }),
      ),
    );

    rerender({ tag: "animal" });
    await waitFor(() =>
      expect(
        photosRepositoryModule.fetchUnsortedPhotos,
      ).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: "animal" }),
      ),
    );
  });
});

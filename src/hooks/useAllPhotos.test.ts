import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllPhotos } from "./useAllPhotos";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  fetchAllPhotos: vi.fn(),
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

describe("useAllPhotos", () => {
  it("loads the first page and reports isInitialLoading correctly", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([
      photo("p0", "2026-01-01T00:00:00.000Z"),
    ]);
    const { result } = renderHook(() => useAllPhotos("user-1"));
    expect(result.current.isInitialLoading).toBe(true);

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.photos).toHaveLength(1);
    expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalledWith(
      "user-1",
      { limit: 60, after: null, tag: undefined, groupId: undefined },
    );
  });

  it("passes tag and groupId through unchanged", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    renderHook(() =>
      useAllPhotos("user-1", { tag: "animal", groupId: "group-1" }),
    );

    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalledWith(
        "user-1",
        { limit: 60, after: null, tag: "animal", groupId: "group-1" },
      ),
    );
  });

  it("a null first-page result sets photosLoadError", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue(null);
    const { result } = renderHook(() => useAllPhotos("user-1"));

    await waitFor(() => expect(result.current.photosLoadError).toBe(true));
    expect(result.current.photos).toEqual([]);
  });

  it("loadMore appends the next page using the last row's cursor", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) =>
        photo(`p${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`),
      ),
    );
    const { result } = renderHook(() => useAllPhotos("user-1"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValueOnce([
      photo("p60", "2026-01-01T00:01:00.000Z"),
    ]);
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.photos).toHaveLength(61));
    expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        after: { createdAt: "2026-01-01T00:00:59.000Z", id: "p59" },
      }),
    );
  });

  it("changing tag re-fetches from scratch", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ tag }: { tag?: "food" }) => useAllPhotos("user-1", { tag }),
      { initialProps: { tag: undefined as "food" | undefined } },
    );
    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenCalledTimes(1),
    );

    rerender({ tag: "food" });
    await waitFor(() =>
      expect(photosRepositoryModule.fetchAllPhotos).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({ tag: "food" }),
      ),
    );
  });

  it("retry re-fetches after a load error", async () => {
    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValueOnce(
      null,
    );
    const { result } = renderHook(() => useAllPhotos("user-1"));
    await waitFor(() => expect(result.current.photosLoadError).toBe(true));

    vi.mocked(photosRepositoryModule.fetchAllPhotos).mockResolvedValueOnce([
      photo("p0", "2026-01-01T00:00:00.000Z"),
    ]);
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    expect(result.current.photosLoadError).toBe(false);
  });
});

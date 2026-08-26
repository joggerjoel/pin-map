import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSimilarPhotos } from "./useSimilarPhotos";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  findSimilarPhotos: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("useSimilarPhotos", () => {
  it("starts inactive", () => {
    const { result } = renderHook(() => useSimilarPhotos());
    expect(result.current.isActive).toBe(false);
    expect(result.current.sourcePhoto).toBeNull();
  });

  it("enter fetches and populates results; exit clears everything", async () => {
    const matches = [photo("p1"), photo("p2")];
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue(
      matches,
    );
    const { result } = renderHook(() => useSimilarPhotos());
    const source = photo("p0");

    await act(async () => {
      result.current.enter(source);
    });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    expect(result.current.sourcePhoto).toEqual(source);
    expect(result.current.results).toEqual(matches);
    expect(result.current.totalReturned).toBe(2);
    expect(photosRepositoryModule.findSimilarPhotos).toHaveBeenCalledWith("p0");

    act(() => result.current.exit());
    expect(result.current.isActive).toBe(false);
    expect(result.current.results).toEqual([]);
  });

  it("a null RPC result becomes an empty results array, not a crash", async () => {
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue(null);
    const { result } = renderHook(() => useSimilarPhotos());

    await act(async () => {
      result.current.enter(photo("p0"));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.results).toEqual([]);
    expect(result.current.totalReturned).toBe(0);
  });

  it("totalReturned (M) reflects the raw RPC count, results (N) reflects the post-status-filter count", async () => {
    const matches = [
      photo("p1", { placeQuery: "Paris" }), // assigned
      photo("p2", { placeQuery: null, skippedAt: null }), // unassigned
      photo("p3", { placeQuery: "Rome" }), // assigned
    ];
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue(
      matches,
    );
    const { result } = renderHook(() =>
      useSimilarPhotos((p) => p.placeQuery !== null),
    );

    await act(async () => {
      result.current.enter(photo("p0"));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.totalReturned).toBe(3);
    expect(result.current.results).toHaveLength(2);
  });

  it("caps displayed results at 24 even when more survive the status filter", async () => {
    const matches = Array.from({ length: 40 }, (_, i) => photo(`p${i}`));
    vi.mocked(photosRepositoryModule.findSimilarPhotos).mockResolvedValue(
      matches,
    );
    const { result } = renderHook(() => useSimilarPhotos());

    await act(async () => {
      result.current.enter(photo("source"));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.totalReturned).toBe(40);
    expect(result.current.results).toHaveLength(24);
  });

  it("a later enter() drops a still-in-flight earlier call's result", async () => {
    let resolveFirst: (v: UnsortedPhoto[] | null) => void = () => {};
    vi.mocked(photosRepositoryModule.findSimilarPhotos)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([photo("second-result")]);

    const { result } = renderHook(() => useSimilarPhotos());

    act(() => result.current.enter(photo("first-source")));
    act(() => result.current.enter(photo("second-source")));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      resolveFirst([photo("first-result")]);
    });

    expect(result.current.sourcePhoto?.id).toBe("second-source");
    expect(result.current.results).toEqual([photo("second-result")]);
  });
});

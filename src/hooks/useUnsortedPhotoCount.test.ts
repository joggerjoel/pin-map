import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsortedPhotoCount } from "./useUnsortedPhotoCount";
import * as photosRepositoryModule from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  fetchUnsortedPhotoCount: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUnsortedPhotoCount", () => {
  it("skips fetching while userId is null", () => {
    const { result } = renderHook(() => useUnsortedPhotoCount(null));

    expect(
      photosRepositoryModule.fetchUnsortedPhotoCount,
    ).not.toHaveBeenCalled();
    expect(result.current.totalCount).toBeNull();
  });

  it("fetches once userId becomes non-null", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      5,
    );

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useUnsortedPhotoCount(userId),
      { initialProps: { userId: null as string | null } },
    );
    expect(result.current.totalCount).toBeNull();

    rerender({ userId: "user-1" });

    await waitFor(() => expect(result.current.totalCount).toBe(5));
    expect(photosRepositoryModule.fetchUnsortedPhotoCount).toHaveBeenCalledWith(
      "user-1",
    );
  });

  it("drops a response for a superseded userId", async () => {
    let resolveFirst: (value: number | null) => void = () => {};
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(9);

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => useUnsortedPhotoCount(userId),
      { initialProps: { userId: "user-1" } },
    );

    rerender({ userId: "user-2" });
    await waitFor(() => expect(result.current.totalCount).toBe(9));

    act(() => {
      resolveFirst(1);
    });

    // Give the stale promise's .then a turn; it must not overwrite user-2's count.
    await Promise.resolve();
    expect(result.current.totalCount).toBe(9);
  });

  it("refetch updates totalCount from a fresh fetch", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      3,
    );
    const { result } = renderHook(() => useUnsortedPhotoCount("user-1"));
    await waitFor(() => expect(result.current.totalCount).toBe(3));

    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      7,
    );
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.totalCount).toBe(7));
  });

  it("refetches on a window focus event", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      1,
    );
    const { result } = renderHook(() => useUnsortedPhotoCount("user-1"));
    await waitFor(() => expect(result.current.totalCount).toBe(1));

    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      2,
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current.totalCount).toBe(2));
  });

  it("decrement subtracts 1 and floors at 0, no-op while null", async () => {
    vi.mocked(photosRepositoryModule.fetchUnsortedPhotoCount).mockResolvedValue(
      1,
    );
    const { result } = renderHook(() => useUnsortedPhotoCount("user-1"));
    await waitFor(() => expect(result.current.totalCount).toBe(1));

    act(() => {
      result.current.decrement();
    });
    expect(result.current.totalCount).toBe(0);

    act(() => {
      result.current.decrement();
    });
    expect(result.current.totalCount).toBe(0);
  });

  it("decrement is a no-op while totalCount is null", () => {
    const { result } = renderHook(() => useUnsortedPhotoCount(null));

    act(() => {
      result.current.decrement();
    });

    expect(result.current.totalCount).toBeNull();
  });

  it("markEmpty forces 0 from any state", async () => {
    const { result } = renderHook(() => useUnsortedPhotoCount(null));

    act(() => {
      result.current.markEmpty();
    });

    expect(result.current.totalCount).toBe(0);
  });
});

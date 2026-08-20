import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePhotos } from "./usePhotos";
import * as photosRepositoryModule from "../lib/photosRepository";
import type { PlacePhoto } from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  fetchPhotos: vi.fn(),
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const parisPhoto: PlacePhoto = {
  id: "photo-1",
  placeQuery: "Paris",
  storagePath: "user-1/photo-1.jpg",
  url: "https://cdn.example.com/user-1/photo-1.jpg",
};

describe("usePhotos", () => {
  it("fetches photos for the signed-in userId and groups them by place query", async () => {
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([
      parisPhoto,
    ]);

    const { result } = renderHook(() => usePhotos("user-1", null));

    await waitFor(() => {
      expect(result.current.photosByQuery.Paris).toEqual([parisPhoto]);
    });
    expect(photosRepositoryModule.fetchPhotos).toHaveBeenCalledWith("user-1");
  });

  it("falls back to the owner id when there is no signed-in userId", async () => {
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([]);

    renderHook(() => usePhotos(null, "owner-1"));

    await waitFor(() => {
      expect(photosRepositoryModule.fetchPhotos).toHaveBeenCalledWith(
        "owner-1",
      );
    });
  });

  it("stays empty with no userId or ownerUserId", async () => {
    const { result } = renderHook(() => usePhotos(null, null));

    await act(async () => {
      await Promise.resolve();
    });

    expect(photosRepositoryModule.fetchPhotos).not.toHaveBeenCalled();
    expect(result.current.photosByQuery).toEqual({});
  });

  it("addPhoto uploads and appends the new photo under its place query", async () => {
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([]);
    vi.mocked(photosRepositoryModule.uploadPhoto).mockResolvedValue(parisPhoto);
    const file = new File(["fake"], "eiffel.jpg", { type: "image/jpeg" });

    const { result } = renderHook(() => usePhotos("user-1", null));
    await waitFor(() =>
      expect(photosRepositoryModule.fetchPhotos).toHaveBeenCalled(),
    );

    await act(async () => {
      await result.current.addPhoto("Paris", file);
    });

    expect(photosRepositoryModule.uploadPhoto).toHaveBeenCalledWith(
      "user-1",
      "Paris",
      file,
    );
    expect(result.current.photosByQuery.Paris).toEqual([parisPhoto]);
  });

  it("addPhoto does nothing when there is no signed-in userId", async () => {
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([]);
    const file = new File(["fake"], "eiffel.jpg", { type: "image/jpeg" });
    const { result } = renderHook(() => usePhotos(null, "owner-1"));

    await act(async () => {
      await result.current.addPhoto("Paris", file);
    });

    expect(photosRepositoryModule.uploadPhoto).not.toHaveBeenCalled();
  });

  it("removePhoto optimistically removes it and calls deletePhoto", async () => {
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([
      parisPhoto,
    ]);

    const { result } = renderHook(() => usePhotos("user-1", null));
    await waitFor(() =>
      expect(result.current.photosByQuery.Paris).toEqual([parisPhoto]),
    );

    act(() => {
      result.current.removePhoto(parisPhoto);
    });

    expect(result.current.photosByQuery.Paris).toBeUndefined();
    expect(photosRepositoryModule.deletePhoto).toHaveBeenCalledWith(
      "user-1",
      parisPhoto,
    );
  });

  it("keeps photosByQuery's identity stable across a re-render that doesn't change photos", async () => {
    // MapView's marker-rebuild effect depends on this object's reference —
    // a fresh object on every render (even an unrelated one, e.g. a marker
    // click updating other state) would tear down and recreate every
    // marker on every render, sometimes mid-popup-open.
    vi.mocked(photosRepositoryModule.fetchPhotos).mockResolvedValue([
      parisPhoto,
    ]);

    const { result, rerender } = renderHook(
      ({ userId }) => usePhotos(userId, null),
      { initialProps: { userId: "user-1" } },
    );
    await waitFor(() =>
      expect(result.current.photosByQuery.Paris).toEqual([parisPhoto]),
    );
    const firstReference = result.current.photosByQuery;

    rerender({ userId: "user-1" });

    expect(result.current.photosByQuery).toBe(firstReference);
  });
});

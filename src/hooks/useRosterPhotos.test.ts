import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRosterPhotos } from "./useRosterPhotos";
import * as classRosterPhotosRepositoryModule from "../lib/classRosterPhotosRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";

vi.mock("../lib/classRosterPhotosRepository", () => ({
  fetchRosterPhotos: vi.fn(),
  uploadRosterPhoto: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const photo: RosterPersonPhoto = {
  id: "photo-1",
  personId: 5,
  storagePath: "user-1/class-roster/belding1989/5/a.jpg",
  year: 1995,
  url: "https://cdn.example.com/user-1/class-roster/belding1989/5/a.jpg",
};

describe("useRosterPhotos", () => {
  it("fetches photos for the class and groups them by personId", async () => {
    vi.mocked(
      classRosterPhotosRepositoryModule.fetchRosterPhotos,
    ).mockResolvedValue([photo]);

    const { result } = renderHook(() =>
      useRosterPhotos("belding1989", "user-1"),
    );

    await waitFor(() => {
      expect(result.current.photosByPersonId[5]).toEqual([photo]);
    });
    expect(
      classRosterPhotosRepositoryModule.fetchRosterPhotos,
    ).toHaveBeenCalledWith("belding1989");
  });

  it("addPhoto uploads and appends the new photo under its personId", async () => {
    vi.mocked(
      classRosterPhotosRepositoryModule.fetchRosterPhotos,
    ).mockResolvedValue([]);
    vi.mocked(
      classRosterPhotosRepositoryModule.uploadRosterPhoto,
    ).mockResolvedValue(photo);
    const file = new File(["fake"], "reunion.jpg", { type: "image/jpeg" });

    const { result } = renderHook(() =>
      useRosterPhotos("belding1989", "user-1"),
    );
    await waitFor(() =>
      expect(
        classRosterPhotosRepositoryModule.fetchRosterPhotos,
      ).toHaveBeenCalled(),
    );

    await act(async () => {
      await result.current.addPhoto(5, file, 1995);
    });

    expect(
      classRosterPhotosRepositoryModule.uploadRosterPhoto,
    ).toHaveBeenCalledWith("user-1", "belding1989", 5, 1995, file);
    expect(result.current.photosByPersonId[5]).toEqual([photo]);
  });

  it("addPhoto does nothing when there is no signed-in userId", async () => {
    vi.mocked(
      classRosterPhotosRepositoryModule.fetchRosterPhotos,
    ).mockResolvedValue([]);
    const file = new File(["fake"], "reunion.jpg", { type: "image/jpeg" });

    const { result } = renderHook(() => useRosterPhotos("belding1989", ""));

    await act(async () => {
      await result.current.addPhoto(5, file, null);
    });

    expect(
      classRosterPhotosRepositoryModule.uploadRosterPhoto,
    ).not.toHaveBeenCalled();
  });

  it("keeps photosByPersonId's identity stable across a re-render that doesn't change photos", async () => {
    vi.mocked(
      classRosterPhotosRepositoryModule.fetchRosterPhotos,
    ).mockResolvedValue([photo]);

    const { result, rerender } = renderHook(
      ({ classSlug }) => useRosterPhotos(classSlug, "user-1"),
      { initialProps: { classSlug: "belding1989" } },
    );
    await waitFor(() =>
      expect(result.current.photosByPersonId[5]).toEqual([photo]),
    );
    const firstReference = result.current.photosByPersonId;

    rerender({ classSlug: "belding1989" });

    expect(result.current.photosByPersonId).toBe(firstReference);
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGeocoder } from "./useGeocoder";
import * as geocoderModule from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";

afterEach(() => {
  vi.restoreAllMocks();
});

const paris: GeocodeResult = {
  query: "Paris",
  name: "Paris, France",
  lng: 2.35,
  lat: 48.86,
};

describe("useGeocoder", () => {
  it("adds geocoded places and failed lines from pinPlaces", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockResolvedValue({
      pinned: [paris],
      failed: ["Nowhereville"],
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Paris\nNowhereville");
    });

    expect(result.current.pinnedPlaces).toEqual([paris]);
    expect(result.current.failedLines).toEqual(["Nowhereville"]);
    expect(result.current.isLoading).toBe(false);
  });

  it("skips lines already pinned", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [paris], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pinnedPlaces).toEqual([paris]);
  });

  it("sets an error message when geocodeBatch rejects", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockRejectedValue(
      new Error("All geocoding requests failed"),
    );

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(result.current.error).toBe(
      "Couldn't reach Mapbox. Check your connection and try again.",
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("removePlace removes a pinned place by query", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockResolvedValue({
      pinned: [paris],
      failed: [],
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });
    act(() => {
      result.current.removePlace("Paris");
    });

    expect(result.current.pinnedPlaces).toEqual([]);
  });

  it("retry re-runs pinPlaces with the last raw input", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockRejectedValueOnce(new Error("All geocoding requests failed"))
      .mockResolvedValueOnce({ pinned: [paris], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.retry();
    });

    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.pinnedPlaces).toEqual([paris]);
    expect(result.current.error).toBeNull();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGeocoder } from "./useGeocoder";
import * as geocoderModule from "../lib/geocoder";
import { GeocodeAllFailedError } from "../lib/geocoder";
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

  it("sets a distinct message when geocodeBatch rejects with an auth failure", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockRejectedValue(
      new GeocodeAllFailedError(true),
    );

    const { result } = renderHook(() => useGeocoder("pk.bad-token"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(result.current.error).toBe(
      "That Mapbox token was rejected — check it and try again.",
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("sets the generic message when geocodeBatch rejects without an auth failure", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockRejectedValue(
      new GeocodeAllFailedError(false),
    );

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(result.current.error).toBe(
      "Couldn't reach Mapbox. Check your connection and try again.",
    );
  });

  it("does not duplicate a failed line when the same input is resubmitted", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [],
        failed: ["Nowhereville"],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Nowhereville");
    });
    await act(async () => {
      await result.current.pinPlaces("Nowhereville");
    });

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.failedLines).toEqual(["Nowhereville"]);
  });

  it("retry re-attempts a failed line and removes it from failedLines when it succeeds", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValueOnce({ pinned: [], failed: ["Nowhereville"] })
      .mockResolvedValueOnce({
        pinned: [{ ...paris, query: "Nowhereville" }],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlaces("Nowhereville");
    });
    expect(result.current.failedLines).toEqual(["Nowhereville"]);

    await act(async () => {
      await result.current.retry();
    });

    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.failedLines).toEqual([]);
    expect(result.current.pinnedPlaces.map((place) => place.query)).toEqual([
      "Nowhereville",
    ]);
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

describe("useGeocoder in checklist mode", () => {
  it("parses checklist-format input, geocodes only marked entries with a US country filter, and attaches categories", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [
          { query: "Florida", name: "Florida, USA", lng: -81.5, lat: 27.7 },
        ],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("1 Alabama \n9 Florida X", true);
    });

    expect(batchSpy).toHaveBeenCalledWith(["Florida"], "pk.test", "us");
    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Florida",
        name: "Florida, USA",
        lng: -81.5,
        lat: 27.7,
        category: "visited",
      },
    ]);
  });

  it("does not apply a country filter when checklistMode is false", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Paris", false);
    });

    expect(batchSpy).toHaveBeenCalledWith(["Paris"], "pk.test", undefined);
  });

  it("retry re-runs the last call in the same mode it was originally called with", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockRejectedValueOnce(new Error("All geocoding requests failed"))
      .mockResolvedValueOnce({
        pinned: [
          { query: "Florida", name: "Florida, USA", lng: -81.5, lat: 27.7 },
        ],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("9 Florida X", true);
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.retry();
    });

    expect(batchSpy).toHaveBeenNthCalledWith(2, ["Florida"], "pk.test", "us");
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "visited",
    });
  });
});

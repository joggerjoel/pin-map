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

  it("extracts an ironman tag, strips it from the geocoded query, and attaches the icon", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [
          {
            query: "Kailua-Kona, Hawaii",
            name: "Kailua-Kona, Hawaii, USA",
            lng: -155.99,
            lat: 19.64,
          },
        ],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Kailua-Kona, Hawaii (ironman)");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Kailua-Kona, Hawaii", country: undefined }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      query: "Kailua-Kona, Hawaii",
      icon: "triathlete",
    });
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

describe("useGeocoder checklist auto-detection", () => {
  it("auto-detects a checklist-shaped line and applies the US country filter", async () => {
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
      await result.current.pinPlaces("9 Florida X");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Florida", country: "us" }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      query: "Florida",
      category: "visited",
    });
  });

  it("skips an unmarked checklist-shaped line", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("1 Alabama\n9 Florida X");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Florida", country: "us" }],
      "pk.test",
      undefined,
    );
  });

  it("mixes checklist-shaped and plain lines in the same paste", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [
          { query: "Florida", name: "Florida, USA", lng: -81.5, lat: 27.7 },
          {
            query: "Dublin, Ireland",
            name: "Dublin, Ireland",
            lng: -6.26,
            lat: 53.35,
          },
        ],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("9 Florida X\nDublin, Ireland");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [
        { query: "Florida", country: "us" },
        { query: "Dublin, Ireland", country: "ie" },
      ],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "visited",
    });
    expect(result.current.pinnedPlaces[1]).toMatchObject({
      category: undefined,
    });
  });

  it("does not apply a country filter to a plain line", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Paris", country: undefined }],
      "pk.test",
      undefined,
    );
  });

  it("detects a per-line country for a plain line", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Dublin, Ireland");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Dublin, Ireland", country: "ie" }],
      "pk.test",
      undefined,
    );
  });

  it("passes a continent's bbox to geocodeBatch when provided", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Paris", "europe");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Paris", country: undefined }],
      "pk.test",
      [-25, 34, 45, 72],
    );
  });

  it("retry re-runs the last call with the same auto-detected shape", async () => {
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
      await result.current.pinPlaces("9 Florida X");
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.retry();
    });

    expect(batchSpy).toHaveBeenNthCalledWith(
      2,
      [{ query: "Florida", country: "us" }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "visited",
    });
  });
});

describe("pinPlace", () => {
  it("geocodes a single query and pins it with the given category", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
        category: "visited",
      },
    ]);
  });

  it("geocodes a single query and pins it with the given icon", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Kailua-Kona",
      name: "Kailua-Kona, Hawaii, USA",
      lng: -155.99,
      lat: 19.64,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlace("Kailua-Kona", { icon: "triathlete" });
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      icon: "triathlete",
    });
  });

  it("skips a query that's already pinned", async () => {
    const lineSpy = vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "lived" });
    });

    expect(lineSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pinnedPlaces).toHaveLength(1);
  });

  it("adds the query to failedLines when geocoding finds nothing", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue(null);

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlace("Nowhereville", { category: "visited" });
    });

    expect(result.current.failedLines).toEqual(["Nowhereville"]);
    expect(result.current.pinnedPlaces).toEqual([]);
  });
});

describe("changeTag", () => {
  it("replaces a pinned place's category and clears any icon", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { icon: "triathlete" });
    });

    act(() => {
      result.current.changeTag("Paris", { category: "hometown" });
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "hometown",
      icon: undefined,
    });
  });

  it("does nothing when the query doesn't match any pinned place", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    act(() => {
      result.current.changeTag("Nowhereville", { category: "hometown" });
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "visited",
    });
  });

  it("pins a place with a custom tag and can change it later", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Boston",
      name: "Boston, Massachusetts, USA",
      lng: -71.06,
      lat: 42.36,
    });

    const marathon = { id: "marathon", label: "Marathon", color: "#8b5cf6" };
    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlace("Boston", { customTag: marathon });
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      customTag: marathon,
    });

    act(() => {
      result.current.changeTag("Boston", { category: "visited" });
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      category: "visited",
      customTag: undefined,
    });
  });
});

describe("reorderPlaces", () => {
  it("moves a place from one index to another", async () => {
    vi.spyOn(geocoderModule, "geocodeLine")
      .mockResolvedValueOnce({
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
      })
      .mockResolvedValueOnce({
        query: "Tokyo",
        name: "Tokyo, Japan",
        lng: 139.69,
        lat: 35.68,
      })
      .mockResolvedValueOnce({
        query: "Rome",
        name: "Rome, Italy",
        lng: 12.5,
        lat: 41.9,
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });
    await act(async () => {
      await result.current.pinPlace("Tokyo", { category: "visited" });
    });
    await act(async () => {
      await result.current.pinPlace("Rome", { category: "visited" });
    });

    act(() => {
      result.current.reorderPlaces(0, 2);
    });

    expect(result.current.pinnedPlaces.map((p) => p.query)).toEqual([
      "Tokyo",
      "Rome",
      "Paris",
    ]);
  });

  it("does nothing when fromIndex equals toIndex", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    act(() => {
      result.current.reorderPlaces(0, 0);
    });

    expect(result.current.pinnedPlaces.map((p) => p.query)).toEqual(["Paris"]);
  });

  it("does nothing for an out-of-range index", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    act(() => {
      result.current.reorderPlaces(0, 5);
    });

    expect(result.current.pinnedPlaces.map((p) => p.query)).toEqual(["Paris"]);
  });
});

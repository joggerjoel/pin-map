import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeocoder } from "./useGeocoder";
import * as geocoderModule from "../lib/geocoder";
import { GeocodeAllFailedError } from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";
import * as pinsRepositoryModule from "../lib/pinsRepository";
import * as tokenUsageModule from "../lib/tokenUsage";

vi.mock("../lib/pinsRepository", () => ({
  fetchPins: vi.fn(),
  upsertPins: vi.fn(),
  updatePinFields: vi.fn(),
  deletePin: vi.fn(),
}));

vi.mock("../lib/tokenUsage", () => ({
  incrementPlacesPinned: vi.fn(),
}));

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

describe("useGeocoder explicit coordinates", () => {
  it("pins a line with explicit coordinates and a tag suffix without calling geocodeBatch", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces(
        "Hong Kong SAR, China, 25.8144821,-80.176346, (home)",
      );
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Hong Kong SAR, China",
        name: "Hong Kong SAR, China",
        lat: 25.8144821,
        lng: -80.176346,
        icon: "house-home",
      },
    ]);
  });

  it("pins a line with explicit coordinates and no tag without calling geocodeBatch", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces(
        "Macau Island, China, 13.7308093,121.8832412",
      );
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Macau Island, China",
        name: "Macau Island, China",
        lat: 13.7308093,
        lng: 121.8832412,
      },
    ]);
  });

  it("mixes an explicit-coordinate line with a plain geocoded line", async () => {
    const tokyo: GeocodeResult = {
      query: "Tokyo",
      name: "Tokyo, Japan",
      lng: 139.69,
      lat: 35.68,
    };
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [tokyo], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces(
        "Hong Kong SAR, China, 25.8144821,-80.176346\nTokyo",
      );
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Tokyo", country: undefined }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Hong Kong SAR, China",
        name: "Hong Kong SAR, China",
        lat: 25.8144821,
        lng: -80.176346,
      },
      tokyo,
    ]);
  });

  it("does not duplicate an explicit-coordinate line when it's pasted again", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces(
        "Macau Island, China, 13.7308093,121.8832412",
      );
    });
    await act(async () => {
      await result.current.pinPlaces(
        "Macau Island, China, 13.7308093,121.8832412",
      );
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toHaveLength(1);
  });
});

describe("useGeocoder explicit-coordinate corrections", () => {
  it("updates an already-pinned place when a corrected explicit-coordinate line is pasted", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Macau Island, China, 1.0,2.0");
    });
    await act(async () => {
      await result.current.pinPlaces(
        "Macau Island, China, 13.7308093,121.8832412",
      );
    });

    expect(batchSpy).not.toHaveBeenCalled();
    const macauEntries = result.current.pinnedPlaces.filter(
      (place) => place.query === "Macau Island, China",
    );
    expect(macauEntries).toHaveLength(1);
    expect(macauEntries[0]).toMatchObject({
      lat: 13.7308093,
      lng: 121.8832412,
    });
  });

  it("resolves a previously-failed line when it's re-pasted with explicit coordinates", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: ["Bintan, Malaysia"] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Bintan, Malaysia");
    });
    expect(result.current.failedLines).toEqual(["Bintan, Malaysia"]);

    await act(async () => {
      await result.current.pinPlaces("Bintan, Malaysia, 1.1775686,104.3017263");
    });

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.failedLines).toEqual([]);
    expect(result.current.pinnedPlaces).toContainEqual(
      expect.objectContaining({
        query: "Bintan, Malaysia",
        lat: 1.1775686,
        lng: 104.3017263,
      }),
    );
  });

  it("still skips a plain re-paste of an already-pinned place with no explicit coordinates", async () => {
    const tokyo: GeocodeResult = {
      query: "Tokyo",
      name: "Tokyo, Japan",
      lng: 139.69,
      lat: 35.68,
    };
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [tokyo], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Tokyo");
    });
    await act(async () => {
      await result.current.pinPlaces("Tokyo");
    });

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pinnedPlaces).toEqual([tokyo]);
  });

  it("applies a new tag to an already-pinned place without re-geocoding when re-pasted with a different tag", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan, 42.8,140.6");
    });
    batchSpy.mockClear();

    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan (ski)");
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toEqual([
      expect.objectContaining({
        query: "Niseko, Japan",
        lat: 42.8,
        lng: 140.6,
        icon: "ski",
      }),
    ]);
  });

  it("persists a re-tag of an already-pinned place via updatePinFields, keyed on the stored query", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeBatch").mockResolvedValue({
      pinned: [],
      failed: [],
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan, 42.8,140.6");
    });
    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan (ski)");
    });

    expect(pinsRepositoryModule.updatePinFields).toHaveBeenCalledWith(
      "user-1",
      "Niseko, Japan",
      { category: null, icon: "ski", custom_tag_id: null },
    );
  });

  it("does not re-tag when the re-pasted line carries the same tag as before", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({ pinned: [], failed: [] });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan (ski), 42.8,140.6");
    });
    batchSpy.mockClear();
    vi.mocked(pinsRepositoryModule.updatePinFields).mockClear();

    await act(async () => {
      await result.current.pinPlaces("Niseko, Japan (ski)");
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(pinsRepositoryModule.updatePinFields).not.toHaveBeenCalled();
  });

  it("replaces category/icon/date entirely from the new line when updating a pinned place", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Nice, France (ironman), 43.0,7.0");
    });
    await act(async () => {
      await result.current.pinPlaces("Nice, France, 43.7,7.3");
    });

    expect(batchSpy).not.toHaveBeenCalled();
    const niceEntries = result.current.pinnedPlaces.filter(
      (place) => place.query === "Nice, France",
    );
    expect(niceEntries).toHaveLength(1);
    expect(niceEntries[0]).toMatchObject({
      lat: 43.7,
      lng: 7.3,
      icon: undefined,
    });
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

describe("useGeocoder date prefix", () => {
  it("extracts a single-year date prefix and strips it before geocoding", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [
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
      await result.current.pinPlaces("2017 | Dublin, Ireland");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Dublin, Ireland", country: "ie" }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      date: "2017",
    });
  });

  it("extracts a multi-year date prefix alongside a tag suffix", async () => {
    const batchSpy = vi
      .spyOn(geocoderModule, "geocodeBatch")
      .mockResolvedValue({
        pinned: [
          {
            query: "Chamonix, France",
            name: "Chamonix, France",
            lng: 6.87,
            lat: 45.92,
          },
        ],
        failed: [],
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("2015, 2016 | Chamonix, France (ironman)");
    });

    expect(batchSpy).toHaveBeenCalledWith(
      [{ query: "Chamonix, France", country: "fr" }],
      "pk.test",
      undefined,
    );
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      date: "2015, 2016",
      icon: "triathlete",
    });
  });

  it("resolves a date prefix combined with a tag and explicit coordinates without calling geocodeBatch", async () => {
    const batchSpy = vi.spyOn(geocoderModule, "geocodeBatch");

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces(
        "2017 | Hong Kong SAR, China, 25.8144821,-80.176346, (home)",
      );
    });

    expect(batchSpy).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      date: "2017",
      icon: "house-home",
      lat: 25.8144821,
      lng: -80.176346,
      query: "Hong Kong SAR, China",
      name: "Hong Kong SAR, China",
    });
  });

  it("sets date to undefined for a plain line with no date prefix", async () => {
    vi.spyOn(geocoderModule, "geocodeBatch").mockResolvedValue({
      pinned: [
        { query: "Tokyo", name: "Tokyo, Japan", lng: 139.69, lat: 35.68 },
      ],
      failed: [],
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await result.current.pinPlaces("Tokyo");
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      date: undefined,
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

describe("pinPlaceSilent", () => {
  beforeEach(() => {
    // These tests pass a userId, unlike most of this file — that fires the
    // hook's own mount effect (fetchPins), which needs a resolved value.
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
  });

  it("resolves {status: 'ok', query: trimmed} and increments the counter only after a successful upsert", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });
    vi.mocked(pinsRepositoryModule.upsertPins).mockResolvedValue("ok");

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("  Paris  ", {
        category: "visited",
      });
    });

    expect(outcome).toEqual({ status: "ok", query: "Paris" });
    expect(result.current.pinnedPlaces).toEqual([
      {
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
        category: "visited",
      },
    ]);
    expect(tokenUsageModule.incrementPlacesPinned).toHaveBeenCalledWith(1);
    expect(result.current.error).toBeNull();
    expect(result.current.failedLines).toEqual([]);
  });

  it("resolves the existing pin's stored query on the dedup short-circuit, not the freshly typed text", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });
    vi.mocked(pinsRepositoryModule.upsertPins).mockResolvedValue("ok");

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );
    await act(async () => {
      await result.current.pinPlaceSilent("Paris", { category: "visited" });
    });
    vi.mocked(tokenUsageModule.incrementPlacesPinned).mockClear();

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("  paris  ", {
        category: "lived",
      });
    });

    expect(outcome).toEqual({ status: "ok", query: "Paris" });
    expect(result.current.pinnedPlaces).toHaveLength(1);
    expect(tokenUsageModule.incrementPlacesPinned).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic entry and resolves 'persistence-error' when upsertPins fails, without touching failedLines", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });
    vi.mocked(pinsRepositoryModule.upsertPins).mockResolvedValue("error");

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("Paris", {
        category: "visited",
      });
    });

    expect(outcome).toEqual({ status: "persistence-error" });
    expect(result.current.pinnedPlaces).toEqual([]);
    expect(tokenUsageModule.incrementPlacesPinned).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.failedLines).toEqual([]);
  });

  it("resolves 'geocode-error' on a geocode failure, without touching error/failedLines", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue(null);

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("Nowhereville", {
        category: "visited",
      });
    });

    expect(outcome).toEqual({ status: "geocode-error" });
    expect(result.current.error).toBeNull();
    expect(result.current.failedLines).toEqual([]);
  });

  it("resolves 'invalid' for empty input without geocoding", async () => {
    const lineSpy = vi.spyOn(geocoderModule, "geocodeLine");

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("   ", {
        category: "visited",
      });
    });

    expect(outcome).toEqual({ status: "invalid" });
    expect(lineSpy).not.toHaveBeenCalled();
  });

  it("shares one in-flight geocode/upsert between two concurrent calls for the same new query", async () => {
    let resolveGeocode: (value: GeocodeResult | null) => void = () => {};
    vi.spyOn(geocoderModule, "geocodeLine").mockReturnValue(
      new Promise((resolve) => {
        resolveGeocode = resolve;
      }),
    );
    vi.mocked(pinsRepositoryModule.upsertPins).mockResolvedValue("ok");

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    let first: ReturnType<typeof result.current.pinPlaceSilent>;
    let second: ReturnType<typeof result.current.pinPlaceSilent>;
    act(() => {
      first = result.current.pinPlaceSilent("Paris", { category: "visited" });
      second = result.current.pinPlaceSilent("paris", { category: "lived" });
    });

    await act(async () => {
      resolveGeocode({
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
      });
      await Promise.all([first, second]);
    });

    expect(geocoderModule.geocodeLine).toHaveBeenCalledTimes(1);
    expect(await first!).toEqual({ status: "ok", query: "Paris" });
    expect(await second!).toEqual({ status: "ok", query: "Paris" });
    expect(result.current.pinnedPlaces).toHaveLength(1);
    expect(tokenUsageModule.incrementPlacesPinned).toHaveBeenCalledTimes(1);
  });

  it("retries fresh (not a replay) after a prior attempt for the same query has settled", async () => {
    const lineSpy = vi.spyOn(geocoderModule, "geocodeLine");
    lineSpy.mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlaceSilent("Paris", { category: "visited" });
    });

    lineSpy.mockResolvedValueOnce({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });
    vi.mocked(pinsRepositoryModule.upsertPins).mockResolvedValue("ok");

    let outcome: Awaited<
      ReturnType<typeof result.current.pinPlaceSilent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.pinPlaceSilent("Paris", {
        category: "visited",
      });
    });

    expect(lineSpy).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ status: "ok", query: "Paris" });
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

    const marathon = {
      id: "marathon",
      label: "Marathon",
      color: "#8b5cf6",
      iconShape: "none" as const,
    };
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

describe("setLocation", () => {
  it("updates a pinned place's coordinates without changing its query or name", async () => {
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Hong Kong SAR, China",
      name: "Hongtong Xian, Linfen Shi, Shanxi, China",
      lng: 111.667,
      lat: 36.25,
    });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Hong Kong SAR, China", {
        category: "visited",
      });
    });

    act(() => {
      result.current.setLocation(
        "Hong Kong SAR, China",
        22.3193039,
        114.1693611,
      );
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      query: "Hong Kong SAR, China",
      lat: 22.3193039,
      lng: 114.1693611,
    });
  });
});

describe("relocatePlace", () => {
  it("re-geocodes new search text and updates name/lat/lng, keeping the original query", async () => {
    vi.spyOn(geocoderModule, "geocodeLine")
      .mockResolvedValueOnce({
        query: "Hong Kong SAR, China",
        name: "Hongtong Xian, Linfen Shi, Shanxi, China",
        lng: 111.667,
        lat: 36.25,
      })
      .mockResolvedValueOnce({
        query: "Hong Kong",
        name: "Hong Kong",
        lng: 114.1693611,
        lat: 22.3193039,
      });

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Hong Kong SAR, China", {
        category: "visited",
      });
    });

    await act(async () => {
      await result.current.relocatePlace("Hong Kong SAR, China", "Hong Kong");
    });

    expect(result.current.pinnedPlaces[0]).toMatchObject({
      query: "Hong Kong SAR, China",
      name: "Hong Kong",
      lat: 22.3193039,
      lng: 114.1693611,
    });
  });

  it("sets an error and leaves the place unchanged when the new search finds nothing", async () => {
    vi.spyOn(geocoderModule, "geocodeLine")
      .mockResolvedValueOnce({
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
      })
      .mockResolvedValueOnce(null);

    const { result } = renderHook(() => useGeocoder("pk.test"));
    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    await act(async () => {
      await result.current.relocatePlace("Paris", "Nowhereville");
    });

    expect(result.current.error).toContain("Nowhereville");
    expect(result.current.pinnedPlaces[0]).toMatchObject({
      name: "Paris, France",
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

describe("useGeocoder persistence", () => {
  it("calls fetchPins with the signed-in userId on mount and reflects the resolved places", async () => {
    const fixture: GeocodeResult[] = [paris];
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue(fixture);

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(pinsRepositoryModule.fetchPins).toHaveBeenCalledWith("user-1", []);
    expect(result.current.pinnedPlaces).toEqual(fixture);
  });

  it("falls back to the owner id when the visitor is anonymous", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([paris]);

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: null, ownerUserId: "owner-1" }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(pinsRepositoryModule.fetchPins).toHaveBeenCalledWith("owner-1", []);
    expect(result.current.pinnedPlaces).toEqual([paris]);
  });

  it("never calls fetchPins and stays empty with no userId or ownerUserId", async () => {
    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: null, ownerUserId: null }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(pinsRepositoryModule.fetchPins).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toEqual([]);
  });

  it("does not call fetchPins when no options are passed at all", async () => {
    const { result } = renderHook(() => useGeocoder("pk.test"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(pinsRepositoryModule.fetchPins).not.toHaveBeenCalled();
    expect(result.current.pinnedPlaces).toEqual([]);
  });

  it("pinPlace calls upsertPins with the new place when userId is set", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    expect(pinsRepositoryModule.upsertPins).toHaveBeenCalledWith("user-1", [
      {
        query: "Paris",
        name: "Paris, France",
        lng: 2.35,
        lat: 48.86,
        category: "visited",
      },
    ]);
  });

  it("pinPlace calls incrementPlacesPinned(1) when userId is set", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });

    expect(tokenUsageModule.incrementPlacesPinned).toHaveBeenCalledWith(1);
  });

  it("pinPlaces calls incrementPlacesPinned with the geocoded count when userId is set", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeBatch").mockResolvedValue({
      pinned: [paris],
      failed: [],
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlaces("Paris");
    });

    expect(tokenUsageModule.incrementPlacesPinned).toHaveBeenCalledWith(1);
  });

  it("pinPlaces calls incrementPlacesPinned with the explicit-coordinate count when userId is set", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlaces("Somewhere, 25.28,51.36");
    });

    expect(tokenUsageModule.incrementPlacesPinned).toHaveBeenCalledWith(1);
  });

  it("pinPlace does not call upsertPins when there is no userId", async () => {
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

    expect(pinsRepositoryModule.upsertPins).not.toHaveBeenCalled();
  });

  it("removePlace calls deletePin with the userId and query", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });
    act(() => {
      result.current.removePlace("Paris");
    });

    expect(pinsRepositoryModule.deletePin).toHaveBeenCalledWith(
      "user-1",
      "Paris",
    );
  });

  it("changeTag calls updatePinFields with category/icon/custom_tag_id", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });
    act(() => {
      result.current.changeTag("Paris", { category: "hometown" });
    });

    expect(pinsRepositoryModule.updatePinFields).toHaveBeenCalledWith(
      "user-1",
      "Paris",
      { category: "hometown", icon: null, custom_tag_id: null },
    );
  });

  it("setLocation calls updatePinFields with lat/lng", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);
    vi.spyOn(geocoderModule, "geocodeLine").mockResolvedValue({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });

    const { result } = renderHook(() =>
      useGeocoder("pk.test", { userId: "user-1" }),
    );

    await act(async () => {
      await result.current.pinPlace("Paris", { category: "visited" });
    });
    act(() => {
      result.current.setLocation("Paris", 10, 20);
    });

    expect(pinsRepositoryModule.updatePinFields).toHaveBeenCalledWith(
      "user-1",
      "Paris",
      { lat: 10, lng: 20 },
    );
  });

  it("re-fetches pins when userId changes across a re-render", async () => {
    vi.mocked(pinsRepositoryModule.fetchPins).mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useGeocoder("pk.test", { userId }),
      { initialProps: { userId: "user-1" } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(pinsRepositoryModule.fetchPins).toHaveBeenCalledWith("user-1", []);

    rerender({ userId: "user-2" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(pinsRepositoryModule.fetchPins).toHaveBeenCalledWith("user-2", []);
  });
});

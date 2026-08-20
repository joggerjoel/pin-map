import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeBatch, geocodeLine, parseLines } from "./geocoder";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseLines", () => {
  it("splits on newlines and trims whitespace", () => {
    expect(parseLines(" Paris \n Tokyo \n")).toEqual(["Paris", "Tokyo"]);
  });

  it("drops blank lines", () => {
    expect(parseLines("Paris\n\n\nTokyo")).toEqual(["Paris", "Tokyo"]);
  });

  it("dedupes case-insensitively while keeping the first casing seen", () => {
    expect(parseLines("Paris\nparis\nPARIS")).toEqual(["Paris"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseLines("   \n  \n")).toEqual([]);
  });
});

describe("geocodeLine", () => {
  it("returns the first feature's name and coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeLine("Paris", "pk.test");

    expect(result).toEqual({
      query: "Paris",
      name: "Paris, France",
      lng: 2.35,
      lat: 48.86,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("mapbox.places/Paris.json"),
    );
  });

  it("returns null when there are no features", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ features: [] })),
    );
    const result = await geocodeLine("Nowhereville", "pk.test");
    expect(result).toBeNull();
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 500)),
    );
    await expect(geocodeLine("Paris", "pk.test")).rejects.toThrow(
      "Mapbox geocoding request failed: 500",
    );
  });
});

describe("geocodeBatch", () => {
  it("collects successes into pinned and misses into failed", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("Paris")) {
        return jsonResponse({
          features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
        });
      }
      return jsonResponse({ features: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeBatch(["Paris", "Nowhereville"], "pk.test");

    expect(result.pinned).toEqual([
      { query: "Paris", name: "Paris, France", lng: 2.35, lat: 48.86 },
    ]);
    expect(result.failed).toEqual(["Nowhereville"]);
  });

  it("puts a single line's thrown error into failed without blocking others", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("Paris")) {
        return jsonResponse({
          features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
        });
      }
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeBatch(["Paris", "BadLine"], "pk.test");

    expect(result.pinned).toEqual([
      { query: "Paris", name: "Paris, France", lng: 2.35, lat: 48.86 },
    ]);
    expect(result.failed).toEqual(["BadLine"]);
  });

  it("rejects when every line fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(geocodeBatch(["Paris", "Tokyo"], "pk.test")).rejects.toThrow(
      "All geocoding requests failed",
    );
  });
});

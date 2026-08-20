import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeocodeAllFailedError,
  GeocodeRequestError,
  geocodeBatch,
  geocodeLine,
  parseLines,
  searchPlaces,
} from "./geocoder";

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

  it("throws a GeocodeRequestError carrying the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 401)),
    );
    await expect(geocodeLine("Paris", "pk.test")).rejects.toMatchObject({
      status: 401,
    });
    await expect(geocodeLine("Paris", "pk.test")).rejects.toBeInstanceOf(
      GeocodeRequestError,
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

    const result = await geocodeBatch(
      [{ query: "Paris" }, { query: "Nowhereville" }],
      "pk.test",
    );

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

    const result = await geocodeBatch(
      [{ query: "Paris" }, { query: "BadLine" }],
      "pk.test",
    );

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
    await expect(
      geocodeBatch([{ query: "Paris" }, { query: "Tokyo" }], "pk.test"),
    ).rejects.toThrow("All geocoding requests failed");
  });

  it("flags the failure as an auth error when every line 401s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 401)),
    );
    const rejection = await geocodeBatch(
      [{ query: "Paris" }, { query: "Tokyo" }],
      "pk.test",
    ).catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(GeocodeAllFailedError);
    expect((rejection as GeocodeAllFailedError).isAuthError).toBe(true);
  });

  it("does not flag a non-auth failure as an auth error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const rejection = await geocodeBatch(
      [{ query: "Paris" }, { query: "Tokyo" }],
      "pk.test",
    ).catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(GeocodeAllFailedError);
    expect((rejection as GeocodeAllFailedError).isAuthError).toBe(false);
  });
});

describe("geocodeLine with a country filter", () => {
  it("includes the country param in the request URL when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [
          { place_name: "Florida, United States", center: [-81.5, 27.7] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geocodeLine("Florida", "pk.test", "us");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("country=us"),
    );
  });

  it("omits the country param when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ features: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await geocodeLine("Paris", "pk.test");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.not.stringContaining("country="),
    );
  });
});

describe("geocodeBatch with a country filter", () => {
  it("passes the country filter through to every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [
          { place_name: "Florida, United States", center: [-81.5, 27.7] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geocodeBatch(
      [
        { query: "Florida", country: "us" },
        { query: "Georgia", country: "us" },
      ],
      "pk.test",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toContain("country=us");
    }
  });

  it("applies a different country filter per entry", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("Dublin")) {
        return jsonResponse({
          features: [{ place_name: "Dublin, Ireland", center: [-6.26, 53.35] }],
        });
      }
      return jsonResponse({
        features: [
          { place_name: "Portland, Maine, USA", center: [-70.26, 43.66] },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await geocodeBatch(
      [
        { query: "Dublin, Ireland", country: "ie" },
        { query: "Portland, Maine, USA", country: "us" },
      ],
      "pk.test",
    );

    const dublinCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("Dublin"),
    );
    const portlandCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("Portland"),
    );
    expect(dublinCall?.[0]).toContain("country=ie");
    expect(portlandCall?.[0]).toContain("country=us");
  });
});

describe("geocodeLine with a bbox filter", () => {
  it("includes the bbox param in the request URL when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geocodeLine("Paris", "pk.test", undefined, [-25, 34, 45, 72]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("bbox=-25%2C34%2C45%2C72"),
    );
  });

  it("omits the bbox param when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ features: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await geocodeLine("Paris", "pk.test");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.not.stringContaining("bbox="),
    );
  });
});

describe("searchPlaces", () => {
  it("returns up to 5 suggestions with an autocomplete request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [
          { place_name: "Paris, France", center: [2.35, 48.86] },
          {
            place_name: "Paris, Texas, United States",
            center: [-95.56, 33.66],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPlaces("Par", "pk.test");

    expect(results).toEqual([
      { query: "Par", name: "Paris, France", lng: 2.35, lat: 48.86 },
      {
        query: "Par",
        name: "Paris, Texas, United States",
        lng: -95.56,
        lat: 33.66,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("autocomplete=true"),
    );
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("limit=5"));
  });

  it("returns an empty array for a blank query without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPlaces("   ", "pk.test");

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array when there are no features", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ features: [] })),
    );

    const results = await searchPlaces("Nowhereville", "pk.test");

    expect(results).toEqual([]);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 500)),
    );

    await expect(searchPlaces("Paris", "pk.test")).rejects.toThrow(
      "Mapbox geocoding request failed: 500",
    );
  });
});

describe("geocodeBatch with a bbox filter", () => {
  it("passes the bbox filter through to every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geocodeBatch(
      [{ query: "Paris" }, { query: "Berlin" }],
      "pk.test",
      [-25, 34, 45, 72],
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toContain("bbox=");
    }
  });
});

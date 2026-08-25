import { describe, expect, test } from "bun:test";
import { geocodeBatch, normalizePlaceNameForGeocoding } from "./geocode";

function mockMapboxResponse(
  relevance: number,
  center: [number, number] = [103.82, 1.35],
) {
  return new Response(JSON.stringify({ features: [{ center, relevance }] }), {
    status: 200,
  });
}

describe("normalizePlaceNameForGeocoding", () => {
  test("lowercases and collapses whitespace", () => {
    expect(
      normalizePlaceNameForGeocoding("  Busselton,  Western Australia "),
    ).toBe("busselton, western australia");
  });
});

describe("geocodeBatch", () => {
  test("coalesces duplicate normalized names into a single Mapbox call", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return mockMapboxResponse(0.9);
    }) as typeof fetch;

    const result = await geocodeBatch(
      [
        { externalKey: "a", placeName: "Busselton, Western Australia" },
        { externalKey: "b", placeName: "  BUSSELTON, western australia  " },
        { externalKey: "c", placeName: "Busselton, Western Australia" },
      ],
      { mapboxToken: "test-token", fetchImpl },
    );

    expect(calls).toBe(1);
    expect(result.results.a).toEqual(result.results.b);
    expect(result.results.b).toEqual(result.results.c);
  });

  test("classifies confidence by the relevance threshold", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("high-conf")) return mockMapboxResponse(0.95);
      return mockMapboxResponse(0.5);
    }) as typeof fetch;

    const result = await geocodeBatch(
      [
        { externalKey: "a", placeName: "high-conf place" },
        { externalKey: "b", placeName: "low-conf place" },
      ],
      { mapboxToken: "test-token", fetchImpl },
    );

    expect(result.results.a.confidence).toBe("high");
    expect(result.results.b.confidence).toBe("low");
  });

  test("marks a name as failed when Mapbox returns no features", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ features: [] }), {
        status: 200,
      })) as typeof fetch;

    const result = await geocodeBatch(
      [{ externalKey: "a", placeName: "Nowhere At All" }],
      { mapboxToken: "test-token", fetchImpl },
    );

    expect(result.results.a).toEqual({
      lat: null,
      lng: null,
      confidence: "failed",
    });
  });

  test("marks a name as failed on a non-2xx response, not throwing", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", { status: 429 })) as typeof fetch;

    const result = await geocodeBatch(
      [{ externalKey: "a", placeName: "Anywhere" }],
      { mapboxToken: "test-token", fetchImpl },
    );

    expect(result.results.a.confidence).toBe("failed");
  });

  test("marks a name as failed when the fetch itself throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const result = await geocodeBatch(
      [{ externalKey: "a", placeName: "Anywhere" }],
      { mapboxToken: "test-token", fetchImpl },
    );

    expect(result.results.a.confidence).toBe("failed");
  });

  test("caps unique names per request and reports truncated", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return mockMapboxResponse(0.9);
    }) as typeof fetch;

    const inputs = Array.from({ length: 10 }, (_, i) => ({
      externalKey: `k${i}`,
      placeName: `Place ${i}`,
    }));

    const result = await geocodeBatch(inputs, {
      mapboxToken: "test-token",
      fetchImpl,
      maxUniqueNamesPerRequest: 4,
    });

    expect(calls).toBe(4);
    expect(result.truncated).toBe(true);
    expect(Object.keys(result.results)).toHaveLength(4);
  });

  test("does not report truncated when under the cap", async () => {
    const fetchImpl = (async () => mockMapboxResponse(0.9)) as typeof fetch;
    const result = await geocodeBatch(
      [{ externalKey: "a", placeName: "Somewhere" }],
      { mapboxToken: "test-token", fetchImpl, maxUniqueNamesPerRequest: 4 },
    );
    expect(result.truncated).toBe(false);
  });

  test("respects bounded concurrency (smoke test — never exceeds the limit in flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = (async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return mockMapboxResponse(0.9);
    }) as typeof fetch;

    const inputs = Array.from({ length: 20 }, (_, i) => ({
      externalKey: `k${i}`,
      placeName: `Unique Place ${i}`,
    }));

    await geocodeBatch(inputs, {
      mapboxToken: "test-token",
      fetchImpl,
      concurrency: 3,
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});

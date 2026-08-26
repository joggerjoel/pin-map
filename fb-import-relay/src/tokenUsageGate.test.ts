import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  checkQuota,
  fetchPlacesPinnedCount,
  incrementPlacesPinned,
  PLACES_PINNED_LIMIT,
} from "./tokenUsageGate";

const config = { supabaseUrl: "https://example.test", anonKey: "anon-key" };
const AUTH = "Bearer user-a-token";

let originalFetch: typeof fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init))) as typeof fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchPlacesPinnedCount", () => {
  test("returns the caller's current count", async () => {
    mockFetch((url, init) => {
      expect(url).toContain("/rest/v1/pinmap_token_usage");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        AUTH,
      );
      return new Response(JSON.stringify([{ places_pinned_count: 12 }]), {
        status: 200,
      });
    });
    expect(await fetchPlacesPinnedCount(AUTH, "user-a", config)).toBe(12);
  });

  test("returns 0 for a first-time caller with no row", async () => {
    mockFetch(() => new Response("[]", { status: 200 }));
    expect(await fetchPlacesPinnedCount(AUTH, "user-a", config)).toBe(0);
  });

  test("fails open (0) on a non-2xx response", async () => {
    mockFetch(() => new Response("error", { status: 500 }));
    expect(await fetchPlacesPinnedCount(AUTH, "user-a", config)).toBe(0);
  });

  test("fails open (0) when the request throws", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    expect(await fetchPlacesPinnedCount(AUTH, "user-a", config)).toBe(0);
  });
});

describe("checkQuota", () => {
  test("allows a batch that stays within the limit", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify([{ places_pinned_count: 40 }]), {
          status: 200,
        }),
    );
    const result = await checkQuota(AUTH, "user-a", 10, config);
    expect(result).toEqual({ allowed: true, currentCount: 40 });
  });

  test("rejects a batch that would cross the limit, even if current usage is under it", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify([{ places_pinned_count: 45 }]), {
          status: 200,
        }),
    );
    // 45 + 10 = 55 > 50 -- rejected even though 45 alone is under the cap.
    const result = await checkQuota(AUTH, "user-a", 10, config);
    expect(result.allowed).toBe(false);
  });

  test("allows a batch that exactly reaches the limit", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify([{ places_pinned_count: PLACES_PINNED_LIMIT - 5 }]),
          { status: 200 },
        ),
    );
    const result = await checkQuota(AUTH, "user-a", 5, config);
    expect(result.allowed).toBe(true);
  });

  test("rejects when already at or past the limit", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify([{ places_pinned_count: PLACES_PINNED_LIMIT }]),
          { status: 200 },
        ),
    );
    const result = await checkQuota(AUTH, "user-a", 1, config);
    expect(result.allowed).toBe(false);
  });
});

describe("incrementPlacesPinned", () => {
  test("calls the RPC with the batch's actual count", async () => {
    let capturedBody: unknown;
    mockFetch((url, init) => {
      expect(url).toContain("/rest/v1/rpc/pinmap_increment_usage");
      capturedBody = JSON.parse(init!.body as string);
      return new Response("null", { status: 200 });
    });
    await incrementPlacesPinned(AUTH, 7, config);
    expect(capturedBody).toEqual({ p_places_delta: 7, p_login_delta: 0 });
  });

  test("is a no-op for a zero or negative count", async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response("null", { status: 200 });
    });
    await incrementPlacesPinned(AUTH, 0, config);
    await incrementPlacesPinned(AUTH, -3, config);
    expect(called).toBe(false);
  });

  test("does not throw when the request fails (fire-and-forget)", async () => {
    mockFetch(() => {
      throw new Error("db down");
    });
    await expect(
      incrementPlacesPinned(AUTH, 3, config),
    ).resolves.toBeUndefined();
  });
});

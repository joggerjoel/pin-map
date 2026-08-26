import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchOwnerUserId, isOwner, verifyAuthenticated } from "./ownerGate";

const config = { supabaseUrl: "https://example.test", anonKey: "anon-key" };

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

describe("verifyAuthenticated", () => {
  test("rejects immediately with no network call when the header is missing", async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response("{}", { status: 200 });
    });

    const result = await verifyAuthenticated(null, config);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("rejects when GoTrue rejects the token", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyAuthenticated("Bearer bad-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("401");
  });

  test("accepts any valid token, not just the owner's", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "non-owner-id" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyAuthenticated(
      "Bearer valid-non-owner-token",
      config,
    );
    expect(result.ok).toBe(true);
    expect(result.userId).toBe("non-owner-id");
  });

  test("fails closed when the GoTrue request throws (network error)", async () => {
    mockFetch(() => {
      throw new Error("connection refused");
    });

    const result = await verifyAuthenticated("Bearer whatever", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("connection refused");
  });

  test("fails closed when GoTrue returns a body with no user id", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyAuthenticated("Bearer weird-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no user id");
  });
});

describe("isOwner", () => {
  test("true when the user_id is in pinmap_owner", async () => {
    mockFetch((url) => {
      expect(url).toContain("/rest/v1/pinmap_owner");
      return new Response(JSON.stringify([{ user_id: "owner-id" }]), {
        status: 200,
      });
    });

    expect(await isOwner("owner-id", config)).toBe(true);
  });

  test("false when the table returns no matching row", async () => {
    mockFetch(() => new Response("[]", { status: 200 }));
    expect(await isOwner("non-owner-id", config)).toBe(false);
  });

  test("fails closed (false) on a non-2xx response", async () => {
    mockFetch(() => new Response("error", { status: 500 }));
    expect(await isOwner("owner-id", config)).toBe(false);
  });

  test("fails closed (false) when the request throws", async () => {
    mockFetch(() => {
      throw new Error("db unreachable");
    });
    expect(await isOwner("owner-id", config)).toBe(false);
  });
});

describe("fetchOwnerUserId", () => {
  test("returns the owner's user_id", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify([{ user_id: "owner-id" }]), {
          status: 200,
        }),
    );
    expect(await fetchOwnerUserId(config)).toBe("owner-id");
  });

  test("returns null when the table is empty", async () => {
    mockFetch(() => new Response("[]", { status: 200 }));
    expect(await fetchOwnerUserId(config)).toBeNull();
  });

  test("returns null on a non-2xx response", async () => {
    mockFetch(() => new Response("error", { status: 500 }));
    expect(await fetchOwnerUserId(config)).toBeNull();
  });

  test("returns null when the request throws", async () => {
    mockFetch(() => {
      throw new Error("db unreachable");
    });
    expect(await fetchOwnerUserId(config)).toBeNull();
  });
});

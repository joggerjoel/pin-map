import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { verifyOwner } from "./ownerGate";

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

describe("verifyOwner", () => {
  test("rejects immediately with no network call when the header is missing", async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response("{}", { status: 200 });
    });

    const result = await verifyOwner(null, config);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("rejects when GoTrue rejects the token", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error("should not reach the owner-table check");
    });

    const result = await verifyOwner("Bearer bad-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("401");
  });

  test("rejects when GoTrue accepts the token but the user isn't in pinmap_owner", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "non-owner-id" }), {
          status: 200,
        });
      }
      if (url.includes("/rest/v1/pinmap_owner")) {
        return new Response("[]", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyOwner("Bearer valid-non-owner-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not the owner");
  });

  test("accepts a valid owner token", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "owner-id" }), {
          status: 200,
        });
      }
      if (url.includes("/rest/v1/pinmap_owner")) {
        return new Response(JSON.stringify([{ user_id: "owner-id" }]), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyOwner("Bearer valid-owner-token", config);
    expect(result.ok).toBe(true);
    expect(result.userId).toBe("owner-id");
  });

  test("fails closed when the GoTrue request throws (network error)", async () => {
    mockFetch(() => {
      throw new Error("connection refused");
    });

    const result = await verifyOwner("Bearer whatever", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("connection refused");
  });

  test("fails closed when the owner-table request throws after a valid token", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "owner-id" }), {
          status: 200,
        });
      }
      throw new Error("db unreachable");
    });

    const result = await verifyOwner("Bearer valid-owner-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("db unreachable");
  });

  test("fails closed when GoTrue returns a body with no user id", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error("should not reach the owner-table check");
    });

    const result = await verifyOwner("Bearer weird-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no user id");
  });
});

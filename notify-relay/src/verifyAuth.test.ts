import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { verifyAuthenticated } from "./verifyAuth";

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
    mockFetch(() => new Response("unauthorized", { status: 401 }));
    const result = await verifyAuthenticated("Bearer bad-token", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("401");
  });

  test("returns the verified user's id and email", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ id: "u1", email: "a@example.com" }), {
          status: 200,
        }),
    );
    const result = await verifyAuthenticated("Bearer good-token", config);
    expect(result).toEqual({ ok: true, userId: "u1", email: "a@example.com" });
  });

  test("fails closed when the response has no email", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ id: "u1" }), { status: 200 }),
    );
    const result = await verifyAuthenticated("Bearer good-token", config);
    expect(result.ok).toBe(false);
  });

  test("fails closed when the request throws", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    const result = await verifyAuthenticated("Bearer whatever", config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network down");
  });
});

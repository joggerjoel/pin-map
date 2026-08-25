import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchClientIp } from "./clientIp";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchClientIp", () => {
  test("parses the ip= line out of cdn-cgi/trace", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "fl=1a1\nh=map.joggerjoel.com\nip=203.0.113.42\nts=1700000000\n",
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    expect(await fetchClientIp()).toBe("203.0.113.42");
  });

  test("returns null on a non-2xx response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("error", { status: 500 }),
      ) as unknown as typeof fetch;
    expect(await fetchClientIp()).toBeNull();
  });

  test("returns null when the request throws", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await fetchClientIp()).toBeNull();
  });

  test("returns null when the response has no ip= line", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("fl=1a1\nh=example.com\n", { status: 200 }),
      ) as unknown as typeof fetch;
    expect(await fetchClientIp()).toBeNull();
  });
});

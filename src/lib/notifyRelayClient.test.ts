import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { notifyLogin } from "./notifyRelayClient";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("notifyLogin", () => {
  test("posts the ip and isNewAccount with a bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await notifyLogin("token-123", "203.0.113.42", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/notify-login");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-123",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ip: "203.0.113.42",
      isNewAccount: true,
    });
  });

  test("sends 'unknown' when ip is null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await notifyLogin("token-123", null, false);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      ip: "unknown",
      isNewAccount: false,
    });
  });

  test("does not throw when the request fails (fire-and-forget)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(
      notifyLogin("token-123", "1.2.3.4", false),
    ).resolves.toBeUndefined();
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

vi.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

function mockSession(
  email: string,
  id = "user-1",
  createdAt = "2020-01-01T00:00:00.000Z",
): Session {
  return {
    access_token: "token-abc",
    user: { email, id, created_at: createdAt },
  } as unknown as Session;
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // verifyOtp's success path fire-and-forgets a clientIp lookup + a
  // notify-relay call (see useAuth.ts) -- stub fetch globally here so
  // every test exercising that path hits this instead of the network,
  // rather than repeating the same stub per test.
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("ip=203.0.113.42", { status: 200 }),
    ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function defaultOnAuthStateChange() {
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>);
}

describe("useAuth", () => {
  it("starts as loading, then resolves to signed-out when there is no session", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();

    const { result } = renderHook(() => useAuth());

    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("signed-out");
    });
    expect(result.current.email).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it("resolves to signed-in with the session's user email when a session exists", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession("a@b.com") },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.status).toBe("signed-in");
    });
    expect(result.current.email).toBe("a@b.com");
    expect(result.current.userId).toBe("user-1");
  });

  it("updates status and email when onAuthStateChange fires with a new session", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    let capturedCallback:
      ((event: string, session: Session | null) => void) | undefined;
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(
      (callback) => {
        capturedCallback = callback as (
          event: string,
          session: Session | null,
        ) => void;
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>;
      },
    );

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.status).toBe("signed-out");
    });

    act(() => {
      capturedCallback?.("SIGNED_IN", mockSession("c@d.com", "user-2"));
    });

    expect(result.current.status).toBe("signed-in");
    expect(result.current.email).toBe("c@d.com");
    expect(result.current.userId).toBe("user-2");
  });

  it("sendOtp calls signInWithOtp with shouldCreateUser and returns no error on success", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({
      data: {},
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signInWithOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    let response: { error: string | null } | undefined;
    await act(async () => {
      response = await result.current.sendOtp("a@b.com");
    });

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      options: { shouldCreateUser: true },
    });
    expect(response).toEqual({ error: null });
  });

  it("sendOtp returns the error message on failure", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({
      data: {},
      error: { message: "rate limited" },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signInWithOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    let response: { error: string | null } | undefined;
    await act(async () => {
      response = await result.current.sendOtp("a@b.com");
    });

    expect(response).toEqual({ error: "rate limited" });
  });

  it("verifyOtp calls verifyOtp with email/token/type and returns no error on success", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({
      data: { session: mockSession("a@b.com"), user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.verifyOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    let response: { error: string | null } | undefined;
    await act(async () => {
      response = await result.current.verifyOtp("a@b.com", "123456");
    });

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      token: "123456",
      type: "email",
    });
    expect(response).toEqual({ error: null });
  });

  it("verifyOtp notifies notify-relay with the ip and isNewAccount=false for a long-existing account", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({
      data: { session: mockSession("a@b.com"), user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.verifyOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(async () => {
      await result.current.verifyOtp("a@b.com", "123456");
      // The notify call is fire-and-forget (not awaited by verifyOtp
      // itself) -- flush pending microtasks so it's had a chance to run.
      await Promise.resolve();
      await Promise.resolve();
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const notifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/notify-login"),
    );
    expect(notifyCall).toBeDefined();
    expect(
      (notifyCall![1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer token-abc");
    expect(JSON.parse(notifyCall![1].body as string)).toEqual({
      ip: "203.0.113.42",
      isNewAccount: false,
    });
  });

  it("verifyOtp reports isNewAccount=true when the account was just created", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({
      data: {
        session: mockSession("new@b.com", "user-3", new Date().toISOString()),
        user: null,
      },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.verifyOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(async () => {
      await result.current.verifyOtp("new@b.com", "123456");
      await Promise.resolve();
      await Promise.resolve();
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const notifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/notify-login"),
    );
    expect(JSON.parse(notifyCall![1].body as string)).toEqual({
      ip: "203.0.113.42",
      isNewAccount: true,
    });
  });

  it("verifyOtp returns the error message on failure", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "invalid code" },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.verifyOtp>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    let response: { error: string | null } | undefined;
    await act(async () => {
      response = await result.current.verifyOtp("a@b.com", "000000");
    });

    expect(response).toEqual({ error: "invalid code" });
  });

  it("signOut calls supabase.auth.signOut", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    defaultOnAuthStateChange();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signOut>>);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(async () => {
      await result.current.signOut();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});

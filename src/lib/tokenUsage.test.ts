import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTokenUsage,
  incrementLogin,
  incrementPlacesPinned,
  shouldForcePersonalToken,
} from "./tokenUsage";
import { supabase } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

interface ChainResult {
  data: unknown;
  error: unknown;
}

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => void;
}

function createChain(result: ChainResult = { data: null, error: null }): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

describe("fetchTokenUsage", () => {
  it("returns the stored counts on success", async () => {
    const chain = createChain({
      data: { places_pinned_count: 12, login_count: 3 },
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchTokenUsage("user-1");

    expect(result).toEqual({ placesPinnedCount: 12, loginCount: 3 });
    expect(supabase.from).toHaveBeenCalledWith("pinmap_token_usage");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns zeros when no row exists", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchTokenUsage("user-1")).toEqual({
      placesPinnedCount: 0,
      loginCount: 0,
    });
  });

  it("returns zeros on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchTokenUsage("user-1")).toEqual({
      placesPinnedCount: 0,
      loginCount: 0,
    });
  });

  it("resolves to zeros instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchTokenUsage("user-1")).resolves.toEqual({
      placesPinnedCount: 0,
      loginCount: 0,
    });
  });
});

describe("incrementPlacesPinned", () => {
  it("calls the increment RPC with a places delta and no login delta", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.rpc>>);

    await incrementPlacesPinned(3);

    expect(supabase.rpc).toHaveBeenCalledWith("pinmap_increment_usage", {
      p_places_delta: 3,
      p_login_delta: 0,
    });
  });

  it("does nothing when count is zero", async () => {
    await incrementPlacesPinned(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("does not throw when the call rejects", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("network down"));

    await expect(incrementPlacesPinned(1)).resolves.toBeUndefined();
  });
});

describe("incrementLogin", () => {
  it("calls the increment RPC with a login delta and no places delta", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.rpc>>);

    await incrementLogin();

    expect(supabase.rpc).toHaveBeenCalledWith("pinmap_increment_usage", {
      p_places_delta: 0,
      p_login_delta: 1,
    });
  });

  it("does not throw when the call rejects", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("network down"));

    await expect(incrementLogin()).resolves.toBeUndefined();
  });
});

describe("shouldForcePersonalToken", () => {
  it("is false well under both limits", () => {
    expect(
      shouldForcePersonalToken({ placesPinnedCount: 10, loginCount: 2 }),
    ).toBe(false);
  });

  it("is true once places pinned reaches the limit", () => {
    expect(
      shouldForcePersonalToken({ placesPinnedCount: 50, loginCount: 0 }),
    ).toBe(true);
  });

  it("is false at exactly the login limit", () => {
    expect(
      shouldForcePersonalToken({ placesPinnedCount: 0, loginCount: 10 }),
    ).toBe(false);
  });

  it("is true once logins exceed the limit", () => {
    expect(
      shouldForcePersonalToken({ placesPinnedCount: 0, loginCount: 11 }),
    ).toBe(true);
  });
});

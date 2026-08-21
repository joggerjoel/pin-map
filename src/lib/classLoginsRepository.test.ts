import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClassLogins, recordClassLogin } from "./classLoginsRepository";
import { supabase } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
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
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => void;
}

function createChain(result: ChainResult = { data: null, error: null }): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

const row = {
  user_id: "user-1",
  email: "joel@example.com",
  logged_in_at: "2026-08-20T20:00:00.000Z",
};

describe("recordClassLogin", () => {
  it("inserts a login row scoped to the class", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await recordClassLogin("belding1989", "user-1", "joel@example.com");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_class_logins");
    expect(chain.insert).toHaveBeenCalledWith({
      class_slug: "belding1989",
      user_id: "user-1",
      email: "joel@example.com",
    });
  });

  it("does not throw when the insert rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      recordClassLogin("belding1989", "user-1", "joel@example.com"),
    ).resolves.toBeUndefined();
  });
});

describe("fetchClassLogins", () => {
  it("maps rows into ClassLogin, filtered by class_slug and ordered by time", async () => {
    const chain = createChain({ data: [row], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchClassLogins("belding1989");

    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(chain.order).toHaveBeenCalledWith("logged_in_at");
    expect(result).toEqual([
      {
        userId: "user-1",
        email: "joel@example.com",
        loggedInAt: "2026-08-20T20:00:00.000Z",
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchClassLogins("belding1989")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchClassLogins("belding1989")).resolves.toEqual([]);
  });
});

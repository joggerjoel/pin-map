import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDeclutterEnabled,
  saveDeclutterEnabledRemote,
} from "./userSettings";
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
  maybeSingle: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
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
    upsert: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

describe("fetchDeclutterEnabled", () => {
  it("returns the stored value on success", async () => {
    const chain = createChain({
      data: { declutter_enabled: true },
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchDeclutterEnabled("user-1");

    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith("pinmap_user_settings");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when no row exists", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchDeclutterEnabled("user-1")).toBeNull();
  });

  it("returns null on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchDeclutterEnabled("user-1")).toBeNull();
  });

  it("resolves to null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchDeclutterEnabled("user-1")).resolves.toBeNull();
  });
});

describe("saveDeclutterEnabledRemote", () => {
  it("calls .upsert with the right row and onConflict", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await saveDeclutterEnabledRemote("user-1", true);

    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", declutter_enabled: true },
      { onConflict: "user_id" },
    );
  });

  it("does not throw when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      saveDeclutterEnabledRemote("user-1", false),
    ).resolves.toBeUndefined();
  });
});

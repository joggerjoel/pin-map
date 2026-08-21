import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllAccessStatuses,
  fetchOwnAccessStatus,
  setUserAccessStatus,
} from "./classUserAccessRepository";
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

describe("fetchOwnAccessStatus", () => {
  it("returns the stored status", async () => {
    const chain = createChain({ data: { status: "read_only" }, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchOwnAccessStatus("belding1989", "user-1")).toBe(
      "read_only",
    );
    expect(chain.eq).toHaveBeenNthCalledWith(1, "class_slug", "belding1989");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "user_id", "user-1");
  });

  it("defaults to active when there is no row", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchOwnAccessStatus("belding1989", "user-1")).toBe("active");
  });

  it("defaults to active instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchOwnAccessStatus("belding1989", "user-1")).resolves.toBe(
      "active",
    );
  });
});

describe("fetchAllAccessStatuses", () => {
  it("maps rows, filtered by class_slug", async () => {
    const chain = createChain({
      data: [
        { user_id: "user-1", email: "joel@example.com", status: "disabled" },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchAllAccessStatuses("belding1989");

    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(result).toEqual([
      { userId: "user-1", email: "joel@example.com", status: "disabled" },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchAllAccessStatuses("belding1989")).toEqual([]);
  });
});

describe("setUserAccessStatus", () => {
  it("upserts the status row scoped by class_slug and user_id", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await setUserAccessStatus(
      "belding1989",
      "user-1",
      "joel@example.com",
      "read_only",
      "admin@example.com",
    );

    expect(chain.upsert).toHaveBeenCalledWith(
      {
        class_slug: "belding1989",
        user_id: "user-1",
        email: "joel@example.com",
        status: "read_only",
        updated_by: "admin@example.com",
      },
      { onConflict: "class_slug,user_id" },
    );
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(
      await setUserAccessStatus(
        "belding1989",
        "user-1",
        "joel@example.com",
        "disabled",
        "admin@example.com",
      ),
    ).toBe(false);
  });

  it("returns false instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      setUserAccessStatus(
        "belding1989",
        "user-1",
        "joel@example.com",
        "active",
        "admin@example.com",
      ),
    ).resolves.toBe(false);
  });
});

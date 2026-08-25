import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOwnerId,
  fetchPins,
  upsertPins,
  updatePinFields,
  deletePin,
} from "./pinsRepository";
import { supabase } from "./supabaseClient";
import type { CustomTag } from "./customTags";
import type { PinnedPlace } from "../hooks/useGeocoder";

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
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => void;
}

// A small chainable mock: every query-builder method returns the same
// object (so any chain of .select().eq().limit().maybeSingle() etc. works
// regardless of order), and the object itself is thenable so `await`ing at
// any point in the chain resolves to the configured result.
function createChain(result: ChainResult = { data: null, error: null }): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

describe("fetchOwnerId", () => {
  it("returns the user_id from a successful response", async () => {
    const chain = createChain({ data: { user_id: "owner-1" }, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchOwnerId();

    expect(result).toBe("owner-1");
    expect(supabase.from).toHaveBeenCalledWith("pinmap_owner");
  });

  it("returns null when error is set", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchOwnerId()).toBeNull();
  });

  it("returns null when data is null", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchOwnerId()).toBeNull();
  });

  it("resolves to null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchOwnerId()).resolves.toBeNull();
  });
});

describe("fetchPins", () => {
  const customTags: CustomTag[] = [
    { id: "marathon", label: "Marathon", color: "#8b5cf6", iconShape: "none" },
  ];

  it("calls .eq with the right user id and maps rows into PinnedPlace", async () => {
    const chain = createChain({
      data: [
        {
          query: "Paris",
          name: "Paris, France",
          lat: 48.86,
          lng: 2.35,
          category: "visited",
          icon: null,
          custom_tag_id: "marathon",
          date: "2017",
        },
        {
          query: "Tokyo",
          name: "Tokyo, Japan",
          lat: 35.68,
          lng: 139.69,
          category: null,
          icon: null,
          custom_tag_id: null,
          date: null,
        },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchPins("user-1", customTags);

    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual([
      {
        query: "Paris",
        name: "Paris, France",
        lat: 48.86,
        lng: 2.35,
        category: "visited",
        icon: undefined,
        customTag: customTags[0],
        date: "2017",
      },
      {
        query: "Tokyo",
        name: "Tokyo, Japan",
        lat: 35.68,
        lng: 139.69,
        category: undefined,
        icon: undefined,
        customTag: undefined,
        date: undefined,
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchPins("user-1", [])).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchPins("user-1", [])).resolves.toEqual([]);
  });
});

describe("upsertPins", () => {
  const place: PinnedPlace = {
    query: "Paris",
    name: "Paris, France",
    lat: 48.86,
    lng: 2.35,
    category: "visited",
  };

  it("calls .upsert with correctly shaped rows and onConflict", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await upsertPins("user-1", [place]);

    expect(chain.upsert).toHaveBeenCalledWith(
      [
        {
          user_id: "user-1",
          query: "Paris",
          name: "Paris, France",
          lat: 48.86,
          lng: 2.35,
          category: "visited",
          icon: null,
          custom_tag_id: null,
          date: null,
        },
      ],
      { onConflict: "user_id,query" },
    );
  });

  it("does nothing when given an empty array", async () => {
    const result = await upsertPins("user-1", []);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(result).toBe("ok");
  });

  it("resolves 'ok' on a successful upsert", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(upsertPins("user-1", [place])).resolves.toBe("ok");
  });

  it("resolves 'error' when the response carries a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(upsertPins("user-1", [place])).resolves.toBe("error");
  });

  it("resolves 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(upsertPins("user-1", [place])).resolves.toBe("error");
  });
});

describe("updatePinFields", () => {
  it("calls .eq with user_id then query", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await updatePinFields("user-1", "Paris", { lat: 1, lng: 2 });

    expect(chain.update).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    expect(chain.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "query", "Paris");
  });

  it("does not throw when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      updatePinFields("user-1", "Paris", { lat: 1, lng: 2 }),
    ).resolves.toBeUndefined();
  });
});

describe("deletePin", () => {
  it("calls .eq with user_id then query", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await deletePin("user-1", "Paris");

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "query", "Paris");
  });

  it("does not throw when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(deletePin("user-1", "Paris")).resolves.toBeUndefined();
  });
});

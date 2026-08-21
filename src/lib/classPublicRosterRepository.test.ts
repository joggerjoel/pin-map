import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicRosterLocations } from "./classPublicRosterRepository";
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
  then: (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => void;
}

function createChain(result: ChainResult = { data: null, error: null }): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

const row = {
  id: 1,
  image_url:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  living_lat: 42.96,
  living_lng: -85.67,
};

describe("fetchPublicRosterLocations", () => {
  it("maps rows into PublicRosterLocation, filtered by class_slug", async () => {
    const chain = createChain({ data: [row], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchPublicRosterLocations("belding1989");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_class_roster_public");
    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(result).toEqual([
      {
        id: 1,
        imageUrl:
          "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
        livingLat: 42.96,
        livingLng: -85.67,
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchPublicRosterLocations("belding1989")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchPublicRosterLocations("belding1989")).resolves.toEqual(
      [],
    );
  });
});

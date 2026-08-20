import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoster, saveRosterPerson } from "./classRosterRepository";
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
  update: ReturnType<typeof vi.fn>;
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
    update: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    update: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

const row = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  image_url:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  high_school_name: "Jane Smith",
  current_name: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  living: "Grand Rapids, Michigan",
  current_location: "Chicago, Illinois",
};

describe("fetchRoster", () => {
  it("maps rows into RosterPerson, filtered by class_slug and ordered by id", async () => {
    const chain = createChain({ data: [row], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchRoster("belding1989");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_class_roster");
    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(chain.order).toHaveBeenCalledWith("id");
    expect(result).toEqual([
      {
        id: 1,
        filename: "class1989-001_sheet1_row1_col1.png",
        imageUrl:
          "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
        highSchoolName: "Jane Smith",
        currentName: "Jane Smith Johnson",
        hometown: "Belding, Michigan",
        living: "Grand Rapids, Michigan",
        currentLocation: "Chicago, Illinois",
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchRoster("belding1989")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchRoster("belding1989")).resolves.toEqual([]);
  });
});

describe("saveRosterPerson", () => {
  const update = {
    id: 1,
    highSchoolName: "Jane Smith",
    currentName: "Jane Smith Johnson",
    hometown: "Belding, Michigan",
    living: "Grand Rapids, Michigan",
    currentLocation: "Chicago, Illinois",
  };

  it("calls .update with the mapped fields, scoped by class_slug and id", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await saveRosterPerson("belding1989", update);

    expect(chain.update).toHaveBeenCalledWith({
      high_school_name: "Jane Smith",
      current_name: "Jane Smith Johnson",
      hometown: "Belding, Michigan",
      living: "Grand Rapids, Michigan",
      current_location: "Chicago, Illinois",
    });
    expect(chain.eq).toHaveBeenNthCalledWith(1, "class_slug", "belding1989");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "id", 1);
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await saveRosterPerson("belding1989", update)).toBe(false);
  });

  it("returns false instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(saveRosterPerson("belding1989", update)).resolves.toBe(false);
  });
});

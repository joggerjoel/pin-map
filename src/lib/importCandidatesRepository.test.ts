import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveCandidate,
  deferCandidate,
  fetchProgressCounts,
  fetchReviewableCandidates,
  insertCandidates,
  mergeCandidates,
  rejectCandidate,
  splitCandidate,
  updateCandidateFields,
  updateCandidateGeocode,
  type ImportCandidate,
} from "./importCandidatesRepository";
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
  count?: number | null;
}

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
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
    in: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

function makeCandidate(
  overrides: Partial<ImportCandidate> & { id: string },
): ImportCandidate {
  return {
    externalKey: `key-${overrides.id}`,
    placeName: "Somewhere",
    suggestedLat: null,
    suggestedLng: null,
    geocodeConfidence: null,
    visitTime: "2020-01-01T00:00:00.000Z",
    note: null,
    status: "pending",
    ...overrides,
  };
}

describe("fetchReviewableCandidates", () => {
  it("filters to pending/later, orders by visit_time desc, and maps rows", async () => {
    const chain = createChain({
      data: [
        {
          id: "c1",
          external_key: "key1",
          place_name: "Busselton, Western Australia",
          suggested_lat: -33.65,
          suggested_lng: 115.34,
          geocode_confidence: "high",
          visit_time: "2011-11-30T21:49:51.000Z",
          note: null,
          status: "pending",
        },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchReviewableCandidates("user-1");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_import_candidates");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.in).toHaveBeenCalledWith("status", ["pending", "later"]);
    expect(chain.order).toHaveBeenCalledWith("visit_time", {
      ascending: false,
    });
    expect(result).toEqual([
      {
        id: "c1",
        externalKey: "key1",
        placeName: "Busselton, Western Australia",
        suggestedLat: -33.65,
        suggestedLng: 115.34,
        geocodeConfidence: "high",
        visitTime: "2011-11-30T21:49:51.000Z",
        note: null,
        status: "pending",
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );
    expect(await fetchReviewableCandidates("user-1")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createRejectingChain() as unknown as ReturnType<typeof supabase.from>,
    );
    await expect(fetchReviewableCandidates("user-1")).resolves.toEqual([]);
  });
});

describe("insertCandidates", () => {
  it("upserts with ignoreDuplicates on user_id,external_key", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await insertCandidates("user-1", [
      {
        externalKey: "key1",
        placeName: "Singapore, Singapore",
        visitTime: "2011-03-28T08:22:52.000Z",
        note: null,
      },
    ]);

    expect(chain.upsert).toHaveBeenCalledWith(
      [
        {
          user_id: "user-1",
          external_key: "key1",
          place_name: "Singapore, Singapore",
          visit_time: "2011-03-28T08:22:52.000Z",
          note: null,
        },
      ],
      { onConflict: "user_id,external_key", ignoreDuplicates: true },
    );
  });

  it("does nothing when given an empty array", async () => {
    await insertCandidates("user-1", []);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not throw when the call rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createRejectingChain() as unknown as ReturnType<typeof supabase.from>,
    );
    await expect(
      insertCandidates("user-1", [
        {
          externalKey: "k",
          placeName: "Anywhere",
          visitTime: "2020-01-01T00:00:00.000Z",
          note: null,
        },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("updateCandidateGeocode", () => {
  it("updates suggested_lat/lng/confidence by id", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await updateCandidateGeocode("c1", {
      suggestedLat: 1.35,
      suggestedLng: 103.82,
      geocodeConfidence: "high",
    });

    expect(chain.update).toHaveBeenCalledWith({
      suggested_lat: 1.35,
      suggested_lng: 103.82,
      geocode_confidence: "high",
    });
    expect(chain.eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("updateCandidateFields", () => {
  it("only includes fields actually provided", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await updateCandidateFields("c1", { placeName: "New Name" });

    expect(chain.update).toHaveBeenCalledWith({ place_name: "New Name" });
  });
});

describe("rejectCandidate / deferCandidate", () => {
  it("rejectCandidate sets status=rejected and resolved_at", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await rejectCandidate("c1");

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", "c1");
  });

  it("deferCandidate sets status=later", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await deferCandidate("c1");

    expect(chain.update).toHaveBeenCalledWith({ status: "later" });
  });
});

describe("approveCandidate", () => {
  it("calls the RPC and returns the pin id", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: "pin-1",
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.rpc>>);

    const result = await approveCandidate("c1");

    expect(supabase.rpc).toHaveBeenCalledWith("approve_import_candidate", {
      p_candidate_id: "c1",
    });
    expect(result).toEqual({ pinId: "pin-1", error: null });
  });

  it("surfaces the RPC error message instead of throwing", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "candidate has no coordinates" },
    } as unknown as Awaited<ReturnType<typeof supabase.rpc>>);

    const result = await approveCandidate("c1");

    expect(result).toEqual({
      pinId: null,
      error: "candidate has no coordinates",
    });
  });

  it("catches a thrown error instead of rejecting", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("network down"));

    await expect(approveCandidate("c1")).resolves.toEqual({
      pinId: null,
      error: "network down",
    });
  });
});

describe("splitCandidate", () => {
  it("inserts one row per part with deterministic external_keys, duplicates photos, and marks the parent split", async () => {
    const parent = makeCandidate({
      id: "parent-1",
      externalKey: "parent-key",
      visitTime: "2019-03-01T00:00:00.000Z",
      note: "race weekend",
    });
    const insertedChildren = [
      {
        id: "child-1",
        external_key: "parent-key::split-1",
        place_name: "Start line",
        suggested_lat: null,
        suggested_lng: null,
        geocode_confidence: null,
        visit_time: "2019-03-01T00:00:00.000Z",
        note: "race weekend",
        status: "pending",
      },
      {
        id: "child-2",
        external_key: "parent-key::split-2",
        place_name: "Finish line",
        suggested_lat: null,
        suggested_lng: null,
        geocode_confidence: null,
        visit_time: "2019-03-01T00:00:00.000Z",
        note: "race weekend",
        status: "pending",
      },
    ];
    const candidatesChain = createChain({
      data: insertedChildren,
      error: null,
    });
    const photosChain = createChain({
      data: [{ storage_path: "u1/parent-1/photo.jpg" }],
      error: null,
    });
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === "pinmap_import_candidates"
        ? candidatesChain
        : photosChain) as unknown as typeof supabase.from);

    const result = await splitCandidate("user-1", parent, [
      { placeName: "Start line" },
      { placeName: "Finish line" },
    ]);

    expect(candidatesChain.insert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        external_key: "parent-key::split-1",
        place_name: "Start line",
        visit_time: "2019-03-01T00:00:00.000Z",
        note: "race weekend",
      },
      {
        user_id: "user-1",
        external_key: "parent-key::split-2",
        place_name: "Finish line",
        visit_time: "2019-03-01T00:00:00.000Z",
        note: "race weekend",
      },
    ]);
    expect(photosChain.select).toHaveBeenCalledWith("storage_path");
    expect(photosChain.eq).toHaveBeenCalledWith("candidate_id", "parent-1");
    expect(photosChain.insert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        candidate_id: "child-1",
        storage_path: "u1/parent-1/photo.jpg",
      },
      {
        user_id: "user-1",
        candidate_id: "child-2",
        storage_path: "u1/parent-1/photo.jpg",
      },
    ]);
    expect(candidatesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "split" }),
    );
    expect(candidatesChain.eq).toHaveBeenCalledWith("id", "parent-1");
    expect(result.map((c) => c.id)).toEqual(["child-1", "child-2"]);
  });

  it("does nothing for fewer than 2 parts", async () => {
    const parent = makeCandidate({ id: "parent-1" });
    const result = await splitCandidate("user-1", parent, [
      { placeName: "Only one" },
    ]);
    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns [] instead of throwing when the insert rejects", async () => {
    const parent = makeCandidate({ id: "parent-1" });
    vi.mocked(supabase.from).mockReturnValue(
      createRejectingChain() as unknown as ReturnType<typeof supabase.from>,
    );
    await expect(
      splitCandidate("user-1", parent, [
        { placeName: "A" },
        { placeName: "B" },
      ]),
    ).resolves.toEqual([]);
  });
});

describe("mergeCandidates", () => {
  it("duplicates each loser's photos onto the survivor and marks losers merged", async () => {
    const candidatesChain = createChain({ data: null, error: null });
    const photosChain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === "pinmap_import_candidates"
        ? candidatesChain
        : photosChain) as unknown as typeof supabase.from);

    await mergeCandidates("user-1", "survivor-1", ["loser-1", "loser-2"]);

    expect(photosChain.eq).toHaveBeenCalledWith("candidate_id", "loser-1");
    expect(photosChain.eq).toHaveBeenCalledWith("candidate_id", "loser-2");
    expect(candidatesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "merged",
        related_candidate_id: "survivor-1",
      }),
    );
    expect(candidatesChain.in).toHaveBeenCalledWith("id", [
      "loser-1",
      "loser-2",
    ]);
  });

  it("does nothing for an empty loser list", async () => {
    await mergeCandidates("user-1", "survivor-1", []);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not throw when the update rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createRejectingChain() as unknown as ReturnType<typeof supabase.from>,
    );
    await expect(
      mergeCandidates("user-1", "survivor-1", ["loser-1"]),
    ).resolves.toBeUndefined();
  });
});

describe("fetchProgressCounts", () => {
  it("queries total and non-pending counts with head:true/count:exact", async () => {
    const totalChain = createChain({ data: null, error: null, count: 157 });
    const reviewedChain = createChain({ data: null, error: null, count: 54 });
    vi.mocked(supabase.from)
      .mockReturnValueOnce(
        totalChain as unknown as ReturnType<typeof supabase.from>,
      )
      .mockReturnValueOnce(
        reviewedChain as unknown as ReturnType<typeof supabase.from>,
      );

    const result = await fetchProgressCounts("user-1");

    expect(totalChain.select).toHaveBeenCalledWith("*", {
      count: "exact",
      head: true,
    });
    expect(reviewedChain.neq).toHaveBeenCalledWith("status", "pending");
    expect(result).toEqual({ total: 157, reviewed: 54 });
  });

  it("returns zeros instead of throwing when the query rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createRejectingChain() as unknown as ReturnType<typeof supabase.from>,
    );
    await expect(fetchProgressCounts("user-1")).resolves.toEqual({
      total: 0,
      reviewed: 0,
    });
  });
});

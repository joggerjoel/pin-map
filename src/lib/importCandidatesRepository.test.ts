import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveCandidate,
  deferCandidate,
  fetchReviewableCandidates,
  insertCandidates,
  rejectCandidate,
  updateCandidateFields,
  updateCandidateGeocode,
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
}

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
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
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
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

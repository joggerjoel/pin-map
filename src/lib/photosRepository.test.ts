import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPhotosToGroup,
  assignPhotoPlace,
  createGroup,
  deleteGroup,
  deletePhoto,
  fetchAllPhotos,
  fetchAllPhotosCount,
  fetchGroupMembers,
  fetchGroups,
  fetchPhotos,
  fetchUnsortedPhotoCount,
  fetchUnsortedPhotos,
  findSimilarPhotos,
  removePhotosFromGroup,
  setPhotoLabel,
  skipPhoto,
  unassignPhoto,
  unskipPhoto,
  unsortedPhotoUrl,
  uploadPhoto,
} from "./photosRepository";
import type { UnsortedPhoto } from "./photosRepository";
import { supabase } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
    },
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
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => void;
}

function createChain(result: ChainResult = { data: null, error: null }): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    or: vi.fn(() => chain),
    contains: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

function createRejectingChain(): Chain {
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    or: vi.fn(() => chain),
    contains: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then: (_resolve, reject) => reject?.(new Error("network down")),
  };
  return chain;
}

function mockStorageBucket(overrides: {
  upload?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}) {
  const bucket = {
    upload: overrides.upload ?? vi.fn().mockResolvedValue({ error: null }),
    remove: overrides.remove ?? vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://cdn.example.com/${path}` },
    })),
  };
  vi.mocked(supabase.storage.from).mockReturnValue(
    bucket as unknown as ReturnType<typeof supabase.storage.from>,
  );
  return bucket;
}

describe("fetchPhotos", () => {
  it("maps rows into PlacePhoto with a public URL", async () => {
    mockStorageBucket({});
    const chain = createChain({
      data: [
        {
          id: "photo-1",
          place_query: "Paris",
          storage_path: "user-1/photo-1.jpg",
        },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchPhotos("user-1");

    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual([
      {
        id: "photo-1",
        placeQuery: "Paris",
        storagePath: "user-1/photo-1.jpg",
        url: "https://cdn.example.com/user-1/photo-1.jpg",
      },
    ]);
  });

  it("returns [] on error", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchPhotos("user-1")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    mockStorageBucket({});
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchPhotos("user-1")).resolves.toEqual([]);
  });
});

describe("uploadPhoto", () => {
  const file = new File(["fake"], "beach.jpg", { type: "image/jpeg" });

  it("uploads to storage, inserts a row, and returns the new photo", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: { id: "photo-1" }, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await uploadPhoto("user-1", "Paris", file);

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", place_query: "Paris" }),
    );
    expect(result).toMatchObject({ id: "photo-1", placeQuery: "Paris" });
    expect(result?.url).toContain("https://cdn.example.com/");
  });

  it("returns null when the storage upload fails", async () => {
    mockStorageBucket({
      upload: vi.fn().mockResolvedValue({ error: { message: "too big" } }),
    });

    const result = await uploadPhoto("user-1", "Paris", file);

    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns null when the row insert fails", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await uploadPhoto("user-1", "Paris", file)).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    mockStorageBucket({
      upload: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await expect(uploadPhoto("user-1", "Paris", file)).resolves.toBeNull();
  });
});

describe("deletePhoto", () => {
  it("removes the storage object and the row", async () => {
    const bucket = mockStorageBucket({});
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await deletePhoto("user-1", { id: "photo-1", storagePath: "user-1/a.jpg" });

    expect(bucket.remove).toHaveBeenCalledWith(["user-1/a.jpg"]);
    expect(chain.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "id", "photo-1");
  });

  it("does not throw when the call rejects", async () => {
    mockStorageBucket({
      remove: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await expect(
      deletePhoto("user-1", { id: "photo-1", storagePath: "user-1/a.jpg" }),
    ).resolves.toBeUndefined();
  });
});

describe("fetchUnsortedPhotoCount", () => {
  it("returns the count on success", async () => {
    const chain = createChain({ data: null, error: null, count: 42 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchUnsortedPhotoCount("user-1")).toBe(42);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.is).toHaveBeenCalledWith("skipped_at", null);
  });

  it("status: 'skipped' filters on place_query null and skipped_at not null", async () => {
    const chain = createChain({ data: null, error: null, count: 3 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchUnsortedPhotoCount("user-1", "skipped")).toBe(3);
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.not).toHaveBeenCalledWith("skipped_at", "is", null);
  });

  it("status: 'assigned' filters on place_query not null", async () => {
    const chain = createChain({ data: null, error: null, count: 5 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchUnsortedPhotoCount("user-1", "assigned")).toBe(5);
    expect(chain.not).toHaveBeenCalledWith("place_query", "is", null);
  });

  it("returns null (not 0) when the response carries a resolved error", async () => {
    const chain = createChain({
      data: null,
      error: { message: "boom" },
      count: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchUnsortedPhotoCount("user-1")).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchUnsortedPhotoCount("user-1")).resolves.toBeNull();
  });

  it("a taxonomy tag filters via .contains on tags", async () => {
    const chain = createChain({ data: null, error: null, count: 7 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(
      await fetchUnsortedPhotoCount("user-1", "unassigned", "animal"),
    ).toBe(7);
    expect(chain.contains).toHaveBeenCalledWith("tags", ["animal"]);
    expect(chain.is).not.toHaveBeenCalledWith("caption", null);
  });

  it("the reserved 'untagged' value maps to .is('caption', null), not .contains", async () => {
    const chain = createChain({ data: null, error: null, count: 2 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(
      await fetchUnsortedPhotoCount("user-1", "unassigned", "untagged"),
    ).toBe(2);
    expect(chain.is).toHaveBeenCalledWith("caption", null);
    expect(chain.contains).not.toHaveBeenCalled();
  });

  it("no tag argument issues no tags-related filter at all", async () => {
    const chain = createChain({ data: null, error: null, count: 9 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotoCount("user-1");
    expect(chain.contains).not.toHaveBeenCalled();
    expect(chain.is).not.toHaveBeenCalledWith("caption", null);
  });
});

describe("fetchUnsortedPhotos", () => {
  const rows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      storage_path: "user-1/a.jpg",
      created_at: "2026-01-01T00:00:00.000Z",
      label: "the beach one",
      place_query: null,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      storage_path: "user-1/b.mp4",
      created_at: "2026-01-02T00:00:00.000Z",
      label: null,
      place_query: null,
    },
  ];

  it("maps rows, derives kind from the extension, and carries the label", async () => {
    const chain = createChain({ data: rows, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
    });

    expect(result).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        storagePath: "user-1/a.jpg",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "image",
        label: "the beach one",
        placeQuery: null,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        storagePath: "user-1/b.mp4",
        createdAt: "2026-01-02T00:00:00.000Z",
        kind: "video",
        label: null,
        placeQuery: null,
      },
    ]);
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.is).toHaveBeenCalledWith("skipped_at", null);
    expect(chain.limit).toHaveBeenCalledWith(60);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it("defaults to the 'unassigned' status filter", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", { limit: 60, after: null });

    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.is).toHaveBeenCalledWith("skipped_at", null);
    expect(chain.not).not.toHaveBeenCalled();
  });

  it("status: 'skipped' filters on place_query null and skipped_at not null", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
      status: "skipped",
    });

    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.not).toHaveBeenCalledWith("skipped_at", "is", null);
  });

  it("status: 'assigned' filters on place_query not null, ignoring skipped_at", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
      status: "assigned",
    });

    expect(chain.not).toHaveBeenCalledWith("place_query", "is", null);
    expect(chain.is).not.toHaveBeenCalledWith("skipped_at", null);
  });

  it("builds the keyset .or() filter with the nested and() group when a cursor is given", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: {
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "11111111-1111-1111-1111-111111111111",
      },
    });

    expect(chain.or).toHaveBeenCalledWith(
      'created_at.gt."2026-01-01T00:00:00.000Z",and(created_at.eq."2026-01-01T00:00:00.000Z",id.gt."11111111-1111-1111-1111-111111111111")',
    );
  });

  it("returns null without querying when the cursor isn't a well-formed timestamp/uuid", async () => {
    const result = await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: { createdAt: "not-a-date", id: "not-a-uuid" },
    });

    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns null (not []) on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(
      await fetchUnsortedPhotos("user-1", { limit: 60, after: null }),
    ).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      fetchUnsortedPhotos("user-1", { limit: 60, after: null }),
    ).resolves.toBeNull();
  });

  it("selects caption/tags/skipped_at alongside the existing columns", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", { limit: 60, after: null });

    expect(chain.select).toHaveBeenCalledWith(
      "id, storage_path, created_at, label, place_query, skipped_at, caption, tags",
    );
  });

  it("maps caption/tags/skipped_at from the row onto the returned photo", async () => {
    const chain = createChain({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          storage_path: "user-1/a.jpg",
          created_at: "2026-01-01T00:00:00.000Z",
          label: null,
          place_query: null,
          skipped_at: "2026-01-02T00:00:00.000Z",
          caption: "a dog on a beach",
          tags: ["animal", "landscape"],
        },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
    });

    expect(result?.[0]).toMatchObject({
      skippedAt: "2026-01-02T00:00:00.000Z",
      caption: "a dog on a beach",
      tags: ["animal", "landscape"],
    });
  });

  it("a taxonomy tag filters via .contains on tags, alongside the status filter", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
      status: "skipped",
      tag: "people",
    });

    expect(chain.contains).toHaveBeenCalledWith("tags", ["people"]);
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.not).toHaveBeenCalledWith("skipped_at", "is", null);
  });

  it("the reserved 'untagged' value maps to .is('caption', null), not .contains", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchUnsortedPhotos("user-1", {
      limit: 60,
      after: null,
      tag: "untagged",
    });

    expect(chain.is).toHaveBeenCalledWith("caption", null);
    expect(chain.contains).not.toHaveBeenCalled();
  });
});

describe("fetchAllPhotos", () => {
  it("filters by user_id explicitly (not left to RLS) and applies no status filter", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchAllPhotos("user-1", { limit: 60, after: null });

    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.is).not.toHaveBeenCalled();
    expect(chain.not).not.toHaveBeenCalled();
  });

  it("a tag filter composes with the (absent) status filter the same way fetchUnsortedPhotos does", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchAllPhotos("user-1", { limit: 60, after: null, tag: "food" });

    expect(chain.contains).toHaveBeenCalledWith("tags", ["food"]);
  });

  it("a groupId uses the embedded-resource join, not a two-step id-list fetch", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchAllPhotos("user-1", {
      limit: 60,
      after: null,
      groupId: "group-1",
    });

    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining("pinmap_photo_group_members!inner(group_id)"),
    );
    expect(chain.eq).toHaveBeenCalledWith(
      "pinmap_photo_group_members.group_id",
      "group-1",
    );
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null without querying when the cursor isn't well-formed", async () => {
    const result = await fetchAllPhotos("user-1", {
      limit: 60,
      after: { createdAt: "not-a-date", id: "not-a-uuid" },
    });

    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(
      fetchAllPhotos("user-1", { limit: 60, after: null }),
    ).resolves.toBeNull();
  });
});

describe("fetchAllPhotosCount", () => {
  it("filters by user_id explicitly and returns the count", async () => {
    const chain = createChain({ data: null, error: null, count: 8037 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchAllPhotosCount("user-1")).toBe(8037);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("a groupId scopes the count through the same join fetchAllPhotos uses", async () => {
    const chain = createChain({ data: null, error: null, count: 12 });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchAllPhotosCount("user-1", { groupId: "group-1" })).toBe(
      12,
    );
    expect(chain.eq).toHaveBeenCalledWith(
      "pinmap_photo_group_members.group_id",
      "group-1",
    );
  });

  it("returns null on a resolved error", async () => {
    const chain = createChain({
      data: null,
      error: { message: "boom" },
      count: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchAllPhotosCount("user-1")).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchAllPhotosCount("user-1")).resolves.toBeNull();
  });
});

describe("fetchGroupMembers", () => {
  it("delegates to fetchAllPhotos with the groupId set and no status/tag filter", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await fetchGroupMembers("user-1", "group-1", { limit: 60, after: null });

    expect(chain.eq).toHaveBeenCalledWith(
      "pinmap_photo_group_members.group_id",
      "group-1",
    );
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.contains).not.toHaveBeenCalled();
  });
});

describe("createGroup", () => {
  it("inserts a trimmed name and returns the new group with memberCount 0", async () => {
    const chain = createChain({
      data: {
        id: "group-1",
        name: "Iceland 2024",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await createGroup("user-1", "  Iceland 2024  ");

    expect(result).toEqual({
      id: "group-1",
      name: "Iceland 2024",
      createdAt: "2026-01-01T00:00:00.000Z",
      memberCount: 0,
    });
    expect(chain.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "Iceland 2024",
    });
  });

  it("returns 'invalid' for a blank name without querying", async () => {
    expect(await createGroup("user-1", "   ")).toBe("invalid");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 'invalid' for a name over 100 characters without querying", async () => {
    expect(await createGroup("user-1", "x".repeat(101))).toBe("invalid");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 'limit' when the cap trigger's error message is matched", async () => {
    const chain = createChain({
      data: null,
      error: { message: "group limit reached (200 per account)" },
    });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await createGroup("user-1", "One too many")).toBe("limit");
  });

  it("returns 'error' for any other resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await createGroup("user-1", "Fine name")).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(createGroup("user-1", "Fine name")).resolves.toBe("error");
  });
});

describe("deleteGroup", () => {
  it("returns 'ok' on success", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await deleteGroup("group-1")).toBe("ok");
    expect(chain.eq).toHaveBeenCalledWith("id", "group-1");
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await deleteGroup("group-1")).toBe("error");
  });
});

describe("fetchGroups", () => {
  it("tallies member counts from a single second query, not one query per group", async () => {
    const groupsChain = createChain({
      data: [
        {
          id: "group-1",
          name: "Iceland",
          created_at: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "group-2",
          name: "Japan",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const membersChain = createChain({
      data: [
        { group_id: "group-1" },
        { group_id: "group-1" },
        { group_id: "group-2" },
      ],
      error: null,
    });
    vi.mocked(supabase.from).mockImplementation(
      (table: string) =>
        (table === "pinmap_photo_groups"
          ? groupsChain
          : membersChain) as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchGroups("user-1");

    expect(result).toEqual([
      {
        id: "group-1",
        name: "Iceland",
        createdAt: "2026-01-02T00:00:00.000Z",
        memberCount: 2,
      },
      {
        id: "group-2",
        name: "Japan",
        createdAt: "2026-01-01T00:00:00.000Z",
        memberCount: 1,
      },
    ]);
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(membersChain.in).toHaveBeenCalledWith("group_id", [
      "group-1",
      "group-2",
    ]);
  });

  it("skips the member-count query entirely when there are no groups", async () => {
    const groupsChain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      groupsChain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchGroups("user-1")).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns null when the groups query errors", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchGroups("user-1")).toBeNull();
  });
});

describe("addPhotosToGroup", () => {
  it("calls the RPC and returns the affected count", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: 3,
      error: null,
    } as never);

    const result = await addPhotosToGroup("group-1", ["p1", "p2", "p3"]);

    expect(result).toEqual({ added: 3 });
    expect(supabase.rpc).toHaveBeenCalledWith("add_photos_to_group", {
      p_group_id: "group-1",
      p_photo_ids: ["p1", "p2", "p3"],
    });
  });

  it("returns { added: 0 } without calling the RPC for an empty array", async () => {
    expect(await addPhotosToGroup("group-1", [])).toEqual({ added: 0 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("maps a P0002 error to 'group_not_found'", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "group not found" },
    } as never);

    expect(await addPhotosToGroup("group-1", ["p1"])).toBe("group_not_found");
  });

  it("maps any other error to 'error'", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
    } as never);

    expect(await addPhotosToGroup("group-1", ["p1"])).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("network down"));

    await expect(addPhotosToGroup("group-1", ["p1"])).resolves.toBe("error");
  });
});

describe("removePhotosFromGroup", () => {
  it("calls the RPC and returns the affected count", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: 2,
      error: null,
    } as never);

    const result = await removePhotosFromGroup("group-1", ["p1", "p2"]);

    expect(result).toEqual({ removed: 2 });
    expect(supabase.rpc).toHaveBeenCalledWith("remove_photos_from_group", {
      p_group_id: "group-1",
      p_photo_ids: ["p1", "p2"],
    });
  });

  it("returns { removed: 0 } without calling the RPC for an empty array", async () => {
    expect(await removePhotosFromGroup("group-1", [])).toEqual({
      removed: 0,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("maps a P0002 error to 'group_not_found'", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "group not found" },
    } as never);

    expect(await removePhotosFromGroup("group-1", ["p1"])).toBe(
      "group_not_found",
    );
  });
});

describe("findSimilarPhotos", () => {
  it("requests the RPC's clamped maximum (100) and maps rows the same way as fetchUnsortedPhotos", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        {
          id: "p2",
          storage_path: "user-1/b.jpg",
          place_query: "Paris",
          skipped_at: null,
          label: null,
          caption: "a cat",
          tags: ["animal"],
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    } as never);

    const result = await findSimilarPhotos("p1");

    expect(supabase.rpc).toHaveBeenCalledWith("find_similar_photos", {
      p_photo_id: "p1",
      p_limit: 100,
    });
    expect(result?.[0]).toMatchObject({
      id: "p2",
      placeQuery: "Paris",
      caption: "a cat",
      tags: ["animal"],
    });
  });

  it("returns null on a resolved error", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "boom" },
    } as never);

    expect(await findSimilarPhotos("p1")).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("network down"));

    await expect(findSimilarPhotos("p1")).resolves.toBeNull();
  });
});

describe("unsortedPhotoUrl", () => {
  const image: UnsortedPhoto = {
    id: "1",
    storagePath: "user-1/a.jpg",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "image",
    label: null,
    placeQuery: null,
    skippedAt: null,
    caption: null,
    tags: null,
  };
  const video: UnsortedPhoto = {
    id: "2",
    storagePath: "user-1/b.mp4",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "video",
    label: null,
    placeQuery: null,
    skippedAt: null,
    caption: null,
    tags: null,
  };

  it("requests a transform for an image thumbnail", () => {
    const bucket = mockStorageBucket({});

    unsortedPhotoUrl(image, "thumbnail");

    expect(bucket.getPublicUrl).toHaveBeenCalledWith("user-1/a.jpg", {
      transform: { width: 240 },
    });
  });

  it("requests no transform for an image at full size", () => {
    const bucket = mockStorageBucket({});

    unsortedPhotoUrl(image, "full");

    expect(bucket.getPublicUrl).toHaveBeenCalledWith("user-1/a.jpg", undefined);
  });

  it("never requests a transform for a video, even as a 'thumbnail'", () => {
    const bucket = mockStorageBucket({});

    unsortedPhotoUrl(video, "thumbnail");

    expect(bucket.getPublicUrl).toHaveBeenCalledWith("user-1/b.mp4", undefined);
  });
});

describe("assignPhotoPlace", () => {
  it("returns 'ok' when the update affects a row", async () => {
    const chain = createChain({ data: [{ id: "photo-1" }], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await assignPhotoPlace("photo-1", "Paris")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith({ place_query: "Paris" });
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
  });

  it("returns 'conflict' when the update matches zero rows with no error", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await assignPhotoPlace("photo-1", "Paris")).toBe("conflict");
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await assignPhotoPlace("photo-1", "Paris")).toBe("error");
  });

  it("returns 'error' for a blank placeQuery without calling Supabase", async () => {
    expect(await assignPhotoPlace("photo-1", "   ")).toBe("error");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(assignPhotoPlace("photo-1", "Paris")).resolves.toBe("error");
  });
});

describe("skipPhoto", () => {
  it("returns 'ok' when the update affects a row", async () => {
    const chain = createChain({ data: [{ id: "photo-1" }], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await skipPhoto("photo-1")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_at: expect.any(String) }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.is).toHaveBeenCalledWith("skipped_at", null);
  });

  it("returns 'conflict' when the update matches zero rows with no error (already assigned or already skipped)", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await skipPhoto("photo-1")).toBe("conflict");
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await skipPhoto("photo-1")).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(skipPhoto("photo-1")).resolves.toBe("error");
  });
});

describe("unskipPhoto", () => {
  it("returns 'ok' when the update affects a row", async () => {
    const chain = createChain({ data: [{ id: "photo-1" }], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unskipPhoto("photo-1")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith({ skipped_at: null });
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.not).toHaveBeenCalledWith("skipped_at", "is", null);
  });

  it("returns 'conflict' when the update matches zero rows with no error", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unskipPhoto("photo-1")).toBe("conflict");
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unskipPhoto("photo-1")).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(unskipPhoto("photo-1")).resolves.toBe("error");
  });
});

describe("unassignPhoto", () => {
  it("returns 'ok' when the update affects a row", async () => {
    const chain = createChain({ data: [{ id: "photo-1" }], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unassignPhoto("photo-1")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith({
      place_query: null,
      skipped_at: null,
    });
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(chain.not).toHaveBeenCalledWith("place_query", "is", null);
  });

  it("returns 'conflict' when the update matches zero rows with no error", async () => {
    const chain = createChain({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unassignPhoto("photo-1")).toBe("conflict");
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await unassignPhoto("photo-1")).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(unassignPhoto("photo-1")).resolves.toBe("error");
  });
});

describe("setPhotoLabel", () => {
  it("saves a trimmed label", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await setPhotoLabel("photo-1", "  the beach one  ")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith({ label: "the beach one" });
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
  });

  it("clears the label to null when given a blank string", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await setPhotoLabel("photo-1", "   ")).toBe("ok");
    expect(chain.update).toHaveBeenCalledWith({ label: null });
  });

  it("returns 'error' for a label over the length cap without calling Supabase", async () => {
    expect(await setPhotoLabel("photo-1", "x".repeat(101))).toBe("error");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 'error' on a resolved error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await setPhotoLabel("photo-1", "x")).toBe("error");
  });

  it("returns 'error' instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(setPhotoLabel("photo-1", "x")).resolves.toBe("error");
  });
});

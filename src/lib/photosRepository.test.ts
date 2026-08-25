import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignPhotoPlace,
  deletePhoto,
  fetchPhotos,
  fetchUnsortedPhotoCount,
  fetchUnsortedPhotos,
  unsortedPhotoUrl,
  uploadPhoto,
} from "./photosRepository";
import type { UnsortedPhoto } from "./photosRepository";
import { supabase } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
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
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
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
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    or: vi.fn(() => chain),
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
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    or: vi.fn(() => chain),
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
});

describe("fetchUnsortedPhotos", () => {
  const rows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      storage_path: "user-1/a.jpg",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      storage_path: "user-1/b.mp4",
      created_at: "2026-01-02T00:00:00.000Z",
    },
  ];

  it("maps rows and derives kind from the extension", async () => {
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
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        storagePath: "user-1/b.mp4",
        createdAt: "2026-01-02T00:00:00.000Z",
        kind: "video",
      },
    ]);
    expect(chain.is).toHaveBeenCalledWith("place_query", null);
    expect(chain.limit).toHaveBeenCalledWith(60);
    expect(chain.or).not.toHaveBeenCalled();
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
});

describe("unsortedPhotoUrl", () => {
  const image: UnsortedPhoto = {
    id: "1",
    storagePath: "user-1/a.jpg",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "image",
  };
  const video: UnsortedPhoto = {
    id: "2",
    storagePath: "user-1/b.mp4",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "video",
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

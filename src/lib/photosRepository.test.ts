import { afterEach, describe, expect, it, vi } from "vitest";
import { deletePhoto, fetchPhotos, uploadPhoto } from "./photosRepository";
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
}

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
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
    single: vi.fn(() => chain),
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
    single: vi.fn(() => chain),
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

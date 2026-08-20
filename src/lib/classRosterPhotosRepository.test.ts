import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteRosterPhoto,
  fetchRosterPhotos,
  uploadRosterPhoto,
} from "./classRosterPhotosRepository";
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

const row = {
  id: "photo-1",
  person_id: 5,
  storage_path: "user-1/class-roster/belding1989/5/abc.jpg",
  year: 1995,
};

describe("fetchRosterPhotos", () => {
  it("maps rows into RosterPersonPhoto, filtered by class_slug", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: [row], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchRosterPhotos("belding1989");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_class_roster_photos");
    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(result).toEqual([
      {
        id: "photo-1",
        personId: 5,
        storagePath: "user-1/class-roster/belding1989/5/abc.jpg",
        year: 1995,
        url: "https://cdn.example.com/user-1/class-roster/belding1989/5/abc.jpg",
      },
    ]);
  });

  it("returns [] on error", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchRosterPhotos("belding1989")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    mockStorageBucket({});
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchRosterPhotos("belding1989")).resolves.toEqual([]);
  });
});

describe("uploadRosterPhoto", () => {
  const file = new File(["fake"], "reunion.jpg", { type: "image/jpeg" });

  it("uploads to storage, inserts a row, and returns the new photo", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: { id: "photo-1" }, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await uploadRosterPhoto(
      "user-1",
      "belding1989",
      5,
      1995,
      file,
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        class_slug: "belding1989",
        person_id: 5,
        year: 1995,
        uploaded_by: "user-1",
      }),
    );
    expect(result).toMatchObject({ id: "photo-1", personId: 5, year: 1995 });
  });

  it("passes null year through for a recent (undated) photo", async () => {
    mockStorageBucket({});
    const chain = createChain({ data: { id: "photo-1" }, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await uploadRosterPhoto("user-1", "belding1989", 5, null, file);

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ year: null }),
    );
  });

  it("returns null when the storage upload fails", async () => {
    mockStorageBucket({
      upload: vi.fn().mockResolvedValue({ error: { message: "too big" } }),
    });

    const result = await uploadRosterPhoto(
      "user-1",
      "belding1989",
      5,
      null,
      file,
    );

    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    mockStorageBucket({
      upload: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await expect(
      uploadRosterPhoto("user-1", "belding1989", 5, null, file),
    ).resolves.toBeNull();
  });
});

describe("deleteRosterPhoto", () => {
  it("removes the storage object and the row", async () => {
    const bucket = mockStorageBucket({});
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await deleteRosterPhoto(
      "photo-1",
      "user-1/class-roster/belding1989/5/a.jpg",
    );

    expect(bucket.remove).toHaveBeenCalledWith([
      "user-1/class-roster/belding1989/5/a.jpg",
    ]);
    expect(chain.eq).toHaveBeenCalledWith("id", "photo-1");
  });

  it("does not throw when the call rejects", async () => {
    mockStorageBucket({
      remove: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await expect(
      deleteRosterPhoto("photo-1", "user-1/a.jpg"),
    ).resolves.toBeUndefined();
  });
});

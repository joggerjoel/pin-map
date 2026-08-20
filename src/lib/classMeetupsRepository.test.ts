import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMeetup,
  deleteMeetup,
  fetchMeetups,
} from "./classMeetupsRepository";
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

const row = {
  id: "meetup-1",
  submitted_by_email: "joel@example.com",
  met_person_id: 5,
  met_person_name: "Jane Smith Johnson",
  query: "Chicago",
  name: "Chicago, Illinois, USA",
  lat: 41.88,
  lng: -87.63,
  met_date: "06/1995",
};

describe("fetchMeetups", () => {
  it("maps rows into ClassMeetup, filtered by class_slug", async () => {
    const chain = createChain({ data: [row], error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await fetchMeetups("belding1989");

    expect(supabase.from).toHaveBeenCalledWith("pinmap_class_meetups");
    expect(chain.eq).toHaveBeenCalledWith("class_slug", "belding1989");
    expect(result).toEqual([
      {
        id: "meetup-1",
        submittedByEmail: "joel@example.com",
        metPersonId: 5,
        metPersonName: "Jane Smith Johnson",
        query: "Chicago",
        name: "Chicago, Illinois, USA",
        lat: 41.88,
        lng: -87.63,
        metDate: "06/1995",
      },
    ]);
  });

  it("returns [] on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await fetchMeetups("belding1989")).toEqual([]);
  });

  it("resolves to [] instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(fetchMeetups("belding1989")).resolves.toEqual([]);
  });
});

describe("addMeetup", () => {
  const newMeetup = {
    submittedBy: "user-1",
    submittedByEmail: "joel@example.com",
    metPersonId: 5,
    metPersonName: "Jane Smith Johnson",
    query: "Chicago",
    name: "Chicago, Illinois, USA",
    lat: 41.88,
    lng: -87.63,
    metDate: "06/1995",
  };

  it("inserts the mapped row and returns the created meetup", async () => {
    const chain = createChain({ data: row, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    const result = await addMeetup("belding1989", newMeetup);

    expect(chain.insert).toHaveBeenCalledWith({
      class_slug: "belding1989",
      submitted_by: "user-1",
      submitted_by_email: "joel@example.com",
      met_person_id: 5,
      met_person_name: "Jane Smith Johnson",
      query: "Chicago",
      name: "Chicago, Illinois, USA",
      lat: 41.88,
      lng: -87.63,
      met_date: "06/1995",
    });
    expect(result).toEqual({
      id: "meetup-1",
      submittedByEmail: "joel@example.com",
      metPersonId: 5,
      metPersonName: "Jane Smith Johnson",
      query: "Chicago",
      name: "Chicago, Illinois, USA",
      lat: 41.88,
      lng: -87.63,
      metDate: "06/1995",
    });
  });

  it("returns null on error", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    expect(await addMeetup("belding1989", newMeetup)).toBeNull();
  });

  it("returns null instead of throwing when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(addMeetup("belding1989", newMeetup)).resolves.toBeNull();
  });
});

describe("deleteMeetup", () => {
  it("calls .delete with the meetup id", async () => {
    const chain = createChain({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await deleteMeetup("meetup-1");

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", "meetup-1");
  });

  it("does not throw when the call rejects", async () => {
    const chain = createRejectingChain();
    vi.mocked(supabase.from).mockReturnValue(
      chain as unknown as ReturnType<typeof supabase.from>,
    );

    await expect(deleteMeetup("meetup-1")).resolves.toBeUndefined();
  });
});

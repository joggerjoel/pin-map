import { describe, expect, it } from "vitest";
import {
  groupByYear,
  sortCandidates,
  triageBucketFor,
  triageCandidates,
} from "./importCandidateOrder";
import type { ImportCandidate } from "./importCandidatesRepository";

function makeCandidate(
  overrides: Partial<ImportCandidate> & { id: string },
): ImportCandidate {
  return {
    externalKey: overrides.id,
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

describe("sortCandidates", () => {
  const a = makeCandidate({ id: "a", visitTime: "2019-06-01T00:00:00.000Z" });
  const b = makeCandidate({ id: "b", visitTime: "2021-06-01T00:00:00.000Z" });
  const c = makeCandidate({ id: "c", visitTime: "2020-06-01T00:00:00.000Z" });

  it("orders newest first by visitTime", () => {
    expect(sortCandidates([a, b, c], "newest").map((x) => x.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("orders oldest first by visitTime", () => {
    expect(sortCandidates([a, b, c], "oldest").map((x) => x.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortCandidates(input, "newest");
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("produces a stable random order across repeated calls with the same ids", () => {
    const first = sortCandidates([a, b, c], "random").map((x) => x.id);
    const second = sortCandidates([c, a, b], "random").map((x) => x.id);
    expect(second).toEqual(first);
  });
});

describe("triageBucketFor / triageCandidates", () => {
  it("buckets a candidate with no geocode result yet as still geocoding", () => {
    const candidate = makeCandidate({ id: "a", geocodeConfidence: null });
    expect(triageBucketFor(candidate)).toBe("geocoding");
  });

  it("buckets a high-confidence geocode as high-confidence", () => {
    const candidate = makeCandidate({ id: "a", geocodeConfidence: "high" });
    expect(triageBucketFor(candidate)).toBe("high-confidence");
  });

  it("buckets low and failed geocodes as needs-review", () => {
    expect(
      triageBucketFor(makeCandidate({ id: "a", geocodeConfidence: "low" })),
    ).toBe("needs-review");
    expect(
      triageBucketFor(makeCandidate({ id: "a", geocodeConfidence: "failed" })),
    ).toBe("needs-review");
  });

  it("splits a mixed list into the three buckets", () => {
    const high = makeCandidate({ id: "high", geocodeConfidence: "high" });
    const low = makeCandidate({ id: "low", geocodeConfidence: "low" });
    const failed = makeCandidate({
      id: "failed",
      geocodeConfidence: "failed",
    });
    const pending = makeCandidate({ id: "pending", geocodeConfidence: null });

    const result = triageCandidates([high, low, failed, pending]);

    expect(result.highConfidence).toEqual([high]);
    expect(result.needsReview).toEqual([low, failed]);
    expect(result.stillGeocoding).toEqual([pending]);
  });
});

describe("groupByYear", () => {
  it("groups candidates by the year of visitTime, preserving input order within a year", () => {
    const y2020a = makeCandidate({
      id: "2020a",
      visitTime: "2020-03-01T00:00:00.000Z",
    });
    const y2020b = makeCandidate({
      id: "2020b",
      visitTime: "2020-09-01T00:00:00.000Z",
    });
    const y2019 = makeCandidate({
      id: "2019",
      visitTime: "2019-01-01T00:00:00.000Z",
    });

    const groups = groupByYear([y2020a, y2020b, y2019]);

    expect([...groups.keys()]).toEqual([2020, 2019]);
    expect(groups.get(2020)?.map((c) => c.id)).toEqual(["2020a", "2020b"]);
    expect(groups.get(2019)?.map((c) => c.id)).toEqual(["2019"]);
  });

  it("returns an empty map for an empty list", () => {
    expect(groupByYear([]).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { parseRunArgs, isInShard } from "./backfill-photo-tags";

describe("parseRunArgs", () => {
  it("returns no shard/limit when neither flag is passed", () => {
    expect(parseRunArgs([])).toEqual({ shard: null, limit: null });
  });

  it("parses --index against the hardcoded SHARD_OF total", () => {
    expect(parseRunArgs(["--index=0"])).toEqual({
      shard: { index: 0, of: 2 },
      limit: null,
    });
    expect(parseRunArgs(["--index=1"])).toEqual({
      shard: { index: 1, of: 2 },
      limit: null,
    });
  });

  it("rejects an --index outside 0 <= index < SHARD_OF", () => {
    expect(() => parseRunArgs(["--index=2"])).toThrow(/0 <= index < 2/);
    expect(() => parseRunArgs(["--index=-1"])).toThrow(/0 <= index < 2/);
  });

  it("no longer accepts --of -- the total is a source constant, not a flag", () => {
    // An unrecognized flag is simply ignored by argv.find, not an error --
    // confirms --of doesn't do anything anymore rather than silently still
    // working the old way.
    expect(parseRunArgs(["--index=0", "--of=5"])).toEqual({
      shard: { index: 0, of: 2 },
      limit: null,
    });
  });

  it("parses --limit as a positive integer", () => {
    expect(parseRunArgs(["--limit=10"])).toEqual({ shard: null, limit: 10 });
  });

  it("rejects a non-positive-integer --limit", () => {
    expect(() => parseRunArgs(["--limit=0"])).toThrow(/positive integer/);
    expect(() => parseRunArgs(["--limit=-3"])).toThrow(/positive integer/);
    expect(() => parseRunArgs(["--limit=abc"])).toThrow(/positive integer/);
  });

  it("parses --index and --limit together", () => {
    expect(parseRunArgs(["--index=1", "--limit=5"])).toEqual({
      shard: { index: 1, of: 2 },
      limit: 5,
    });
  });
});

describe("isInShard -- SHARD_OF=2 partitions every id exactly once", () => {
  function randomUuid(): string {
    return crypto.randomUUID();
  }

  it("every id belongs to exactly one of shard 0 or shard 1 (no gap, no overlap)", () => {
    const shard0 = { index: 0, of: 2 };
    const shard1 = { index: 1, of: 2 };
    for (let i = 0; i < 2000; i++) {
      const id = randomUuid();
      const in0 = isInShard(id, shard0);
      const in1 = isInShard(id, shard1);
      expect(in0).not.toBe(in1); // exactly one is true, never both, never neither
    }
  });

  it("is deterministic for a given id", () => {
    const id = randomUuid();
    const shard = { index: 0, of: 2 };
    expect(isInShard(id, shard)).toBe(isInShard(id, shard));
  });
});

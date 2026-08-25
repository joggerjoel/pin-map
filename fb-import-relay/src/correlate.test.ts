import { describe, expect, test } from "bun:test";
import { correlate, type TimestampedItem } from "./correlate";
import type { CheckIn } from "./parsePlacesTaggedIn";

interface Photo extends TimestampedItem {
  filename: string;
}

function checkIn(placeName: string, iso: string): CheckIn {
  return { placeName, visitTime: new Date(iso) };
}

function photo(filename: string, iso: string): Photo {
  return { filename, timestamp: new Date(iso) };
}

describe("correlate", () => {
  test("matches an item within the default ±3 day window", () => {
    const checkIns = [checkIn("Singapore", "2011-03-28T08:00:00.000Z")];
    const photos = [photo("a.jpg", "2011-03-29T12:00:00.000Z")];
    const result = correlate(checkIns, photos);
    expect(result[0].matches).toHaveLength(1);
    expect(result[0].matches[0].filename).toBe("a.jpg");
  });

  test("does not match an item outside the window", () => {
    const checkIns = [checkIn("Singapore", "2011-03-28T08:00:00.000Z")];
    const photos = [photo("a.jpg", "2011-04-05T12:00:00.000Z")]; // 8 days later
    const result = correlate(checkIns, photos);
    expect(result[0].matches).toHaveLength(0);
  });

  test("matches items on both sides of the check-in", () => {
    const checkIns = [checkIn("Singapore", "2011-03-28T08:00:00.000Z")];
    const photos = [
      photo("before.jpg", "2011-03-26T08:00:00.000Z"),
      photo("after.jpg", "2011-03-30T08:00:00.000Z"),
    ];
    const result = correlate(checkIns, photos);
    const names = result[0].matches.map((m) => m.filename).sort();
    expect(names).toEqual(["after.jpg", "before.jpg"]);
  });

  test("respects a custom window", () => {
    const checkIns = [checkIn("Singapore", "2011-03-28T08:00:00.000Z")];
    const photos = [photo("a.jpg", "2011-03-29T12:00:00.000Z")]; // ~1.16 days later
    const oneDayMs = 24 * 60 * 60 * 1000;
    const result = correlate(checkIns, photos, oneDayMs);
    expect(result[0].matches).toHaveLength(0);
  });

  test("matches the same item to multiple nearby check-ins independently", () => {
    const checkIns = [
      checkIn("A", "2011-03-28T08:00:00.000Z"),
      checkIn("B", "2011-03-29T08:00:00.000Z"),
    ];
    const photos = [photo("shared.jpg", "2011-03-28T20:00:00.000Z")];
    const result = correlate(checkIns, photos);
    expect(result[0].matches).toHaveLength(1);
    expect(result[1].matches).toHaveLength(1);
  });

  test("returns an empty matches array, not undefined, when nothing matches", () => {
    const checkIns = [checkIn("Nowhere", "1999-01-01T00:00:00.000Z")];
    const photos = [photo("a.jpg", "2011-03-29T12:00:00.000Z")];
    const result = correlate(checkIns, photos);
    expect(result[0].matches).toEqual([]);
  });

  test("handles a large item set without quadratic blowup (smoke test)", () => {
    const checkIns = Array.from({ length: 200 }, (_, i) =>
      checkIn(`Place ${i}`, new Date(2020, 0, i + 1).toISOString()),
    );
    const photos = Array.from({ length: 5000 }, (_, i) =>
      photo(`p${i}.jpg`, new Date(2020, 0, (i % 400) + 1).toISOString()),
    );
    const start = performance.now();
    const result = correlate(checkIns, photos);
    const elapsedMs = performance.now() - start;
    expect(result).toHaveLength(200);
    expect(elapsedMs).toBeLessThan(500);
  });
});

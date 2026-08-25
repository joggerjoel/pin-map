import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodeHtmlEntities,
  parsePlacesTaggedIn,
  parseVisitTime,
} from "./parsePlacesTaggedIn";

const FIXTURE_PATH = resolve(
  import.meta.dir,
  "../../facebook-export/facebook-JoggerTech-2026-08-24-qBrGykc2/your_facebook_activity/posts/places_you_have_been_tagged_in.html",
);

describe("parseVisitTime", () => {
  test("parses am times", () => {
    const d = parseVisitTime("Oct 23, 2011 4:34:06 am");
    expect(d?.toISOString()).toBe("2011-10-23T04:34:06.000Z");
  });

  test("parses pm times, rolling the hour to 24h", () => {
    const d = parseVisitTime("Nov 30, 2011 9:49:51 pm");
    expect(d?.toISOString()).toBe("2011-11-30T21:49:51.000Z");
  });

  test("handles 12am (midnight) correctly", () => {
    const d = parseVisitTime("Mar 18, 2012 12:00:00 am");
    expect(d?.toISOString()).toBe("2012-03-18T00:00:00.000Z");
  });

  test("handles 12pm (noon) correctly", () => {
    const d = parseVisitTime("Jan 01, 2020 12:00:00 pm");
    expect(d?.toISOString()).toBe("2020-01-01T12:00:00.000Z");
  });

  test("returns null for unrecognized formats", () => {
    expect(parseVisitTime("not a date")).toBeNull();
    expect(parseVisitTime("")).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes named entities", () => {
    expect(decodeHtmlEntities("Rock &amp; Roll")).toBe("Rock & Roll");
    expect(decodeHtmlEntities("Joel&#039;s Place")).toBe("Joel's Place");
  });

  test("decodes numeric entities", () => {
    expect(decodeHtmlEntities("&#064;home")).toBe("@home");
  });

  test("leaves plain text untouched", () => {
    expect(decodeHtmlEntities("圓方")).toBe("圓方");
  });
});

describe("parsePlacesTaggedIn against the real fixture export", () => {
  const html = readFileSync(FIXTURE_PATH, "utf-8");
  const checkIns = parsePlacesTaggedIn(html);

  test("finds 157 usable check-ins (160 raw entries, 3 skipped)", () => {
    // The fixture has 160 <table> blocks total, but 3 of them (verified by
    // direct inspection) carry only a Visit time with no Place/Name section
    // at all — genuinely empty in Facebook's own export, not a markup
    // variant this parser fails to handle. A check-in with no place name
    // isn't actionable (nothing to geocode, nothing to show), so skipping
    // it here is correct, not a bug — this count was wrong ("160") in the
    // original plan/todo docs before this parser was written and tested
    // against the real file; both were corrected to 157 to match.
    expect(checkIns).toHaveLength(157);
  });

  test("extracts a known ASCII place name with the right timestamp", () => {
    const match = checkIns.find(
      (c) =>
        c.placeName === "Oxfam Trailwalker Starting point" &&
        c.visitTime.toISOString() === "2011-11-17T19:45:34.000Z",
    );
    expect(match).toBeDefined();
  });

  test("extracts a CJK place name correctly", () => {
    const match = checkIns.find(
      (c) =>
        c.placeName === "圓方" &&
        c.visitTime.toISOString() === "2012-09-01T06:40:30.000Z",
    );
    expect(match).toBeDefined();
  });

  test("preserves repeated place names as distinct check-ins (not deduped here)", () => {
    const busselton = checkIns.filter(
      (c) => c.placeName === "Busselton, Western Australia",
    );
    // At least the 5 known distinct visit times for this place in the fixture.
    expect(busselton.length).toBeGreaterThanOrEqual(5);
    const times = new Set(busselton.map((c) => c.visitTime.toISOString()));
    expect(times.size).toBe(busselton.length);
  });

  test("distinguishes near-duplicate place names ('圓方' vs 'ELEMENTS 圓方')", () => {
    const plain = checkIns.filter((c) => c.placeName === "圓方");
    const elements = checkIns.filter((c) => c.placeName === "ELEMENTS 圓方");
    expect(plain.length).toBeGreaterThan(0);
    expect(elements.length).toBeGreaterThan(0);
  });

  test("every check-in has a non-empty name and a valid Date", () => {
    for (const c of checkIns) {
      expect(c.placeName.length).toBeGreaterThan(0);
      expect(Number.isNaN(c.visitTime.getTime())).toBe(false);
    }
  });
});

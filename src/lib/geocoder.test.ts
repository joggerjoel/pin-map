import { describe, expect, it } from "vitest";
import { parseLines } from "./geocoder";

describe("parseLines", () => {
  it("splits on newlines and trims whitespace", () => {
    expect(parseLines(" Paris \n Tokyo \n")).toEqual(["Paris", "Tokyo"]);
  });

  it("drops blank lines", () => {
    expect(parseLines("Paris\n\n\nTokyo")).toEqual(["Paris", "Tokyo"]);
  });

  it("dedupes case-insensitively while keeping the first casing seen", () => {
    expect(parseLines("Paris\nparis\nPARIS")).toEqual(["Paris"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseLines("   \n  \n")).toEqual([]);
  });
});

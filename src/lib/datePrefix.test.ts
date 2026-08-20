import { describe, expect, it } from "vitest";
import { extractDatePrefix } from "./datePrefix";

describe("extractDatePrefix", () => {
  it("extracts a single-year prefix", () => {
    expect(extractDatePrefix("2017 | Dublin, Ireland")).toEqual({
      date: "2017",
      rest: "Dublin, Ireland",
    });
  });

  it("extracts a multi-year prefix", () => {
    expect(
      extractDatePrefix("2015, 2016 | Chamonix, France (ironman)"),
    ).toEqual({
      date: "2015, 2016",
      rest: "Chamonix, France (ironman)",
    });
  });

  it("tolerates extra whitespace around the pipe", () => {
    expect(extractDatePrefix("2017  |  Dublin, Ireland")).toEqual({
      date: "2017",
      rest: "Dublin, Ireland",
    });
  });

  it("returns null when there is no pipe at all", () => {
    expect(extractDatePrefix("Dublin, Ireland")).toBeNull();
  });

  it("returns null when the pipe has nothing after it", () => {
    expect(extractDatePrefix("2017 |")).toBeNull();
  });

  it("returns null for a non-4-digit prefix", () => {
    expect(extractDatePrefix("17 | Dublin")).toBeNull();
  });

  it("returns null for a line with no date and no pipe", () => {
    expect(extractDatePrefix("Bintan Island")).toBeNull();
  });
});

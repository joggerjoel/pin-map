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

  it("extracts a month/year prefix", () => {
    expect(extractDatePrefix("03/2020 | Chicago, Illinois")).toEqual({
      date: "03/2020",
      rest: "Chicago, Illinois",
    });
  });

  it("extracts a year-range prefix", () => {
    expect(extractDatePrefix("2015 - 2016 | Chamonix, France")).toEqual({
      date: "2015 - 2016",
      rest: "Chamonix, France",
    });
  });

  it("extracts a month/year-range prefix", () => {
    expect(
      extractDatePrefix("03/2020 - 06/2020 | Sabbatical in Lisbon"),
    ).toEqual({
      date: "03/2020 - 06/2020",
      rest: "Sabbatical in Lisbon",
    });
  });

  it("extracts a month/day/year-range prefix", () => {
    expect(
      extractDatePrefix("03/15/2020 - 03/20/2020 | Big Bend National Park"),
    ).toEqual({
      date: "03/15/2020 - 03/20/2020",
      rest: "Big Bend National Park",
    });
  });
});

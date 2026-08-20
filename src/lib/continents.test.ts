import { describe, expect, it } from "vitest";
import { CONTINENTS, getContinentBbox } from "./continents";

describe("getContinentBbox", () => {
  it("returns the bounding box for a known continent", () => {
    expect(getContinentBbox("europe")).toEqual([-25, 34, 45, 72]);
  });

  it("returns a bbox for every continent listed in CONTINENTS", () => {
    for (const option of CONTINENTS) {
      expect(getContinentBbox(option.value)).toEqual(option.bbox);
    }
  });
});

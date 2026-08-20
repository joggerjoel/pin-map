import { describe, expect, it } from "vitest";
import { toGeoJsonStateName } from "./stateNames";

describe("toGeoJsonStateName", () => {
  it("passes through a name with no known alias unchanged", () => {
    expect(toGeoJsonStateName("Michigan")).toBe("Michigan");
  });

  it("maps 'Washington DC' to the GeoJSON dataset's 'District of Columbia'", () => {
    expect(toGeoJsonStateName("Washington DC")).toBe("District of Columbia");
  });

  it("is case-insensitive on the input", () => {
    expect(toGeoJsonStateName("washington dc")).toBe("District of Columbia");
    expect(toGeoJsonStateName("WASHINGTON DC")).toBe("District of Columbia");
  });
});

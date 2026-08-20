import { describe, expect, it } from "vitest";
import { extractExplicitCoords } from "./explicitCoords";

describe("extractExplicitCoords", () => {
  it("extracts a name and trailing lat,lng pair", () => {
    expect(
      extractExplicitCoords("Hong Kong SAR, China, 25.8144821,-80.176346"),
    ).toEqual({
      name: "Hong Kong SAR, China",
      lat: 25.8144821,
      lng: -80.176346,
    });
  });

  it("extracts a name and trailing lat,lng pair for another example", () => {
    expect(
      extractExplicitCoords("Macau Island, China, 13.7308093,121.8832412"),
    ).toEqual({
      name: "Macau Island, China",
      lat: 13.7308093,
      lng: 121.8832412,
    });
  });

  it("returns null for a plain line with no coordinate pair", () => {
    expect(extractExplicitCoords("Paris, France")).toBeNull();
  });

  it("returns null for an out-of-range coordinate pair", () => {
    expect(extractExplicitCoords("Somewhere, 200.5,300.2")).toBeNull();
  });

  it("returns null for a line with only a single decimal number", () => {
    expect(extractExplicitCoords("Exit 12.5")).toBeNull();
  });

  it("returns null for a bare coordinate pair with no name", () => {
    expect(extractExplicitCoords("25.8144821,-80.176346")).toBeNull();
  });
});

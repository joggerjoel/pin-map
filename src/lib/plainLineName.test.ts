import { describe, expect, it } from "vitest";
import { resolvePlainLineName } from "./plainLineName";

describe("resolvePlainLineName", () => {
  it("returns the plain name with no icon or coords", () => {
    expect(resolvePlainLineName("Paris, France")).toEqual({
      name: "Paris, France",
      icon: undefined,
      explicitCoords: undefined,
    });
  });

  it("strips a tag suffix and attaches the icon", () => {
    expect(resolvePlainLineName("Nice, France (ironman)")).toEqual({
      name: "Nice, France",
      icon: "triathlete",
      explicitCoords: undefined,
    });
  });

  it("extracts explicit coordinates and a tag suffix together", () => {
    expect(
      resolvePlainLineName(
        "Hong Kong SAR, China, 25.8144821,-80.176346, (home)",
      ),
    ).toEqual({
      name: "Hong Kong SAR, China",
      icon: "house-home",
      explicitCoords: { lat: 25.8144821, lng: -80.176346 },
    });
  });

  it("extracts explicit coordinates with no tag", () => {
    expect(
      resolvePlainLineName("Macau Island, China, 13.7308093,121.8832412"),
    ).toEqual({
      name: "Macau Island, China",
      icon: undefined,
      explicitCoords: { lat: 13.7308093, lng: 121.8832412 },
    });
  });
});

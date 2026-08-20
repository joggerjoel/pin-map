import { describe, expect, it } from "vitest";
import { extractPlaceIcon } from "./placeTags";

describe("extractPlaceIcon", () => {
  it("extracts the ironman tag and strips it from the query", () => {
    expect(extractPlaceIcon("Kailua-Kona, Hawaii (ironman)")).toEqual({
      query: "Kailua-Kona, Hawaii",
      icon: "triathlete",
    });
  });

  it("is case-insensitive on the tag name", () => {
    expect(extractPlaceIcon("Nice, France (Ironman)")).toEqual({
      query: "Nice, France",
      icon: "triathlete",
    });
  });

  it("returns the line unchanged with no icon when there's no parenthetical", () => {
    expect(extractPlaceIcon("Dublin, Ireland")).toEqual({
      query: "Dublin, Ireland",
      icon: undefined,
    });
  });

  it("returns the line unchanged with no icon when the parenthetical isn't a recognized tag", () => {
    expect(extractPlaceIcon("Paris, France (favorite)")).toEqual({
      query: "Paris, France (favorite)",
      icon: undefined,
    });
  });

  it("trims whitespace left behind after stripping the tag", () => {
    expect(extractPlaceIcon("  Nice, France (ironman)  ")).toEqual({
      query: "Nice, France",
      icon: "triathlete",
    });
  });

  it("extracts the home tag and strips it from the query", () => {
    expect(extractPlaceIcon("Belding, Michigan (home)")).toEqual({
      query: "Belding, Michigan",
      icon: "house-home",
    });
  });

  it("extracts the live tag and strips it from the query", () => {
    expect(extractPlaceIcon("Chicago, Illinois (live)")).toEqual({
      query: "Chicago, Illinois",
      icon: "house-live",
    });
  });

  it("extracts the lived tag as an alias for live", () => {
    expect(extractPlaceIcon("Chicago, Illinois (lived)")).toEqual({
      query: "Chicago, Illinois",
      icon: "house-live",
    });
  });

  it("extracts the air tag and strips it from the query", () => {
    expect(
      extractPlaceIcon("Newark Liberty International Airport, USA (air)"),
    ).toEqual({
      query: "Newark Liberty International Airport, USA",
      icon: "airplane",
    });
  });
});

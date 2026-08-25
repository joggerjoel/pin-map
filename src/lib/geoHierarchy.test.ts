import { describe, expect, it } from "vitest";
import {
  buildGeoTree,
  countPlacesUnder,
  getDominantAppearance,
} from "./geoHierarchy";
import type { PinnedPlace } from "../hooks/useGeocoder";
import { BUILTIN_APPEARANCE_DEFAULTS } from "./tagAppearance";

function place(name: string, lat: number, lng: number): PinnedPlace {
  return { query: name, name, lat, lng };
}

describe("buildGeoTree", () => {
  it("walks continent → country → state → city for a 3-segment name", () => {
    const rutland = place("Rutland, Vermont, United States", 43.6, -72.97);
    const tree = buildGeoTree([rutland]);

    const continent = tree.children.get("North America");
    expect(continent).toBeDefined();
    const country = continent!.children.get("United States");
    expect(country).toBeDefined();
    const state = country!.children.get("Vermont");
    expect(state).toBeDefined();
    const city = state!.children.get("Rutland");
    expect(city).toBeDefined();
    expect(city!.places).toEqual([rutland]);
  });

  it("walks continent → country → city for a 2-segment name (no state level)", () => {
    const paris = place("Paris, France", 48.86, 2.35);
    const tree = buildGeoTree([paris]);

    const continent = tree.children.get("Europe");
    const country = continent!.children.get("France");
    expect(country!.children.size).toBe(1);
    const city = country!.children.get("Paris");
    expect(city!.places).toEqual([paris]);
  });

  it("groups multiple pins under the same city node", () => {
    const a = place("Paris, France", 48.86, 2.35);
    const b = place("Paris, France", 48.87, 2.36);
    const tree = buildGeoTree([a, b]);

    const city = tree.children
      .get("Europe")!
      .children.get("France")!
      .children.get("Paris")!;
    expect(city.places).toEqual([a, b]);
  });

  it("groups a country with both direct city pins and state-grouped pins", () => {
    const paris = place("Paris, France", 48.86, 2.35); // 2-segment, no state
    const lyon = place("Lyon, Auvergne-Rhone-Alpes, France", 45.76, 4.83); // 3-segment
    const tree = buildGeoTree([paris, lyon]);

    const france = tree.children.get("Europe")!.children.get("France")!;
    expect(france.children.has("Paris")).toBe(true); // direct city node
    expect(france.children.has("Auvergne-Rhone-Alpes")).toBe(true); // state node
  });

  it("assigns the correct continent by lat/lng", () => {
    const sydney = place("Sydney, Australia", -33.87, 151.21);
    const tree = buildGeoTree([sydney]);
    expect(tree.children.has("Oceania")).toBe(true);
  });

  it("falls back to a single-level node for a name with no commas", () => {
    const somewhere = place("Antarctica", -75, 0);
    const tree = buildGeoTree([somewhere]);
    // No continent bbox covers Antarctica in this app's CONTINENTS list —
    // falls back to "Other", one level deep, no country/state/city split.
    const other = tree.children.get("Other")!;
    expect(other.children.get("Antarctica")!.places).toEqual([somewhere]);
  });

  it("strips a trailing zip code from a segment so it merges with the clean version", () => {
    const withZip = place("Ludlow, Vermont 05149, United States", 43.4, -72.7);
    const clean = place("Rutland, Vermont, United States", 43.6, -72.97);
    const tree = buildGeoTree([withZip, clean]);

    const usa = tree.children
      .get("North America")!
      .children.get("United States")!;
    expect(usa.children.has("Vermont")).toBe(true);
    expect(usa.children.has("Vermont 05149")).toBe(false);
    expect(usa.children.get("Vermont")!.children.has("Ludlow")).toBe(true);
    expect(usa.children.get("Vermont")!.children.has("Rutland")).toBe(true);
  });

  it("strips a zip+4 code the same way", () => {
    const withZipPlus4 = place("Phoenix, Arizona 86314-1234", 33.45, -112.07);
    const tree = buildGeoTree([withZipPlus4]);
    // 2-segment name here (no country), so continent → Arizona (cleaned).
    const continent = [...tree.children.values()][0];
    expect(continent.children.has("Arizona")).toBe(true);
    expect(continent.children.has("Arizona 86314-1234")).toBe(false);
  });
});

describe("countPlacesUnder", () => {
  it("counts places attached anywhere at or below a node, not just directly", () => {
    const paris = place("Paris, France", 48.86, 2.35);
    const lyon = place("Lyon, Auvergne-Rhone-Alpes, France", 45.76, 4.83);
    const tree = buildGeoTree([paris, lyon]);
    const france = tree.children.get("Europe")!.children.get("France")!;
    expect(countPlacesUnder(france)).toBe(2);
  });
});

describe("getDominantAppearance", () => {
  it("returns the tag with the most matching places under a node", () => {
    const ironmanPlace = {
      ...place("Rutland, Vermont, United States", 43.6, -72.97),
      icon: "triathlete" as const,
    };
    const airportPlace1 = {
      ...place("Burlington, Vermont, United States", 44.48, -73.21),
      icon: "airplane" as const,
    };
    const airportPlace2 = {
      ...place("Montpelier, Vermont, United States", 44.26, -72.58),
      icon: "airplane" as const,
    };
    const tree = buildGeoTree([ironmanPlace, airportPlace1, airportPlace2]);
    const vermont = tree.children
      .get("North America")!
      .children.get("United States")!
      .children.get("Vermont")!;

    const dominant = getDominantAppearance(
      vermont,
      BUILTIN_APPEARANCE_DEFAULTS,
    );
    expect(dominant?.iconShape).toBe("airplane");
    expect(dominant?.count).toBe(2);
  });

  it("returns undefined when no place under the node has any tag", () => {
    const untagged = place("Paris, France", 48.86, 2.35);
    const tree = buildGeoTree([untagged]);
    const france = tree.children.get("Europe")!.children.get("France")!;
    expect(
      getDominantAppearance(france, BUILTIN_APPEARANCE_DEFAULTS),
    ).toBeUndefined();
  });
});

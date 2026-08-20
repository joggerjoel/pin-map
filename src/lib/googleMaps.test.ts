import { describe, expect, it } from "vitest";
import { buildGoogleMapsUrl } from "./googleMaps";

describe("buildGoogleMapsUrl", () => {
  it("builds a Google Maps search URL from lat/lng", () => {
    expect(buildGoogleMapsUrl(48.8566, 2.3522)).toBe(
      "https://www.google.com/maps/search/?api=1&query=48.8566,2.3522",
    );
  });

  it("handles negative coordinates", () => {
    expect(buildGoogleMapsUrl(-33.8688, 151.2093)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093",
    );
  });
});

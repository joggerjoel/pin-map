import { describe, expect, it } from "vitest";
import {
  buildGoogleMapsSearchUrl,
  buildGoogleMapsUrl,
  parseGoogleMapsUrl,
  parseLatLngPair,
} from "./googleMaps";

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

describe("buildGoogleMapsSearchUrl", () => {
  it("builds a Google Maps search URL from a free-text query", () => {
    expect(buildGoogleMapsSearchUrl("The Twins, Hong Kong")).toBe(
      "https://www.google.com/maps/search/?api=1&query=The%20Twins%2C%20Hong%20Kong",
    );
  });

  it("URL-encodes special characters", () => {
    expect(buildGoogleMapsSearchUrl("Café & Bar")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar",
    );
  });
});

describe("parseGoogleMapsUrl", () => {
  it("extracts the precise !3d/!4d coordinates from a place URL when present", () => {
    const url =
      "https://www.google.com/maps/place/Hong+Kong/@22.3530259,113.8097211,10z/data=!3m1!4b1!4m6!3m5!1s0x3403e2eda332980f:0xf08ab3badbeac97c!8m2!3d22.3193039!4d114.1693611!16zL20vMDNoNjQ?entry=ttu";
    expect(parseGoogleMapsUrl(url)).toEqual({
      lat: 22.3193039,
      lng: 114.1693611,
    });
  });

  it("extracts coordinates from our own buildGoogleMapsUrl format", () => {
    const url =
      "https://www.google.com/maps/search/?api=1&query=48.8566,2.3522";
    expect(parseGoogleMapsUrl(url)).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it("falls back to the @lat,lng viewport pattern when no precise data is present", () => {
    const url = "https://www.google.com/maps/@37.7749,-122.4194,15z";
    expect(parseGoogleMapsUrl(url)).toEqual({ lat: 37.7749, lng: -122.4194 });
  });

  it("returns null for a URL with no recognizable coordinates", () => {
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/place/Paris"),
    ).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parseGoogleMapsUrl("Paris, France")).toBeNull();
  });
});

describe("parseLatLngPair", () => {
  it("parses a simple lat,lng pair", () => {
    expect(parseLatLngPair("48.8566, 2.3522")).toEqual({
      lat: 48.8566,
      lng: 2.3522,
    });
  });

  it("parses negative coordinates with no space after the comma", () => {
    expect(parseLatLngPair("-33.8688,151.2093")).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });

  it("returns null for free text", () => {
    expect(parseLatLngPair("Paris, France")).toBeNull();
  });

  it("returns null for a Google Maps URL (that's parseGoogleMapsUrl's job)", () => {
    expect(
      parseLatLngPair("https://www.google.com/maps/@37.7749,-122.4194,15z"),
    ).toBeNull();
  });
});

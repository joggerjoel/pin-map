import { describe, expect, it } from "vitest";
import { detectCountryFromLine, toCountryCode } from "./countryNames";

describe("toCountryCode", () => {
  it("maps a known country name to its ISO code", () => {
    expect(toCountryCode("Ireland")).toBe("ie");
    expect(toCountryCode("USA")).toBe("us");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(toCountryCode("  france  ")).toBe("fr");
    expect(toCountryCode("FRANCE")).toBe("fr");
  });

  it("returns undefined for an unrecognized name", () => {
    expect(toCountryCode("Tasmania")).toBeUndefined();
    expect(toCountryCode("Narnia")).toBeUndefined();
  });
});

describe("detectCountryFromLine", () => {
  it("detects the country from a simple 'City, Country' line", () => {
    expect(detectCountryFromLine("Dublin, Ireland")).toBe("ie");
  });

  it("detects the country from a 'City, State, Country' line (last segment wins)", () => {
    expect(detectCountryFromLine("Portland, Maine, USA")).toBe("us");
  });

  it("returns undefined when the last segment isn't a recognized country", () => {
    expect(detectCountryFromLine("Hobart, Tasmania")).toBeUndefined();
  });

  it("returns undefined for a line with no comma at all", () => {
    expect(detectCountryFromLine("Tokyo")).toBeUndefined();
  });

  it("detects a bare country name with no comma", () => {
    expect(detectCountryFromLine("France")).toBe("fr");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  formatClassDisplayName,
  getLastClassSlug,
  saveLastClassSlug,
} from "./classNavigation";

describe("last class slug", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getLastClassSlug()).toBeNull();
  });

  it("round-trips a saved slug", () => {
    saveLastClassSlug("wtc2026");
    expect(getLastClassSlug()).toBe("wtc2026");
  });

  it("overwrites a previously saved slug with the latest one visited", () => {
    saveLastClassSlug("belding1989");
    saveLastClassSlug("wtc2026");
    expect(getLastClassSlug()).toBe("wtc2026");
  });
});

describe("formatClassDisplayName", () => {
  it("capitalizes an ordinary name and keeps the year", () => {
    expect(formatClassDisplayName("belding1989")).toBe("Belding 1989");
  });

  it("uppercases a short acronym-like prefix", () => {
    expect(formatClassDisplayName("wtc2026")).toBe("WTC 2026");
  });

  it("returns the slug unchanged when it doesn't match name+year", () => {
    expect(formatClassDisplayName("belding-1989")).toBe("belding-1989");
    expect(formatClassDisplayName("1989")).toBe("1989");
  });
});

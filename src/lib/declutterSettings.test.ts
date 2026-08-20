import { beforeEach, describe, expect, it } from "vitest";
import { getDeclutterEnabled, saveDeclutterEnabled } from "./declutterSettings";

describe("declutterSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to enabled when nothing is stored", () => {
    expect(getDeclutterEnabled()).toBe(true);
  });

  it("round-trips saving false", () => {
    saveDeclutterEnabled(false);
    expect(getDeclutterEnabled()).toBe(false);
  });

  it("round-trips saving true after having saved false", () => {
    saveDeclutterEnabled(false);
    saveDeclutterEnabled(true);
    expect(getDeclutterEnabled()).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  getClassDeclutterEnabled,
  getDeclutterEnabled,
  saveClassDeclutterEnabled,
  saveDeclutterEnabled,
} from "./declutterSettings";

describe("declutterSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to disabled when nothing is stored", () => {
    expect(getDeclutterEnabled()).toBe(false);
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

describe("class declutter settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to enabled when nothing is stored", () => {
    expect(getClassDeclutterEnabled()).toBe(true);
  });

  it("round-trips saving true", () => {
    saveClassDeclutterEnabled(true);
    expect(getClassDeclutterEnabled()).toBe(true);
  });

  it("round-trips saving false after having saved true", () => {
    saveClassDeclutterEnabled(true);
    saveClassDeclutterEnabled(false);
    expect(getClassDeclutterEnabled()).toBe(false);
  });

  it("does not share state with the travel map's declutter setting", () => {
    saveClassDeclutterEnabled(false);
    expect(getDeclutterEnabled()).toBe(false);

    saveDeclutterEnabled(true);
    expect(getClassDeclutterEnabled()).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_APPEARANCE_DEFAULTS,
  BUILTIN_TAG_KEYS,
  getResolvedBuiltinAppearance,
  saveTagAppearanceOverride,
} from "./tagAppearance";

beforeEach(() => {
  window.localStorage.clear();
});

describe("getResolvedBuiltinAppearance", () => {
  it("returns exactly the defaults when nothing is stored", () => {
    expect(getResolvedBuiltinAppearance()).toEqual(BUILTIN_APPEARANCE_DEFAULTS);
  });

  it("falls back to defaults when localStorage has malformed JSON", () => {
    window.localStorage.setItem(
      "pin-map:tag-appearance-overrides",
      "{not valid json",
    );
    expect(getResolvedBuiltinAppearance()).toEqual(BUILTIN_APPEARANCE_DEFAULTS);
  });

  it("ignores a stored override with an invalid iconShape", () => {
    window.localStorage.setItem(
      "pin-map:tag-appearance-overrides",
      JSON.stringify({
        hometown: { color: "#111111", iconShape: "bogus" },
      }),
    );
    expect(getResolvedBuiltinAppearance()).toEqual(BUILTIN_APPEARANCE_DEFAULTS);
  });
});

describe("saveTagAppearanceOverride", () => {
  it("stores an override and resolves it while leaving other keys default", () => {
    saveTagAppearanceOverride("hometown", {
      color: "#111111",
      iconShape: "airplane",
    });

    const resolved = getResolvedBuiltinAppearance();
    expect(resolved.hometown).toEqual({
      color: "#111111",
      iconShape: "airplane",
    });
    for (const key of BUILTIN_TAG_KEYS) {
      if (key === "hometown") continue;
      expect(resolved[key]).toEqual(BUILTIN_APPEARANCE_DEFAULTS[key]);
    }
  });
});

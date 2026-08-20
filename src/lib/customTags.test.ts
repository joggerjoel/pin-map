import { beforeEach, describe, expect, it } from "vitest";
import { addCustomTag, getCustomTags } from "./customTags";

beforeEach(() => {
  window.localStorage.clear();
});

describe("getCustomTags", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(getCustomTags()).toEqual([]);
  });

  it("returns an empty array when localStorage has malformed JSON", () => {
    window.localStorage.setItem("pin-map:custom-tags", "{not valid json");
    expect(getCustomTags()).toEqual([]);
  });

  it("filters out malformed entries", () => {
    window.localStorage.setItem(
      "pin-map:custom-tags",
      JSON.stringify([
        { id: "marathon", label: "Marathon", color: "#8b5cf6" },
        { bad: true },
      ]),
    );
    expect(getCustomTags()).toEqual([
      { id: "marathon", label: "Marathon", color: "#8b5cf6" },
    ]);
  });
});

describe("addCustomTag", () => {
  it("adds a new tag and persists it", () => {
    const result = addCustomTag("Marathon", "#8b5cf6");
    expect(result).toEqual([
      { id: "marathon", label: "Marathon", color: "#8b5cf6" },
    ]);
    expect(getCustomTags()).toEqual([
      { id: "marathon", label: "Marathon", color: "#8b5cf6" },
    ]);
  });

  it("slugifies the label into an id (lowercase, spaces to hyphens)", () => {
    const result = addCustomTag("Half Marathon!", "#8b5cf6");
    expect(result[0]?.id).toBe("half-marathon");
  });

  it("appends to existing tags rather than replacing them", () => {
    addCustomTag("Marathon", "#8b5cf6");
    const result = addCustomTag("Cycling", "#22c55e");
    expect(result).toHaveLength(2);
  });

  it("does not add a duplicate id and returns the unchanged list", () => {
    addCustomTag("Marathon", "#8b5cf6");
    const result = addCustomTag("marathon", "#000000");
    expect(result).toHaveLength(1);
    expect(result[0]?.color).toBe("#8b5cf6");
  });

  it("does not add a tag whose label slugifies to an empty id", () => {
    const result = addCustomTag("   ", "#8b5cf6");
    expect(result).toEqual([]);
  });
});

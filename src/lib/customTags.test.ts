import { beforeEach, describe, expect, it } from "vitest";
import { addCustomTag, getCustomTags, updateCustomTag } from "./customTags";

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
        {
          id: "marathon",
          label: "Marathon",
          color: "#8b5cf6",
          iconShape: "none",
        },
        { bad: true },
      ]),
    );
    expect(getCustomTags()).toEqual([
      {
        id: "marathon",
        label: "Marathon",
        color: "#8b5cf6",
        iconShape: "none",
      },
    ]);
  });
});

describe("addCustomTag", () => {
  it("adds a new tag and persists it", () => {
    const result = addCustomTag("Marathon", "#8b5cf6");
    expect(result).toEqual([
      {
        id: "marathon",
        label: "Marathon",
        color: "#8b5cf6",
        iconShape: "none",
      },
    ]);
    expect(getCustomTags()).toEqual([
      {
        id: "marathon",
        label: "Marathon",
        color: "#8b5cf6",
        iconShape: "none",
      },
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

  it("stores the given icon shape", () => {
    const result = addCustomTag("Trail", "#22c55e", "house");
    expect(result).toEqual([
      { id: "trail", label: "Trail", color: "#22c55e", iconShape: "house" },
    ]);
  });

  it("defaults to iconShape 'none' when no shape is given", () => {
    const result = addCustomTag("Trail", "#22c55e");
    expect(result).toEqual([
      { id: "trail", label: "Trail", color: "#22c55e", iconShape: "none" },
    ]);
  });

  it("backfills iconShape 'none' for tags persisted before this field existed", () => {
    window.localStorage.setItem(
      "pin-map:custom-tags",
      JSON.stringify([{ id: "old", label: "Old", color: "#000000" }]),
    );
    expect(getCustomTags()).toEqual([
      { id: "old", label: "Old", color: "#000000", iconShape: "none" },
    ]);
  });
});

describe("updateCustomTag", () => {
  it("updates label, color, and iconShape on an existing tag, leaving others untouched", () => {
    addCustomTag("Marathon", "#8b5cf6", "none");
    addCustomTag("Cycling", "#22c55e", "house");

    const result = updateCustomTag("marathon", {
      label: "Ultra Marathon",
      color: "#111111",
      iconShape: "airplane",
    });

    expect(result).toEqual([
      {
        id: "marathon",
        label: "Ultra Marathon",
        color: "#111111",
        iconShape: "airplane",
      },
      { id: "cycling", label: "Cycling", color: "#22c55e", iconShape: "house" },
    ]);
    expect(getCustomTags()).toEqual(result);
  });

  it("returns the list unchanged when the id does not exist", () => {
    addCustomTag("Marathon", "#8b5cf6", "none");
    const before = getCustomTags();

    const result = updateCustomTag("does-not-exist", {
      label: "X",
      color: "#000000",
      iconShape: "house",
    });

    expect(result).toEqual(before);
  });
});

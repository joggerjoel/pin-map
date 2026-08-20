import { describe, expect, it } from "vitest";
import { parseChecklist, parseChecklistLine } from "./checklist";

describe("parseChecklistLine", () => {
  it("returns null for an unmarked line", () => {
    expect(parseChecklistLine("1 Alabama ")).toBeNull();
  });

  it("parses a visited mark (uppercase X)", () => {
    expect(parseChecklistLine("9 Florida X")).toEqual({
      name: "Florida",
      category: "visited",
    });
  });

  it("parses a visited mark (lowercase x)", () => {
    expect(parseChecklistLine("2 Alaska x")).toEqual({
      name: "Alaska",
      category: "visited",
    });
  });

  it("parses a hometown mark ((home))", () => {
    expect(parseChecklistLine("22 Michigan (home)")).toEqual({
      name: "Michigan",
      category: "hometown",
    });
  });

  it("parses a lived mark (Y)", () => {
    expect(parseChecklistLine("5 California Y")).toEqual({
      name: "California",
      category: "lived",
    });
  });

  it("is case-insensitive for marks", () => {
    expect(parseChecklistLine("22 Michigan (HOME)")).toEqual({
      name: "Michigan",
      category: "hometown",
    });
    expect(parseChecklistLine("5 California y")).toEqual({
      name: "California",
      category: "lived",
    });
  });

  it("keeps multi-word state names intact, including a name that looks like it has extra words", () => {
    expect(parseChecklistLine("47 Washington DC X")).toEqual({
      name: "Washington DC",
      category: "visited",
    });
  });

  it("handles trailing whitespace and extra internal spaces", () => {
    expect(parseChecklistLine("30 New Jersey  X")).toEqual({
      name: "New Jersey",
      category: "visited",
    });
  });

  it("returns null for a blank line", () => {
    expect(parseChecklistLine("   ")).toBeNull();
  });

  it("returns null when there is no number prefix and no mark", () => {
    expect(parseChecklistLine("Wyoming")).toBeNull();
  });

  it("collapses accidental duplicate trailing marks to a single category", () => {
    expect(parseChecklistLine("14 Indiana X X")).toEqual({
      name: "Indiana",
      category: "visited",
    });
  });
});

describe("parseChecklist", () => {
  it("extracts only marked entries from a multi-line checklist, in order", () => {
    const raw = [
      "1 Alabama ",
      "2 Alaska x",
      "9 Florida X",
      "10 Georgia X",
      "22 Michigan (home)",
    ].join("\n");

    expect(parseChecklist(raw)).toEqual([
      { name: "Alaska", category: "visited" },
      { name: "Florida", category: "visited" },
      { name: "Georgia", category: "visited" },
      { name: "Michigan", category: "hometown" },
    ]);
  });

  it("returns an empty array when nothing is marked", () => {
    expect(parseChecklist("1 Alabama \n2 Alaska \n")).toEqual([]);
  });
});

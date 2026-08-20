import { describe, expect, it } from "vitest";
import { displayName, isDeceased, matchesSearch } from "./rosterName";
import type { RosterPerson } from "./classRosterRepository";

function person(overrides: Partial<RosterPerson> = {}): RosterPerson {
  return {
    id: 1,
    filename: "class1989-001_sheet1_row1_col1.png",
    imageUrl:
      "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
    highSchoolName: "",
    currentName: "",
    hometown: "",
    living: "",
    livingLat: null,
    livingLng: null,
    currentLocation: "",
    ...overrides,
  };
}

describe("displayName", () => {
  it("prefers currentName when set", () => {
    expect(
      displayName(
        person({
          highSchoolName: "Jane Smith",
          currentName: "Jane Smith Johnson",
        }),
      ),
    ).toBe("Jane Smith Johnson");
  });

  it("falls back to highSchoolName when currentName is blank", () => {
    expect(
      displayName(person({ highSchoolName: "Jane Smith", currentName: "" })),
    ).toBe("Jane Smith");
  });

  it("falls back to a padded person id when both names are blank", () => {
    expect(displayName(person({ id: 7 }))).toBe("Person 007");
  });

  it("treats a whitespace-only name as blank", () => {
    expect(
      displayName(person({ highSchoolName: "   ", currentName: "  ", id: 42 })),
    ).toBe("Person 042");
  });
});

describe("matchesSearch", () => {
  it("matches on highSchoolName", () => {
    expect(
      matchesSearch(person({ highSchoolName: "Jane Smith" }), "smith"),
    ).toBe(true);
  });

  it("matches on currentName", () => {
    expect(
      matchesSearch(person({ currentName: "Jane Johnson" }), "johnson"),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      matchesSearch(person({ highSchoolName: "Jane Smith" }), "JANE"),
    ).toBe(true);
  });

  it("returns true for a blank query", () => {
    expect(matchesSearch(person(), "   ")).toBe(true);
  });

  it("returns false when neither name matches", () => {
    expect(
      matchesSearch(
        person({ highSchoolName: "Jane Smith", currentName: "Jane Johnson" }),
        "bob",
      ),
    ).toBe(false);
  });
});

describe("isDeceased", () => {
  it("is true for an exact RIP value", () => {
    expect(isDeceased(person({ living: "RIP" }))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDeceased(person({ living: "rip" }))).toBe(true);
  });

  it("is true for RIP followed by additional detail", () => {
    expect(isDeceased(person({ living: "RIP 2015" }))).toBe(true);
    expect(isDeceased(person({ living: "RIP - cancer" }))).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isDeceased(person({ living: "  RIP  " }))).toBe(true);
  });

  it("is false for a blank living field", () => {
    expect(isDeceased(person({ living: "" }))).toBe(false);
  });

  it("is false for a real place name that happens to start with 'rip'", () => {
    expect(isDeceased(person({ living: "Ripon, Wisconsin" }))).toBe(false);
  });

  it("is false for an ordinary city", () => {
    expect(isDeceased(person({ living: "Chicago, Illinois" }))).toBe(false);
  });
});

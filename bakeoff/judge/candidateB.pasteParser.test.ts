import { describe, expect, it } from "vitest";
import { parsePastedText } from "./pasteParser";
import type { ParsedPasteLine } from "./pasteParser";

function line(overrides: Partial<ParsedPasteLine>): ParsedPasteLine {
  return {
    raw: "",
    blank: false,
    name: null,
    date: null,
    coords: null,
    category: null,
    icon: null,
    people: [],
    ...overrides,
  };
}

describe("parsePastedText — line splitting and raw preservation", () => {
  it("returns one entry per input line, in order", () => {
    const result = parsePastedText("Paris\nLondon\nRome");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.name)).toEqual(["Paris", "London", "Rome"]);
  });

  it("preserves each raw line byte-for-byte so joining reproduces the input", () => {
    const input = "  Paris  \n\n\t\n2019 | Nice (ski) @jane\n12. Rome x ";
    const result = parsePastedText(input);
    expect(result.map((r) => r.raw).join("\n")).toBe(input);
  });

  it("returns a single entry for input with no newline", () => {
    expect(parsePastedText("Paris")).toHaveLength(1);
  });

  it("returns one blank entry for the empty string", () => {
    expect(parsePastedText("")).toEqual([line({ raw: "", blank: true })]);
  });
});

describe("parsePastedText — blank lines", () => {
  it("marks empty lines blank with everything null/empty", () => {
    const [entry] = parsePastedText("");
    expect(entry).toEqual(line({ raw: "", blank: true }));
  });

  it("marks whitespace-only lines blank and keeps their raw text", () => {
    const [entry] = parsePastedText(" \t  ");
    expect(entry).toEqual(line({ raw: " \t  ", blank: true }));
  });

  it("keeps blank lines between content lines", () => {
    const result = parsePastedText("Paris\n\nLondon");
    expect(result[1].blank).toBe(true);
    expect(result[0].blank).toBe(false);
    expect(result[2].blank).toBe(false);
  });
});

describe("parsePastedText — date prefixes", () => {
  it("extracts a plain year prefix", () => {
    const [entry] = parsePastedText("2019 | Paris");
    expect(entry.date).toBe("2019");
    expect(entry.name).toBe("Paris");
  });

  it("extracts a month/year prefix", () => {
    const [entry] = parsePastedText("05/2019 | Paris");
    expect(entry.date).toBe("05/2019");
    expect(entry.name).toBe("Paris");
  });

  it("extracts a year-range prefix", () => {
    const [entry] = parsePastedText("2015 - 2019 | Lansing");
    expect(entry.date).toBe("2015 - 2019");
    expect(entry.name).toBe("Lansing");
  });

  it("extracts a month/year range prefix", () => {
    const [entry] = parsePastedText("05/2019 - 07/2019 | Paris");
    expect(entry.date).toBe("05/2019 - 07/2019");
    expect(entry.name).toBe("Paris");
  });

  it("leaves date null when there is no prefix", () => {
    const [entry] = parsePastedText("Paris");
    expect(entry.date).toBeNull();
    expect(entry.name).toBe("Paris");
  });

  it("does not treat a bare year without a pipe as a date", () => {
    const [entry] = parsePastedText("2019 Paris");
    expect(entry.date).toBeNull();
    expect(entry.name).toBe("2019 Paris");
  });
});

describe("parsePastedText — people", () => {
  it("collects @tokens in order with the @ stripped", () => {
    const [entry] = parsePastedText("Paris @jane @bob-smith");
    expect(entry.people).toEqual(["jane", "bob-smith"]);
    expect(entry.name).toBe("Paris");
  });

  it("removes people tokens anywhere in the line", () => {
    const [entry] = parsePastedText("@jane Paris, France @bob");
    expect(entry.people).toEqual(["jane", "bob"]);
    expect(entry.name).toBe("Paris, France");
  });

  it("does not treat a lone @ as a person", () => {
    const [entry] = parsePastedText("Cafe @ Main @jane");
    expect(entry.people).toEqual(["jane"]);
    expect(entry.name).toBe("Cafe @ Main");
  });

  it("does not treat mid-token @ (emails) as a person", () => {
    const [entry] = parsePastedText("Paris jane@example.com");
    expect(entry.people).toEqual([]);
    expect(entry.name).toBe("Paris jane@example.com");
  });

  it("returns an empty name when the line is only people", () => {
    const [entry] = parsePastedText("@jane @bob");
    expect(entry.people).toEqual(["jane", "bob"]);
    expect(entry.blank).toBe(false);
    expect(entry.name).toBe("");
  });

  it("returns empty people when no @tokens are present", () => {
    const [entry] = parsePastedText("Paris");
    expect(entry.people).toEqual([]);
  });
});

describe("parsePastedText — checklist rows", () => {
  it("parses a visited row", () => {
    const [entry] = parsePastedText("12. Paris x");
    expect(entry).toEqual(
      line({ raw: "12. Paris x", name: "Paris", category: "visited" }),
    );
  });

  it("parses a lived row", () => {
    const [entry] = parsePastedText("4. Lansing y");
    expect(entry.category).toBe("lived");
    expect(entry.name).toBe("Lansing");
  });

  it("parses a hometown row", () => {
    const [entry] = parsePastedText("3. Belding (home)");
    expect(entry.category).toBe("hometown");
    expect(entry.name).toBe("Belding");
    expect(entry.icon).toBeNull();
  });

  it("does not treat an unnumbered marked line as a checklist row", () => {
    const [entry] = parsePastedText("Paris x");
    expect(entry.category).toBeNull();
    expect(entry.name).toBe("Paris x");
  });

  it("treats a numbered row without a mark as a plain line", () => {
    const [entry] = parsePastedText("12. Paris");
    expect(entry.category).toBeNull();
    expect(entry.name).toBe("12. Paris");
  });
});

describe("parsePastedText — plain lines: icons and coords", () => {
  it("extracts an icon tag and removes it from the name", () => {
    const [entry] = parsePastedText("Whistler (ski)");
    expect(entry.icon).toBe("ski");
    expect(entry.name).toBe("Whistler");
  });

  it("maps the tag to its PlaceIcon value", () => {
    const [entry] = parsePastedText("Frankfurt (air)");
    expect(entry.icon).toBe("airplane");
    expect(entry.name).toBe("Frankfurt");
  });

  it("maps (home) on a plain line to the house-home icon, not a category", () => {
    const [entry] = parsePastedText("Belding (home)");
    expect(entry.icon).toBe("house-home");
    expect(entry.category).toBeNull();
    expect(entry.name).toBe("Belding");
  });

  it("keeps unknown tags in the name", () => {
    const [entry] = parsePastedText("Paris (fancy)");
    expect(entry.icon).toBeNull();
    expect(entry.name).toBe("Paris (fancy)");
  });

  it("extracts trailing explicit coordinates", () => {
    const [entry] = parsePastedText("Paris, 48.8566, 2.3522");
    expect(entry.coords).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(entry.name).toBe("Paris");
  });

  it("keeps out-of-range coordinates as part of the name", () => {
    const [entry] = parsePastedText("Paris, 148.8566, 2.3522");
    expect(entry.coords).toBeNull();
    expect(entry.name).toBe("Paris, 148.8566, 2.3522");
  });

  it("extracts both an icon and coordinates", () => {
    const [entry] = parsePastedText("Whistler, 50.1163, -122.9574 (ski)");
    expect(entry.icon).toBe("ski");
    expect(entry.coords).toEqual({ lat: 50.1163, lng: -122.9574 });
    expect(entry.name).toBe("Whistler");
  });
});

describe("parsePastedText — combined forms", () => {
  it("parses date + people + checklist row", () => {
    const [entry] = parsePastedText("2019 | 12. Paris x @jane");
    expect(entry).toEqual(
      line({
        raw: "2019 | 12. Paris x @jane",
        name: "Paris",
        date: "2019",
        category: "visited",
        people: ["jane"],
      }),
    );
  });

  it("parses date + people + icon + coords", () => {
    const [entry] = parsePastedText(
      "05/2019 - 07/2019 | Whistler, 50.1163, -122.9574 (ski) @jane @bob",
    );
    expect(entry).toEqual(
      line({
        raw: "05/2019 - 07/2019 | Whistler, 50.1163, -122.9574 (ski) @jane @bob",
        name: "Whistler",
        date: "05/2019 - 07/2019",
        coords: { lat: 50.1163, lng: -122.9574 },
        icon: "ski",
        people: ["jane", "bob"],
      }),
    );
  });

  it("parses a mixed multi-line paste and keeps line order", () => {
    const input = [
      "2019 | Paris",
      "",
      "12. Rome x",
      "Whistler (ski) @jane",
    ].join("\n");
    const result = parsePastedText(input);
    expect(result.map((r) => r.name)).toEqual([
      "Paris",
      null,
      "Rome",
      "Whistler",
    ]);
    expect(result[1].blank).toBe(true);
    expect(result[2].category).toBe("visited");
    expect(result[3].icon).toBe("ski");
    expect(result[3].people).toEqual(["jane"]);
  });
});

describe("parsePastedText — robustness", () => {
  it("never throws on strange inputs", () => {
    const inputs = [
      "\n\n\n",
      "@",
      "@@",
      "|||",
      "2019 |",
      "((()))",
      ", , ,",
      " ",
      "🌍 @jane",
      "12.",
      "-90.0, 180.0",
      "a".repeat(10000),
    ];
    for (const input of inputs) {
      expect(() => parsePastedText(input)).not.toThrow();
    }
  });

  it("treats a pipe with an empty remainder as a plain line", () => {
    const [entry] = parsePastedText("2019 |");
    expect(entry.date).toBeNull();
    expect(entry.name).toBe("2019 |");
  });
});

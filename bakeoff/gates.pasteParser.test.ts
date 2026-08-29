// HELD-OUT ACCEPTANCE GATES — written before either arm ran.
// Copied into each arm's worktree as src/lib/pasteParser.gates.test.ts
// after implementation completes. Arms never see this file.
import { describe, expect, it } from "vitest";
import { parsePastedText } from "./pasteParser";

describe("pasteParser acceptance gates", () => {
  it("G1 preserves raw lines exactly, one entry per line", () => {
    const input = "Paris\n\n  2019 | Rome  ";
    const out = parsePastedText(input);
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.raw).join("\n")).toBe(input);
  });

  it("G2 parses a plain place name", () => {
    const [l] = parsePastedText("Paris");
    expect(l.name).toBe("Paris");
    expect(l.blank).toBe(false);
    expect(l.date).toBeNull();
    expect(l.coords).toBeNull();
    expect(l.category).toBeNull();
    expect(l.people).toEqual([]);
  });

  it("G3 marks blank lines", () => {
    const out = parsePastedText("   \n");
    expect(out[0].blank).toBe(true);
    expect(out[0].name).toBeNull();
    expect(out[1].blank).toBe(true);
  });

  it("G4 extracts a year date prefix", () => {
    const [l] = parsePastedText("2019 | Rome");
    expect(l.date).toBe("2019");
    expect(l.name).toBe("Rome");
  });

  it("G5 extracts a month-range date prefix", () => {
    const [l] = parsePastedText("05/2019 - 07/2019 | Camino de Santiago");
    expect(l.date).toBe("05/2019 - 07/2019");
    expect(l.name).toBe("Camino de Santiago");
  });

  it("G6 extracts trailing explicit coordinates", () => {
    const [l] = parsePastedText("Grand Canyon, 36.1069, -112.1129");
    expect(l.coords).toEqual({ lat: 36.1069, lng: -112.1129 });
    expect(l.name).toBe("Grand Canyon");
  });

  it("G7 rejects out-of-range coordinates", () => {
    const [l] = parsePastedText("Nowhere, 999.0, 999.0");
    expect(l.coords).toBeNull();
    expect(l.name).toBe("Nowhere, 999.0, 999.0");
  });

  it("G8 extracts icon tags on plain lines", () => {
    const [l] = parsePastedText("Aspen (ski)");
    expect(l.icon).toBe("ski");
    expect(l.name).toBe("Aspen");
  });

  it("G9 classifies checklist rows", () => {
    const [a, b] = parsePastedText("12. Paris x\n3. Belding (home)");
    expect(a.category).toBe("visited");
    expect(a.name).toBe("Paris");
    expect(b.category).toBe("hometown");
    expect(b.name).toBe("Belding");
  });

  it("G10 extracts person references", () => {
    const [l] = parsePastedText("Lunch spot @jane @bob-smith");
    expect(l.people).toEqual(["jane", "bob-smith"]);
    expect(l.name).toBe("Lunch spot");
  });

  it("G11 combines date, coords, and people", () => {
    const [l] = parsePastedText("05/2021 | Fishing cabin, 44.5, -85.3 @dad");
    expect(l.date).toBe("05/2021");
    expect(l.coords).toEqual({ lat: 44.5, lng: -85.3 });
    expect(l.people).toEqual(["dad"]);
    expect(l.name).toBe("Fishing cabin");
  });

  it("G12 never throws on hostile input", () => {
    const nasty = [
      "@",
      "2019 |",
      "\t\t",
      "🌍🌍🌍",
      "),,,",
      "a".repeat(10000),
      ", 44.5, -85.3",
    ];
    for (const line of nasty) {
      expect(() => parsePastedText(line)).not.toThrow();
      expect(parsePastedText(line)).toHaveLength(1);
    }
  });
});

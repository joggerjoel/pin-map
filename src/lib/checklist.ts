export type PlaceCategory = "visited" | "lived" | "hometown";

export interface ChecklistEntry {
  name: string;
  category: PlaceCategory;
}

const MARK_CATEGORIES: Record<string, PlaceCategory> = {
  "(home)": "hometown",
  y: "lived",
  x: "visited",
};

export function parseChecklistLine(rawLine: string): ChecklistEntry | null {
  const trimmed = rawLine.trim();
  if (trimmed === "") {
    return null;
  }

  const tokens = trimmed.split(/\s+/);

  if (/^\d+\.?$/.test(tokens[0])) {
    tokens.shift();
  }

  let category: PlaceCategory | undefined;
  while (tokens.length > 0) {
    const candidate = MARK_CATEGORIES[tokens[tokens.length - 1].toLowerCase()];
    if (candidate === undefined) {
      break;
    }
    category = candidate;
    tokens.pop();
  }

  if (category === undefined || tokens.length === 0) {
    return null;
  }

  return { name: tokens.join(" "), category };
}

export function parseChecklist(raw: string): ChecklistEntry[] {
  return raw
    .split("\n")
    .map((line) => parseChecklistLine(line))
    .filter((entry): entry is ChecklistEntry => entry !== null);
}

const CHECKLIST_ROW_SHAPE = /^\d+\.?\s+[A-Za-z][A-Za-z\s]*$/;
const KNOWN_MARK_TOKENS = new Set(["x", "xx", "y", "(home)"]);

export function looksLikeChecklistRow(rawLine: string): boolean {
  const trimmed = rawLine.trim();
  if (trimmed === "") {
    return false;
  }

  const tokens = trimmed.split(/\s+/);
  while (
    tokens.length > 0 &&
    KNOWN_MARK_TOKENS.has(tokens[tokens.length - 1].toLowerCase())
  ) {
    tokens.pop();
  }

  return CHECKLIST_ROW_SHAPE.test(tokens.join(" "));
}

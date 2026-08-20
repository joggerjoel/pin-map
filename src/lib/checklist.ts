export type PlaceCategory = "visited" | "lived" | "hometown";

export interface ChecklistEntry {
  name: string;
  category: PlaceCategory;
}

const MARK_CATEGORIES: Record<string, PlaceCategory> = {
  XX: "hometown",
  Y: "lived",
  X: "visited",
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
    const candidate = MARK_CATEGORIES[tokens[tokens.length - 1].toUpperCase()];
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

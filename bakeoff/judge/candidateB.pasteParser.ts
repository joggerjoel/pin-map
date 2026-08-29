import { extractDatePrefix } from "./datePrefix";
import { looksLikeChecklistRow, parseChecklistLine } from "./checklist";
import { resolvePlainLineName } from "./plainLineName";

export interface ParsedPasteLine {
  raw: string; // the original line, byte-for-byte
  blank: boolean; // true for empty/whitespace-only lines
  name: string | null; // resolved place name; null when blank
  date: string | null; // date-prefix text when present (e.g. "2019", "05/2019 - 07/2019")
  coords: { lat: number; lng: number } | null;
  category: "visited" | "lived" | "hometown" | null; // from checklist rows
  icon: string | null; // PlaceIcon value from "(tag)" markers, e.g. "ski"
  people: string[]; // person references, in order, without the "@"
}

interface PeopleExtraction {
  rest: string;
  people: string[];
}

/**
 * Removes whitespace-delimited "@name" tokens (at least one character
 * after the "@"). A lone "@" is left in place. The remainder is only
 * re-joined (normalizing whitespace) when a person token was found, so
 * lines without people pass through untouched.
 */
function extractPeople(line: string): PeopleExtraction {
  const tokens = line.split(/\s+/);
  const people = tokens
    .filter((token) => token.length > 1 && token.startsWith("@"))
    .map((token) => token.slice(1));
  if (people.length === 0) {
    return { rest: line, people };
  }
  const rest = tokens
    .filter((token) => !(token.length > 1 && token.startsWith("@")))
    .join(" ")
    .trim();
  return { rest, people };
}

function blankLine(raw: string): ParsedPasteLine {
  return {
    raw,
    blank: true,
    name: null,
    date: null,
    coords: null,
    category: null,
    icon: null,
    people: [],
  };
}

function parseLine(raw: string): ParsedPasteLine {
  if (raw.trim() === "") {
    return blankLine(raw);
  }

  // a. Date prefix
  const dateMatch = extractDatePrefix(raw);
  const date = dateMatch === null ? null : dateMatch.date;
  const afterDate = dateMatch === null ? raw : dateMatch.rest;

  // b. People
  const { rest, people } = extractPeople(afterDate);

  // c. Checklist row (both helpers: the row must look numbered AND carry
  // a recognized mark)
  if (looksLikeChecklistRow(rest)) {
    const entry = parseChecklistLine(rest);
    if (entry !== null) {
      return {
        raw,
        blank: false,
        name: entry.name,
        date,
        coords: null,
        category: entry.category,
        icon: null,
        people,
      };
    }
  }

  // d. Plain line: "(icon)" tag and trailing explicit coordinates
  const plain = resolvePlainLineName(rest);
  return {
    raw,
    blank: false,
    name: plain.name,
    date,
    coords: plain.explicitCoords ?? null,
    category: null,
    icon: plain.icon ?? null,
    people,
  };
}

export function parsePastedText(text: string): ParsedPasteLine[] {
  return text.split("\n").map((raw) => {
    try {
      return parseLine(raw);
    } catch {
      // parseLine is not expected to throw, but the contract guarantees
      // parsePastedText never does: fall back to a plain-name entry.
      if (raw.trim() === "") {
        return blankLine(raw);
      }
      return {
        raw,
        blank: false,
        name: raw.trim(),
        date: null,
        coords: null,
        category: null,
        icon: null,
        people: [],
      };
    }
  });
}

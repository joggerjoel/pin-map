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

// A person reference is a whitespace-delimited token of "@" plus at least one
// character. A lone "@" is not a person reference and stays in the line.
const PERSON_TOKEN = /^@(.+)$/;

interface PeopleMatch {
  rest: string;
  people: string[];
}

function extractPeople(text: string): PeopleMatch {
  const people: string[] = [];
  const kept: string[] = [];
  for (const token of text.split(/\s+/)) {
    if (token === "") {
      continue;
    }
    const match = token.match(PERSON_TOKEN);
    if (match !== null) {
      people.push(match[1]);
    } else {
      kept.push(token);
    }
  }
  return { rest: kept.join(" "), people };
}

// Per-line pipeline, mirroring processLine in useGeocoder:
// date prefix -> people -> checklist row -> plain line. Each stage delegates
// to the module that owns that piece of the paste grammar.
function parseLine(raw: string): ParsedPasteLine {
  if (raw.trim() === "") {
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

  const dateMatch = extractDatePrefix(raw);
  const { rest, people } = extractPeople(dateMatch ? dateMatch.rest : raw);
  const date = dateMatch ? dateMatch.date : null;

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
    // An unmarked checklist row (e.g. "12. Paris") carries no category;
    // fall through and resolve its name as a plain line.
  }

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
  return text.split("\n").map(parseLine);
}

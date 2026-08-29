# Task: Rich Paste Parser (shared spec — identical for both arms)

Implement the unified rich paste parser for pin-map (todo.md "P2 — Travel: Rich
Paste Parser", scoped to the pure-logic core; no UI changes).

## Deliverable

Create `src/lib/pasteParser.ts` exporting EXACTLY this contract:

```ts
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

export function parsePastedText(text: string): ParsedPasteLine[];
```

## Semantics (fixed — both arms implement the same behavior)

1. Split input on `"\n"`. Exactly one output entry per input line, in order.
   `raw` preserves each original line exactly (joining raws with `"\n"`
   reproduces the input).
2. Empty or whitespace-only line → `blank: true`, `name: null`, everything else
   null/empty.
3. Processing order per non-blank line:
   a. **Date prefix** — same semantics as the existing `extractDatePrefix`
   (`src/lib/datePrefix.ts`): forms like `2019 | X`, `05/2019 | X`,
   `2015 - 2019 | X`, `05/2019 - 07/2019 | X`. `date` is the prefix text;
   continue parsing the remainder.
   b. **People** — whitespace-delimited tokens starting with `@` followed by at
   least one character (e.g. `@jane`, `@bob-smith`). Collect into `people`
   (order kept, `@` stripped) and remove them before further parsing. A lone
   `@` is not a person reference.
   c. **Checklist row** — same semantics as `looksLikeChecklistRow` /
   `parseChecklistLine` (`src/lib/checklist.ts`): numbered rows like
   `12. Paris x` (visited), `4. Lansing y` (lived), `3. Belding (home)`
   (hometown). Sets `category` and `name`.
   d. **Otherwise (plain line)** — same semantics as `resolvePlainLineName`
   (`src/lib/plainLineName.ts`): an `(icon)` tag like `(ski)`, `(air)`,
   `(home)` sets `icon` (PlaceIcon value) and is removed from the name;
   trailing explicit coordinates `Name, lat, lng` set `coords` (out-of-range
   values are NOT coords — they stay part of the name).
4. `parsePastedText` must never throw, for any string input.

Existing modules (`datePrefix.ts`, `explicitCoords.ts`, `checklist.ts`,
`plainLineName.ts`, `placeTags.ts`) already implement pieces of this. Whether
you reuse, wrap, or reimplement them is YOUR design decision — decide
deliberately.

## Requirements

- Write your own tests in `src/lib/pasteParser.test.ts`.
- `bun install` first. All tests green via `bun run test`, and the project must
  typecheck (`bunx tsc -b --noEmit` or `bun run build`).
- Do not modify existing files unless your design requires it; justify any such
  change in DESIGN-NOTES.md.
- Record your design decisions in `DESIGN-NOTES.md` at the worktree root.
- Work ONLY inside your assigned worktree directory.

# Future tag + expanded date-prefix formats

**Date:** 2026-08-23
**Status:** approved, not yet implemented
**Relation:** standalone. Two small, additive changes to the pin tagging and
date-prefix-parsing systems.

## Problem

1. There's no way to tag a pin as a place you plan to live in the future —
   only `current` (where you live now) and `lived`/`hometown` (the past).
2. The date prefix on a pasted line (`YYYY | Place`) only accepts a bare
   4-digit year or a comma-list of years. Users want to record month
   precision and date ranges too.

## Design

### 1. `future` builtin tag (purple)

Mirrors the existing `current` tag exactly, just for the opposite time
direction:

- `tagAppearance.ts`: add `"future"` to `BuiltinTagKey` /
  `BUILTIN_TAG_KEYS`, label `"Future"`, default appearance
  `{ color: "#a855f7", iconShape: "house" }`.
- `placeTags.ts`: add `"house-future"` to `PlaceIcon`, and a
  `future: "house-future"` entry in `TAG_ICONS` — so typing `(future)`
  after a place name (same mechanism as `(current)`) tags it.
- `TagPicker.tsx`: add `future: { kind: "icon", value: "house-future" }`
  to `BUILTIN_TAGS`.
- `MapView.tsx`: `resolveBuiltinKey` switches on `place.icon` to resolve a
  `BuiltinTagKey` for marker rendering (`house-home` → `hometown`,
  `house-live` → `lived`, `house-current` → `current`, etc. — see lines
  251-261). Add `if (place.icon === "house-future") return "future";`
  alongside the other `house-*` cases.

Color and icon shape are both editable afterward via the tag picker's
existing edit UI, so the exact default is low-stakes.

No new icon glyph is needed. Marker rendering doesn't switch per-icon
glyphs for house variants — `buildMarkerOptionsFromAppearance` branches on
`iconShape === "house"` (shared by every house-* tag) and renders
`createHouseIconSvg()` colored by `appearance.color`. So `future` reuses
the same house glyph as `current`/`lived`/`hometown`; only the swatch color
(purple) differs, exactly like `TagPicker.tsx`'s own glyph rendering
(`renderIconGlyph`, which also switches on `iconShape`, not on the
specific `PlaceIcon`).

### 2. Expanded date-prefix formats

`datePrefix.ts`'s `DATE_PREFIX_PATTERN` currently accepts only:

- `YYYY` (a bare 4-digit year)
- `YYYY, YYYY, ...` (comma-list of years)

Add support for:

- `MM/YYYY` (e.g. `03/2020`)
- `MM/DD/YYYY - MM/DD/YYYY` (e.g. `03/15/2020 - 03/20/2020`)
- `MM/YYYY - MM/YYYY` (e.g. `03/2020 - 06/2020`)
- `YYYY - YYYY` (e.g. `2015 - 2016`)

The existing `YYYY` / `YYYY, YYYY, ...` behavior is unchanged — this is
purely additive (new alternatives in the regex), so all existing tests in
`datePrefix.test.ts` keep passing unmodified.

Validation stays shape-only, matching the existing `YYYY` check's own
looseness (it doesn't reject e.g. year `0000`): `MM` and `DD` just need to
be 2 digits each, not calendar-valid (e.g. `13/2020` still matches). No new
dependency is needed for this — it's a regex extension, not a date-parsing
library.

The `date` field itself stays a free-form display string end-to-end (as it
is today) — no downstream code parses it into a structured date. This
change only widens what `extractDatePrefix` recognizes as a valid prefix
to pull out of the raw pasted line.

## Testing

Extend `datePrefix.test.ts` with one case per new format (`MM/YYYY`, both
range shapes, and `YYYY - YYYY`), plus a case confirming the existing
`YYYY` / `YYYY, YYYY` cases are untouched. No manual testing needed beyond
that — this is pure string-parsing logic with existing unit-test coverage
as the verification method (unlike the email-alias CLI, there's no external
API to verify against here).

## Out of scope

- Calendar-validity checking (real month/day bounds, leap years) — shape
  validation only, matching the existing `YYYY` check's looseness.
- Parsing `date` into a structured type anywhere downstream — it stays a
  display string.
- A distinct icon glyph for `future` — it reuses the house glyph.

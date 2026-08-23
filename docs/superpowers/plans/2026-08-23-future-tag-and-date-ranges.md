# Future Tag + Expanded Date-Prefix Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purple `future` builtin pin tag, and widen the date-prefix
parser to accept month precision and date ranges.

**Architecture:** Two independent, additive changes. The `future` tag
threads through the same four files the existing `current` tag already
threads through (`tagAppearance.ts` → `placeTags.ts` → `TagPicker.tsx` →
`MapView.tsx`), copying that tag's wiring exactly. The date-prefix change
is a single regex edit in `datePrefix.ts` — no new dependency, no change to
how the extracted date is stored or displayed (it stays a free-form
string).

**Tech Stack:** TypeScript, React, Vitest + Testing Library (existing
project stack — no new dependencies).

## Global Constraints

- `future` tag default appearance: `{ color: "#a855f7", iconShape: "house" }`
  (spec: `docs/superpowers/specs/2026-08-23-future-tag-and-date-ranges-design.md`).
- `future`'s `PlaceIcon` value is `"house-future"`; its parenthetical tag
  text is `(future)` (lowercase, matching `TAG_ICONS`' existing keys).
- Date-prefix formats to add, in addition to the existing `YYYY` /
  `YYYY, YYYY, ...`: `MM/YYYY`, `MM/DD/YYYY - MM/DD/YYYY`,
  `MM/YYYY - MM/YYYY`, `YYYY - YYYY`. Validation is shape-only (2-digit
  month/day, 4-digit year) — no calendar-correctness checking.
- No new icon glyph for `future` — it reuses the existing house glyph
  (`iconShape: "house"`), same as `current`/`lived`/`hometown`.
- Run `npx vitest run <file>` from the repo root
  (`/Users/joggerjoel/Developer/pin-map`) to execute a single test file.

---

### Task 1: Expand date-prefix formats

**Files:**

- Modify: `src/lib/datePrefix.ts`
- Test: `src/lib/datePrefix.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change — `extractDatePrefix(line: string): DatePrefixMatch | null` keeps its existing shape. Only the set of strings `DATE_PREFIX_PATTERN` accepts as a valid prefix grows.

- [ ] **Step 1: Write the failing tests**

Add these four `it` blocks to `src/lib/datePrefix.test.ts`, inside the
existing `describe("extractDatePrefix", ...)` block (after the last
existing test, "returns null for a line with no date and no pipe"):

```ts
it("extracts a month/year prefix", () => {
  expect(extractDatePrefix("03/2020 | Chicago, Illinois")).toEqual({
    date: "03/2020",
    rest: "Chicago, Illinois",
  });
});

it("extracts a year-range prefix", () => {
  expect(extractDatePrefix("2015 - 2016 | Chamonix, France")).toEqual({
    date: "2015 - 2016",
    rest: "Chamonix, France",
  });
});

it("extracts a month/year-range prefix", () => {
  expect(extractDatePrefix("03/2020 - 06/2020 | Sabbatical in Lisbon")).toEqual(
    {
      date: "03/2020 - 06/2020",
      rest: "Sabbatical in Lisbon",
    },
  );
});

it("extracts a month/day/year-range prefix", () => {
  expect(
    extractDatePrefix("03/15/2020 - 03/20/2020 | Big Bend National Park"),
  ).toEqual({
    date: "03/15/2020 - 03/20/2020",
    rest: "Big Bend National Park",
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/lib/datePrefix.test.ts`

Expected: the 4 new tests FAIL (each receiving `null` instead of the
expected `{ date, rest }` object); the pre-existing tests in this file
still PASS.

- [ ] **Step 3: Widen the regex**

In `src/lib/datePrefix.ts`, replace the `DATE_PREFIX_PATTERN` line:

```ts
const DATE_PREFIX_PATTERN = /^(\d{4}(?:\s*,\s*\d{4})*)\s*\|\s*(.+)$/;
```

with:

```ts
const DATE_PREFIX_PATTERN =
  /^(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4}|\d{4}\s*-\s*\d{4}|\d{2}\/\d{4}|\d{4}(?:\s*,\s*\d{4})*)\s*\|\s*(.+)$/;
```

Nothing else in the file changes — `extractDatePrefix`'s body already
just matches against `DATE_PREFIX_PATTERN` and returns group 1 as `date`,
group 2 (trimmed) as `rest`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/datePrefix.test.ts`

Expected: all tests in the file PASS (the 4 new ones plus the 7 pre-existing ones — 11 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datePrefix.ts src/lib/datePrefix.test.ts
git commit -m "feat: accept month/year and date-range prefixes in place input"
```

---

### Task 2: Add the `future` builtin tag

**Files:**

- Modify: `src/lib/tagAppearance.ts`
- Modify: `src/lib/placeTags.ts`
- Modify: `src/components/TagPicker.tsx`
- Modify: `src/components/MapView.tsx`
- Test: `src/lib/placeTags.test.ts`
- Test: `src/components/MapView.test.tsx`
- Test: `src/components/TagPicker.test.tsx` (existing test must be updated, not just extended — see Step 5)

**Interfaces:**

- Consumes: `BuiltinTagKey`, `TagAppearance`, `IconShape` from `tagAppearance.ts`; `PlaceIcon` from `placeTags.ts`; `PinTag` from `TagPicker.tsx`; `BuiltinTagKey` (again) and `PinnedPlace` from `MapView.tsx`'s existing imports.
- Produces: `"future"` becomes a valid `BuiltinTagKey`; `"house-future"` becomes a valid `PlaceIcon`. No exported function signatures change.

- [ ] **Step 1: Write the failing test for tag extraction**

Add this `it` block to `src/lib/placeTags.test.ts`, after the last
existing test ("extracts the current tag and strips it from the query"):

```ts
it("extracts the future tag and strips it from the query", () => {
  expect(extractPlaceIcon("Austin, Texas (future)")).toEqual({
    query: "Austin, Texas",
    icon: "house-future",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/placeTags.test.ts`

Expected: the new test FAILS (`icon` comes back `undefined`, not
`"house-future"`, since `"future"` isn't in `TAG_ICONS` yet); the
pre-existing tests still PASS.

- [ ] **Step 3: Add `house-future` to `PlaceIcon` and `TAG_ICONS`**

In `src/lib/placeTags.ts`, change:

```ts
export type PlaceIcon =
  | "triathlete"
  | "house-home"
  | "house-live"
  | "house-current"
  | "airplane"
  | "ski"
  | "run";

const TAG_ICONS: Record<string, PlaceIcon> = {
  ironman: "triathlete",
  home: "house-home",
  hometown: "house-home",
  live: "house-live",
  lived: "house-live",
  current: "house-current",
  air: "airplane",
  ski: "ski",
  run: "run",
};
```

to:

```ts
export type PlaceIcon =
  | "triathlete"
  | "house-home"
  | "house-live"
  | "house-current"
  | "house-future"
  | "airplane"
  | "ski"
  | "run";

const TAG_ICONS: Record<string, PlaceIcon> = {
  ironman: "triathlete",
  home: "house-home",
  hometown: "house-home",
  live: "house-live",
  lived: "house-live",
  current: "house-current",
  future: "house-future",
  air: "airplane",
  ski: "ski",
  run: "run",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/placeTags.test.ts`

Expected: all tests in the file PASS (9 total: 8 pre-existing + 1 new).

- [ ] **Step 5: Add `future` to `BuiltinTagKey` and its default appearance**

In `src/lib/tagAppearance.ts`, change:

```ts
export type BuiltinTagKey =
  | "visited"
  | "lived"
  | "hometown"
  | "ironman"
  | "airport"
  | "current"
  | "ski"
  | "run";

export const BUILTIN_TAG_KEYS: BuiltinTagKey[] = [
  "visited",
  "lived",
  "hometown",
  "ironman",
  "airport",
  "current",
  "ski",
  "run",
];

export const BUILTIN_TAG_LABELS: Record<BuiltinTagKey, string> = {
  visited: "Visited",
  lived: "Lived",
  hometown: "Hometown",
  ironman: "Ironman",
  airport: "Airport",
  current: "Current",
  ski: "Ski",
  run: "Run",
};

export const BUILTIN_APPEARANCE_DEFAULTS: Record<BuiltinTagKey, TagAppearance> =
  {
    visited: { color: "#3b82f6", iconShape: "none" },
    lived: { color: "#f97316", iconShape: "house" },
    hometown: { color: "#eab308", iconShape: "house" },
    ironman: { color: "#dc2626", iconShape: "triathlete" },
    airport: { color: "#0891b2", iconShape: "airplane" },
    current: { color: "#16a34a", iconShape: "house" },
    ski: { color: "#0ea5e9", iconShape: "ski" },
    run: { color: "#f43f5e", iconShape: "run" },
  };
```

to:

```ts
export type BuiltinTagKey =
  | "visited"
  | "lived"
  | "hometown"
  | "ironman"
  | "airport"
  | "current"
  | "future"
  | "ski"
  | "run";

export const BUILTIN_TAG_KEYS: BuiltinTagKey[] = [
  "visited",
  "lived",
  "hometown",
  "ironman",
  "airport",
  "current",
  "future",
  "ski",
  "run",
];

export const BUILTIN_TAG_LABELS: Record<BuiltinTagKey, string> = {
  visited: "Visited",
  lived: "Lived",
  hometown: "Hometown",
  ironman: "Ironman",
  airport: "Airport",
  current: "Current",
  future: "Future",
  ski: "Ski",
  run: "Run",
};

export const BUILTIN_APPEARANCE_DEFAULTS: Record<BuiltinTagKey, TagAppearance> =
  {
    visited: { color: "#3b82f6", iconShape: "none" },
    lived: { color: "#f97316", iconShape: "house" },
    hometown: { color: "#eab308", iconShape: "house" },
    ironman: { color: "#dc2626", iconShape: "triathlete" },
    airport: { color: "#0891b2", iconShape: "airplane" },
    current: { color: "#16a34a", iconShape: "house" },
    future: { color: "#a855f7", iconShape: "house" },
    ski: { color: "#0ea5e9", iconShape: "ski" },
    run: { color: "#f43f5e", iconShape: "run" },
  };
```

`future` is inserted directly after `current` in all three structures —
`BUILTIN_TAG_KEYS`' order determines both `TagPicker`'s default swatch
order and marker-menu ordering, so this placement keeps the two
present/future tags adjacent.

`src/lib/tagAppearance.test.ts` needs no changes: its assertions compare
against `BUILTIN_APPEARANCE_DEFAULTS`/`BUILTIN_TAG_KEYS` by reference, not
by hardcoded value, so they cover `future` automatically.

- [ ] **Step 6: Wire `future` into `TagPicker`'s tag map**

In `src/components/TagPicker.tsx`, change:

```ts
const BUILTIN_TAGS: Record<BuiltinTagKey, PinTag> = {
  visited: { kind: "category", value: "visited" },
  lived: { kind: "category", value: "lived" },
  hometown: { kind: "category", value: "hometown" },
  ironman: { kind: "icon", value: "triathlete" },
  airport: { kind: "icon", value: "airplane" },
  current: { kind: "icon", value: "house-current" },
  ski: { kind: "icon", value: "ski" },
  run: { kind: "icon", value: "run" },
};
```

to:

```ts
const BUILTIN_TAGS: Record<BuiltinTagKey, PinTag> = {
  visited: { kind: "category", value: "visited" },
  lived: { kind: "category", value: "lived" },
  hometown: { kind: "category", value: "hometown" },
  ironman: { kind: "icon", value: "triathlete" },
  airport: { kind: "icon", value: "airplane" },
  current: { kind: "icon", value: "house-current" },
  future: { kind: "icon", value: "house-future" },
  ski: { kind: "icon", value: "ski" },
  run: { kind: "icon", value: "run" },
};
```

- [ ] **Step 7: Wire `future` into `MapView`'s marker-icon resolver**

In `src/components/MapView.tsx`, change:

```ts
function resolveBuiltinKey(place: PinnedPlace): BuiltinTagKey | undefined {
  if (place.icon === "triathlete") return "ironman";
  if (place.icon === "house-home") return "hometown";
  if (place.icon === "house-live") return "lived";
  if (place.icon === "house-current") return "current";
  if (place.icon === "airplane") return "airport";
  if (place.icon === "ski") return "ski";
  if (place.icon === "run") return "run";
  if (place.category) return place.category;
  return undefined;
}
```

to:

```ts
function resolveBuiltinKey(place: PinnedPlace): BuiltinTagKey | undefined {
  if (place.icon === "triathlete") return "ironman";
  if (place.icon === "house-home") return "hometown";
  if (place.icon === "house-live") return "lived";
  if (place.icon === "house-current") return "current";
  if (place.icon === "house-future") return "future";
  if (place.icon === "airplane") return "airport";
  if (place.icon === "ski") return "ski";
  if (place.icon === "run") return "run";
  if (place.category) return place.category;
  return undefined;
}
```

- [ ] **Step 8: Write the failing test for marker rendering**

Add this `it` block to `src/components/MapView.test.tsx`, directly after
the existing `"renders a custom house marker element for a place tagged
with the live icon"` test:

```ts
  it("renders a custom house marker element for a place tagged with the future icon", () => {
    const tagged = { ...paris, icon: "house-future" as const };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        declutterEnabled={true}
        canEdit={true}
      />,
    );
    const marker = markerInstances[0];
    expect(marker?.options?.element).toBeInstanceOf(HTMLElement);
    expect(marker?.options?.color).toBeUndefined();
    expect(marker?.element.title).toBe("Future");
  });
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `npx vitest run src/components/MapView.test.tsx`

Expected: the new test FAILS — `resolveBuiltinKey` doesn't yet recognize
`"house-future"`, so `createMarkerOptions` returns `undefined` and the
marker gets no custom `element`/title. All pre-existing tests in the file
still PASS.

- [ ] **Step 10: Run the test to verify it passes**

Steps 6 and 7 above already made the needed source changes. Run:

Run: `npx vitest run src/components/MapView.test.tsx`

Expected: all tests in the file PASS, including the new one.

- [ ] **Step 11: Update the existing drag-and-drop order test**

`src/components/TagPicker.test.tsx`'s `"persists a new order after a
drag-and-drop reorder"` test (in the `describe("TagPicker", ...)` block)
hardcodes the full built-in tag order produced by a drag-and-drop, and
will now be wrong: adding `"future"` to `BUILTIN_TAG_KEYS` (Step 5) adds
`"icon:house-future"` to that order, between `"icon:house-current"` and
`"icon:ski"`.

Change:

```ts
expect(getTagOrder()).toEqual([
  "category:lived",
  "category:hometown",
  "category:visited",
  "icon:triathlete",
  "icon:airplane",
  "icon:house-current",
  "icon:ski",
  "icon:run",
]);
```

to:

```ts
expect(getTagOrder()).toEqual([
  "category:lived",
  "category:hometown",
  "category:visited",
  "icon:triathlete",
  "icon:airplane",
  "icon:house-current",
  "icon:house-future",
  "icon:ski",
  "icon:run",
]);
```

- [ ] **Step 12: Run the full TagPicker test file to verify it passes**

Run: `npx vitest run src/components/TagPicker.test.tsx`

Expected: all tests in the file PASS, including the updated
drag-and-drop test. No other test in this file references a hardcoded
built-in tag list (verified during planning — only this one test does).

- [ ] **Step 13: Run the full test suite**

Run: `npx vitest run`

Expected: all tests pass, with no regressions in files not touched above.

- [ ] **Step 14: Commit**

```bash
git add src/lib/tagAppearance.ts src/lib/placeTags.ts src/components/TagPicker.tsx src/components/MapView.tsx src/lib/placeTags.test.ts src/components/MapView.test.tsx src/components/TagPicker.test.tsx
git commit -m "feat: add a purple 'future' pin tag"
```

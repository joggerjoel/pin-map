# Unsorted-photo geo-triage panel

**Date:** 2026-08-25
**Status:** approved, not yet implemented
**Relation:** additive on top of the `place_query is null` "unsorted"
convention introduced by `schema_place_photos_unsorted.sql` and
`scripts/import-mitm-photos.ts`, which bulk-imported ~4,951 photos/videos
recovered from a Facebook capture with no place assigned.

## Problem

The bulk import left ~4,951 rows in `pinmap_place_photos` with
`place_query = null`. Nothing in the app can see them — `usePhotos`/
`photosRepository.fetchPhotos` only ever queries rows for a specific place,
and `PlaceList` only renders photos already grouped under a pinned place.
There's no way to browse the unsorted backlog or assign a place to any of
it.

## Invariants

These hold across every section below; implementation choices that would
violate one are bugs, not judgment calls.

- A photo's `place_query` only ever moves from `null` to a real value,
  once, via `assignPhotoPlace`. No UI in this feature writes it back to
  `null` or overwrites an existing non-null value.
- Every Supabase call this feature adds or touches checks the resolved
  `error` field explicitly — a Supabase client call normally *resolves*
  `{ data, error }` rather than rejecting; `try/catch` alone only catches
  network-level throws and would silently treat a resolved error as
  success. This repo's own `fetchPins`/`fetchOwnerId`
  (`src/lib/pinsRepository.ts`) already do this correctly
  (`if (error || data === null) return ...`) — every function below
  follows that same pattern, not a new one.
- A failed write is always distinguishable from "nothing to do" (empty
  result, zero rows affected) in every function's return type — never
  collapsed to the same value.
- The photo grid never shows a false "fully triaged" state. Every render
  branch that could mean "nothing here" is gated on positive evidence
  (a completed fetch that actually returned nothing *and* confirms no
  more pages), never on "no error was thrown."

## Design

### 1. RLS gap: no `UPDATE` policy, plus a supporting index

`schema_place_photos.sql` has `select`/`insert`/`delete` policies but no
`update`. New file `supabase/schema_place_photos_update_policy.sql`:

```sql
drop policy if exists "pinmap_place_photos_update_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_update_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on public.pinmap_place_photos from authenticated, anon;
grant update (place_query) on public.pinmap_place_photos to authenticated;

create index if not exists pinmap_place_photos_unsorted_idx
  on public.pinmap_place_photos (user_id, created_at, id)
  where place_query is null;
```

`drop policy if exists` and `grant`/`index ... if not exists` make the
file safe to re-run. The explicit `revoke` before the column-scoped
`grant` matters: grants are additive, and a self-hosted Supabase instance
typically ships broad default privileges (`GRANT ALL` / `ALTER DEFAULT
PRIVILEGES` to `authenticated`/`anon` on tables in `public`) — without
revoking first, `grant update (place_query)` would add a narrower grant
on top of a broader one already in effect, restricting nothing. The
revoke-then-grant sequence is what actually makes the column scoping
real; the manual test (Acceptance tests) verifies it directly against the
live database rather than trusting the SQL's intent. The partial index
matches the exact filter (`place_query is null`) and order
(`created_at, id`) `fetchUnsortedPhotos`/`fetchUnsortedPhotoCount` use —
at ~5,000 rows it's not required for correctness, but it keeps the query
planner from ever needing a full-table scan as the table grows past this
one batch.

Owner-only, matching the existing insert/delete policies — a signed-in
guest can already *view* the owner's photos (per the existing select
policy's `or user_id in (select user_id from public.pinmap_owner)`
clause) but can't modify them, and triage doesn't change that.

Must be applied to production (`ssh aorus4 docker exec supabase-db psql
...`, same pattern as every other migration this session) before any
assign attempt will succeed.

### 2. Repository: `src/lib/photosRepository.ts`

Add three functions alongside the existing `fetchPhotos`/`uploadPhoto`/
`deletePhoto`. All three destructure `{ data, error }` (or `{ count,
error }`) from the resolved Supabase call and treat a non-null `error`
identically to a thrown exception — both are the failure case, checked
explicitly, not inferred from the absence of a throw.

- **`fetchUnsortedPhotoCount(userId): Promise<number | null>`** —
  `.select('id', { count: 'exact', head: true }).eq('user_id',
  userId).is('place_query', null)`; returns `count` on success, `null` if
  `error` is set or the call throws. `null` means "unknown" everywhere in
  this design (not-yet-loaded *or* failed) — only `0` means "confirmed
  empty."

- **`fetchUnsortedPhotos(userId, {limit, after}): Promise<UnsortedPhoto[] | null>`**
  — keyset pagination. `after` is `{createdAt: string, id: string} |
  null`. Selects `id, storage_path, created_at` (`place_query` is the
  filter, always `null` for any row this can return, and isn't part of
  `UnsortedPhoto`). Query: `.eq('user_id', userId).is('place_query',
  null).order('created_at', {ascending: true}).order('id', {ascending:
  true}).limit(limit)`, plus, when `after` is given, a keyset filter for
  `created_at > after.createdAt OR (created_at = after.createdAt AND id >
  after.id)` via `.or()`. The timestamp value passed into that `or=`
  string must always be double-quoted, unconditionally — it contains `:`
  and (usually, but not reliably — Postgres trims trailing zero
  fractional seconds, so a timestamp landing on a whole second has no
  dot) `.`, both reserved in PostgREST's filter grammar. Quoting only
  when a dot happens to be present would intermittently ship a broken
  filter; the rule is "always quote," not "quote if punctuation is
  present." `id` is the tiebreaker since the bulk import can produce
  `created_at` ties. Returns `null` (not `[]`) on `error` or a thrown
  exception, so "failed" and "empty page" stay distinguishable for every
  page, not just the first.

  `UnsortedPhoto` is `{id, storagePath, createdAt, kind}`. The panel
  derives thumbnail and full-size URLs from `storagePath` via
  `photosRepository`'s existing `publicUrl` helper — for the grid,
  requesting Supabase Storage's image transform (`getPublicUrl(path, {
  transform: { width: 240 } })`), routed through this deployment's
  running `supabase-imgproxy`, rather than the full original; the
  lightbox (§5) requests the untransformed original. `kind: "image" |
  "video"` is derived from the extension: `.mp4`/`.mov`/`.webm` → video,
  everything else → image, checked against the actual imported batch
  (`videos.jsonl`: 22 entries, all `video/mp4`; `images.jsonl`: 4,929
  entries spanning `image/jpeg`, `image/png`, `image/webp`,
  `image/gif`) — every real row today falls cleanly into this split.

  Keyset pagination survives concurrent assigns: every successful
  `assignPhotoPlace` removes a row from the `place_query is null` set,
  and offset/limit pagination would skip rows as that shift happens
  underneath it. A cursor anchored to a specific already-fetched row's
  `(created_at, id)` doesn't have that problem — "give me the next N
  rows after this specific row" stays correct regardless of how many
  earlier rows left the set in the meantime.

- **`assignPhotoPlace(photoId, placeQuery): Promise<"ok" | "conflict" | "error">`**
  — `update pinmap_place_photos set place_query = placeQuery where id =
  photoId and place_query is null`, with `.select('id')` chained. `"ok"`:
  a row came back. `"conflict"`: the update resolved with no `error` but
  zero rows affected — either RLS filtered out a row you don't own (silent,
  no `error`), or the `place_query is null` guard rejected a photo that's
  no longer actually unsorted (already assigned in another tab or an
  earlier retry); for a photo this panel legitimately fetched (always the
  signed-in user's own row), the realistic cause is the latter.
  `"error"`: `error` was set, or the call threw — genuinely retryable,
  unlike `"conflict"`.

### 3. Repository: `src/lib/pinsRepository.ts` — `upsertPins` gets a result

`upsertPins` currently resolves `Promise<void>` unconditionally:

```ts
try {
  await supabase.from("pinmap_pinned_places").upsert(rows, { onConflict: "user_id,query" });
} catch {
  // swallowed
}
```

This neither inspects the resolved `error` nor gives a caller any way to
know the write failed — awaiting it today tells you nothing. Change it to:

```ts
export async function upsertPins(
  userId: string,
  places: PinnedPlace[],
): Promise<"ok" | "error"> {
  if (places.length === 0) return "ok";
  try {
    const rows = places.map((place) => ({ /* unchanged */ }));
    const { error } = await supabase
      .from("pinmap_pinned_places")
      .upsert(rows, { onConflict: "user_id,query" });
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}
```

Every existing call site (`useGeocoder.ts`, three of them — the batch
`pinPlaces` path and the single-place `pinPlace` path) currently calls
this with `void upsertPins(...)`, discarding the return value; `void`
still type-checks against any resolved-promise type, so this is a
non-breaking change for all of them. The batch `pinPlaces` path keeps its
`void` call and stays best-effort/fire-and-forget, unchanged — this
feature doesn't touch its behavior. Only `pinPlace`'s call site changes
(§4) to actually use the result.

### 4. `pinPlace` returns a canonical result, not `void`

`useGeocoder.ts`'s `pinPlace(query, tag)` is currently `Promise<void>` —
failures only surface via `setError`/`setFailedLines`, with no way for a
caller to know whether the pin exists, or under what exact query string.
Change the return type to `Promise<string | null>`:

- Empty input, or a geocode failure → `null`.
- A pin already exists matching case-insensitively (the existing dedup
  short-circuit) → the **existing** pin's stored `query`, exactly as
  stored (not the freshly typed text, which may differ in case/whitespace).
- Geocode succeeds → `pinPlace` now `await`s the corrected `upsertPins`
  (§3) before resolving. On `"ok"`: the optimistic `setPinnedPlaces`
  update (which still runs synchronously right after the geocode
  succeeds, so `AddPin`'s pin still appears instantly — this doesn't
  change) stays, and `pinPlace` resolves the `trimmed` input. On
  `"error"`: the optimistic entry is rolled back
  (`setPinnedPlaces((prev) => prev.filter((p) => p.query !== trimmed))`),
  the line is pushed into `failedLines` the same way a geocode failure
  already is, and `pinPlace` resolves `null`. This is a real behavior
  change for `AddPin` too, and an improvement: today a failed upsert
  leaves a pin that looks fine until it silently disappears on reload
  with zero explanation; after this, the same failure is visible the same
  way a geocode failure already is.

**Single-flight guard for concurrent duplicate creates.** Two different
triage rows can each type the same new place and both call `pinPlace`
before either's `pinnedPlacesRef` dedup check would catch it — the
existing dedup only guards against re-adding an *already-pinned* place,
not two simultaneous in-flight creates of the same new one. Add an
in-flight map keyed by the lowercased/trimmed query
(`pendingPinsRef: Map<string, Promise<string | null>>`) inside
`useGeocoder`: if a call for a given key is already in flight, return
that same promise instead of starting a second geocode+upsert+optimistic-
append. This is centralized in the hook (benefits any future concurrent
caller, not just this panel) and closes the gap without per-row
coordination in the panel itself.

**Also export `clearError: () => void`** — `setError(null)` *and*
`setFailedLines([])` together, since `pinPlace` can populate either on
failure. Unchanged: `pinPlace` still sets both on a real failure, since
`AddPin` still needs them for its normal use. What's new is that the
triage panel replaces `AddPin`/`PlaceInput` while open (§6), so a
triage-time failure's state would otherwise sit invisible until the panel
closes and `AddPin` remounts, showing a stale banner. Every path out of
the triage panel — its own close, clicking "Imports", and sign-out — calls
`clearError()` *only if the triage panel had actually been open this
session* (a ref, not unconditional; see §6 for the concrete mechanism),
so a legitimate pre-existing `AddPin`/`PlaceInput` error from before the
panel was ever opened isn't silently wiped by an unrelated navigation.

**Atomicity, explicitly accepted as a gap.** Creating a pin and assigning
a photo to it are still two separate writes
(`upsertPins`/`pinmap_pinned_places` insert, then
`assignPhotoPlace`/`pinmap_place_photos` update) — not one transaction. A
crash between them leaves a pin with nothing pointing at it (harmless,
just an extra pin) or, in the pathological case of the pin being deleted
between the two writes, a photo pointing at a `place_query` with no
matching pin again. A single Postgres RPC (verify ownership + `place_query
is null` → upsert-or-verify the pin → assign the photo → return the
canonical query, `security definer`, matching the existing
`approve_import_candidate` RPC's shape) would close this fully. Deferred
for this pass: this is a single-user tool working through one
already-captured batch, not a concurrent multi-writer surface, and the
residual window (a network hiccup or tab-close between the two
consecutive calls) is narrow and manually recoverable (an orphaned photo
can be re-triaged; an unused pin can be deleted) rather than the routine
outcome this design needs to prevent. Worth revisiting if this panel's
usage pattern changes.

### 5. Component: `src/components/UnsortedPhotosPanel.tsx` (new)

```ts
export interface UnsortedPhotosPanelProps {
  userId: string; // always non-null; see §6
  pinnedPlaces: PinnedPlace[]; // App passes geocoder.pinnedPlaces
  canCreatePin: boolean; // App passes effectiveToken !== null
  onPinPlace: (query: string, tag: PinTag) => Promise<string | null>;
  onOpenLightbox: (url: string, alt: string) => void; // App passes openPhotoLightbox
  onAssigned: () => void; // count hook's `decrement`
  onEmpty: () => void; // count hook's `markEmpty`
  onClose: () => void;
}
```

Calls `useUnsortedPhotos(userId)` internally (§6). Renders:

**State machine.** Checked in order, exactly one active:

1. `isInitialLoading` → loading indicator only.
2. `photosLoadError` → retry notice (message + button calling `retry()`),
   in place of the grid.
3. `photos.length === 0 && hasMore` → the grid emptied because `assign`
   drained the last loaded photo and triggered its own refill (§6) — not
   confirmed-empty, since `hasMore` is still true. Shows a loading
   indicator while the refill's `isLoadingMore` is true, or the same
   inline "Couldn't load more — tap to retry" affordance branch 5 uses
   (calling `loadMore()`) if it failed. Never "All caught up," never
   calls `onEmpty()`.
4. `photos.length === 0 && !hasMore` → confirmed empty: "All caught up —
   nothing left to triage," and calls `onEmpty()` once (an effect keyed on
   this exact condition).
5. Otherwise → the grid: thumbnails with `alt=""` (no meaningful
   description exists for a sha256-derived filename — a hash read aloud
   by a screen reader is noise, and `alt=""` correctly marks the image
   decorative when its enclosing button already carries a real
   `aria-label`, e.g. `aria-label="Preview unsorted photo 17"` /
   `"Assign unsorted photo 17 to a place"`, using the item's position in
   the loaded list, not the hash). Below the grid, "Load more": disabled
   + "Loading…" while `isLoadingMore`, an inline "Couldn't load more —
   tap to retry" affordance (button stays clickable) on `loadMoreError`,
   hidden once `hasMore` is false.

**Expansion model — one row at a time.** `expandedPhotoId: string | null`
is scalar, not per-photo: opening a card's assign row collapses whichever
other row was open. This is a deliberate simplification (not "several
independent rows can be open"), and avoids several simultaneous in-flight
geocode/assign operations needing independent tracking. `assignError` and
`isAssigning` remain keyed by photo id, but only the currently-expanded
id's entries are ever visible — collapsing a row (by expanding a
different one, or a completed action closing it) clears its error too.

**Preview vs. assign.** Images: a "Preview" button on the card calls
`onOpenLightbox(fullSizeUrl, "")` (the app's existing lightbox, already
used by `PlaceList`); a separate "Assign" button expands the row. Videos
have no lightbox support anywhere in this app — a video card has only
the "Assign" action, rendered as a real `<button>` (not a bare `<video>`
click handler) wrapping a `<video preload="metadata" muted>`, so it's
keyboard-reachable the same way an image card's buttons are. In most
browsers `preload="metadata"` shows the first frame without fetching the
whole file, though the video element doesn't guarantee that; acceptable
given only 22 of the ~4,951 items are videos.

**Assign row.** A text input filtering `pinnedPlaces` client-side
(case-insensitive substring on `place.query`), up to 8 matches as
buttons. Below them, a `Create new pin: "{typed text}"` button — disabled
when the input is empty, and also disabled with an explanatory label
("Connect a Mapbox token to create new pins") when `canCreatePin` is
`false`, matching the existing `AddPin`/`effectiveToken` gate rather than
exposing an action that can't work — that calls `onPinPlace(text,
DEFAULT_TAG)` (`TagPicker`'s existing default, same as `AddPin`; editable
afterward via `PlaceList`'s tag-edit UI).

**Resolving an assignment.** Whichever path resolves a query (an
existing match's `place.query` directly, or `onPinPlace`'s result) calls
`assign(photo, query)`. The create-pin button is already disabled on
empty input, so the only realistic way `onPinPlace` resolves `null`
through this UI is a pin-creation failure (geocode *or* the now-checked
`upsertPins` failure, §4) — shown as "Couldn't create that pin — try
again." without attempting `assign`. `assign`'s three-way result maps to:
`"ok"` → "Saved"; `"conflict"` → "Already assigned elsewhere"; `"error"`
→ "Couldn't save — try again." Both `"ok"` and `"conflict"` call
`onAssigned()` (a `"conflict"` still means one fewer unsorted photo
exists overall, just not from this panel's own write) and remove the
photo from the grid — but not instantly: the row's message is shown for
a short, fixed delay (e.g. 1.2s) before removal, so a card that
disappeared as its message rendered isn't the actual behavior — for
`"ok"` and `"conflict"` alike, the point being to actually communicate
what happened, not just to clear the row. `"error"` shows its message
immediately and leaves the photo in place indefinitely (retryable, no
timed removal).

**In-flight guards are refs, not just state.** `isAssigning` (and every
other in-flight flag in this design — `isLoadingMore`/`isInitialLoading`
in the hook, §6) is backed by a ref checked and set *synchronously*,
before the async call starts, not only by a React state value. Two calls
in the same tick (a double-click before React re-renders, or several
`assign` calls draining the grid to empty in close succession each
trying to trigger a refill) can both observe a stale `false` from state;
a ref set inline avoids that race. The full assign sequence for a row —
from `onPinPlace` (if applicable) through `assign` resolving, including
the display delay — is covered by one such guard, so a double-click
during the geocode step can't fire two `pinPlace` calls before the
single-flight guard (§4) or the dedup check would otherwise catch it.

### 6. Two hooks, and wiring: `src/App.tsx`

**`src/hooks/useUnsortedPhotoCount.ts` (new, App-level).**

```ts
export interface UseUnsortedPhotoCountResult {
  totalCount: number | null;
  refetch: () => void;
  decrement: () => void;
  markEmpty: () => void;
}
```

Skips fetching while `userId` is `null`. An effect keyed on `[userId]`
fetches the count; both that effect's fetch and every `refetch()` call
share one generation counter (a ref, incremented each time a fetch
starts) — a response is only applied if its captured generation still
matches the ref's current value when it resolves. This covers every
stale-response case in one mechanism: a late response after `userId`
changes (sign-out — the only transition `userId` can make, since
`useAuth` always passes through `signed-out` before any new sign-in), and
a `refetch()` superseded by a later `refetch()` or by the effect
re-running. `decrement` subtracts 1, floored at 0, no-op while `null`.
`markEmpty` unconditionally sets `0`.

**`src/hooks/useUnsortedPhotos.ts` (new, instantiated only inside the
panel).**

```ts
export interface UseUnsortedPhotosResult {
  photos: UnsortedPhoto[];
  isInitialLoading: boolean;
  photosLoadError: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
  assign: (photo: UnsortedPhoto, placeQuery: string) => Promise<"ok" | "conflict" | "error">;
}
```

Instantiated inside `UnsortedPhotosPanel`, not lifted to `App` — every
panel open is a fresh instance, so there's no cross-open staleness to
reconcile, and `userId` is stable for the panel's whole mounted lifetime
(the panel only renders while signed in, and a user swap always passes
through an unmount first, per the same reasoning as the count hook).

Uses the same generation-ref pattern as the count hook to keep the
initial load, `retry()`, and `loadMore()` from applying an out-of-order
response, on top of the `isLoadingMore`/`isInitialLoading` ref guards
(§5) that stop a second call from starting at all while one is in
flight. On mount: fetches the first page (`limit: 60`, a module-level
constant in this file — `fetchUnsortedPhotos` itself is agnostic to page
size) while `isInitialLoading` is true; `null` → `photosLoadError`; an
array → populates `photos`, `hasMore = (length === limit)`, records the
last row as the cursor (internal ref state, not derived from `photos` —
draining `photos` to empty via `assign` must not leave `loadMore` with
nowhere to read a cursor from). `retry()` re-runs the initial load and
resets `isInitialLoading`/`photosLoadError` for the new attempt.
`loadMore()`: a `null` result sets `loadMoreError` without touching
`hasMore` or the cursor (unknown, not "no more"); an empty array sets
`hasMore: false` without advancing the cursor (nothing to advance to); a
non-empty array appends, updates `hasMore`, advances the cursor.
`assign()` calls `assignPhotoPlace` and returns its result unchanged; on
`"ok"`/`"conflict"` it removes the photo from `photos` and, if that
drains `photos` to empty while `hasMore` is still true, automatically
triggers the same fetch `loadMore()` would (through the same guard).

**Wiring in `App.tsx`.** Same conditional-swap pattern already used for
`effectiveToken !== null ? <AddPin/.../> : <p>...</p>` inside `<aside>` —
`MapView` renders outside `<aside>`, untouched either way. `ImportsPanel`
swaps the whole view via an early `return` before `<aside>` is ever
reached, which already makes `showImports`/`showUnsortedPhotos` mutually
exclusive by construction.

- `useUnsortedPhotoCount(userId)` instantiated at `App` level.
- A ref, `panelWasOpenedRef` (initialized `false`), tracks whether the
  triage panel has been opened this session — set to `true` in the header
  button's click handler, alongside opening the panel. A small helper,
  `clearErrorIfPanelWasOpen = () => { if (panelWasOpenedRef.current)
  geocoder.clearError(); }`, is what every exit path below actually
  calls — this is the concrete form of §4's "only clear if the panel had
  been open" rule, not a separate mechanism.
- Header button next to "Imports", gated on `auth.status ===
  "signed-in"` (`userId` guaranteed non-null). Label: `Unsorted` when
  `totalCount === null`, `Unsorted ({totalCount})` otherwise; rendered
  whenever `totalCount` is `null` or `> 0` (equivalently: hidden only at
  exactly `0`, since `decrement`'s floor means it's never negative).
  Click sets `panelWasOpenedRef.current = true`, `showUnsortedPhotos:
  true`, and calls `count.refetch()` — every open re-fetches fresh rather
  than trusting a possibly-`null` or drifted value.
- Panel renders when `showUnsortedPhotos && auth.status === "signed-in"`.
- Three exit paths, all calling `clearErrorIfPanelWasOpen()` before
  resetting `showUnsortedPhotos` to `false`: the panel's own `onClose`;
  clicking "Imports" (so returning from Imports lands on the normal place
  list, not a stale triage panel or a stale error banner); and an effect
  on `auth.status` becoming `"signed-out"`. Gating all three on the same
  ref means a user who never opened the panel this session — clicking
  "Imports" straight from a legitimate `AddPin` error — never has that
  error silently wiped by a path this feature doesn't own.
- `<UnsortedPhotosPanel userId={userId} pinnedPlaces={geocoder.pinnedPlaces}
  canCreatePin={effectiveToken !== null} onPinPlace={geocoder.pinPlace}
  onOpenLightbox={openPhotoLightbox} onAssigned={count.decrement}
  onEmpty={count.markEmpty} onClose={() => { clearErrorIfPanelWasOpen();
  setShowUnsortedPhotos(false); }} />` in place of `<AddPin>` /
  `<PlaceInput>` / `<PlaceList>`.

## Acceptance tests

- **`photosRepository.test.ts`** — each new function against both a
  resolved `{ error }` (not just a rejected promise) and a thrown
  exception, for every failure case: `fetchUnsortedPhotoCount`
  (`null` on either failure mode, distinct from `0`); `fetchUnsortedPhotos`
  (keyset pagination — cursor advances, `id` tiebreak, short/empty/full
  page — `null` on either failure mode, `kind` derivation, thumbnail vs.
  full-size transform URLs); `assignPhotoPlace` (`"ok"` on an affected
  row, `"conflict"` on zero rows with no `error`, `"error"` on a resolved
  `error` or a throw).
- **`pinsRepository.test.ts`** — `upsertPins` returns `"ok"`/`"error"` for
  both a resolved `{ error }` and a thrown exception; empty `places`
  short-circuits to `"ok"` without calling Supabase.
- **`useGeocoder.test.ts`** — `pinPlace` resolves: the trimmed input on a
  successful geocode + upsert; `null` with the optimistic entry rolled
  back and `failedLines` populated when `upsertPins` resolves `"error"`;
  the *existing* pin's stored query on the dedup short-circuit (verified
  with case/whitespace-differing input); `null` on geocode failure or
  empty input. Two concurrent `pinPlace` calls for the same new query
  share one in-flight geocode/upsert and both resolve the same value, not
  two separate creates. `clearError` resets both `error` and
  `failedLines`.
- **`useUnsortedPhotoCount.test.ts`** — skips fetching while `userId` is
  `null`; fetches once non-null; a response from a superseded generation
  (changed `userId`, or an older `refetch()`) is dropped; `refetch`
  updates `totalCount` from a fresh fetch; `decrement` floors at 0 and
  no-ops on `null`; `markEmpty` forces `0` from any state.
- **`useUnsortedPhotos.test.ts`** — `isInitialLoading` blocks `loadMore`/
  `retry` until the first page settles; two `loadMore()` calls issued in
  the same tick (before any state update) result in exactly one fetch;
  cursor/`hasMore` behavior for a short/empty/full/failed page, including
  after the currently-loaded photos have all been assigned away; `assign`
  removes on `"ok"`/`"conflict"`, keeps on `"error"`; draining `photos`
  while `hasMore` is true auto-triggers exactly one refill.
- **`UnsortedPhotosPanel.test.tsx`** — all five render-state branches,
  including branch 3 (empty-but-`hasMore`, both its loading and
  `loadMoreError` sub-states) never showing "All caught up" or calling
  `onEmpty`, vs. branch 4 doing exactly that; only one row expanded at a
  time; a video card's assign trigger is a real, keyboard-reachable
  button; "Preview" opens `onOpenLightbox` with the full-size URL; a
  `"conflict"`/`"ok"` assign shows its message for the fixed delay before
  removing the card, an `"error"` shows immediately and doesn't remove
  it; `canCreatePin: false` disables "Create new pin" with its
  explanatory label while existing-pin matches still work; a
  double-click on any row action before the first response resolves
  produces exactly one `assign`/`onPinPlace` call.
- **`App.test.tsx`** — header button visibility/label across
  `null`/`0`/`N`; click calls `refetch()`; both the panel and header are
  gated on `signed-in`; sign-out resets the flag and conditionally clears
  geocoder error only if the panel had been open; same for clicking
  "Imports"; a pre-existing `AddPin` error from before the panel was ever
  opened survives an Imports round-trip; opening the panel swaps in
  `UnsortedPhotosPanel` with `MapView` still mounted.
- **Manual, after applying the migration to production**: an
  existing-pin match and a create-new-pin path succeed end-to-end,
  including the create-pin failure case's inline error; clicking "Load
  more" at least once against real PostgREST (the keyset `.or()` filter
  is the one part no mocked-client test can validate); as a second,
  throwaway user, confirm an `UPDATE` against the first user's row
  affects zero rows; as the first user, confirm an `UPDATE` on
  `storage_path` on your own row is rejected (proves the revoke+grant
  sequence actually restricts columns, not just the RLS policy);
  measure actual transferred bytes for a "Load more" page to confirm the
  thumbnail transform is actually smaller than the originals.

## Out of scope

- Bulk/multi-select assignment — the approved goal is browse-and-
  cherry-pick, not full-backlog processing.
- EXIF/timestamp/location-based auto-suggestion — Facebook strips that
  metadata, which is why these are unsorted in the first place.
- Infinite scroll — "Load more" is simpler and sufficient at this scale.
- Deleting/bulk-archiving unsorted photos from this panel — existing
  per-place `deletePhoto` is unaffected and still available post-assign.
- Undoing/reassigning a mis-triaged photo — no more capable "move to a
  different place" UI exists anywhere in the app today; not a regression.
- A full-size video preview — no video lightbox/player exists anywhere
  in this app; out of scope for 22 files in a first pass.
- A single atomic pin-creation-and-assignment RPC — see §4's accepted
  atomicity window.

## Decision notes

Trade-offs accepted deliberately, kept here rather than scattered inline:

- **Badge accuracy** is best-effort, not live: `totalCount` is refreshed
  on every panel open and adjusted locally by `decrement`/`markEmpty`
  between opens, but isn't reconciled across concurrent sessions or a
  concurrent second import, and a `decrement` landing while a `refetch`
  is still in flight can drift by one until the next adjustment. Given
  this feature exists to work through one already-captured batch by one
  user, that's accepted rather than solved with a live subscription.
- **Pin-creation atomicity** — see §4. Accepted narrow window, not solved
  with an RPC, for the same single-user reasoning.
- **Alt text** is `alt=""` by design (§5) — a sha256 filename read by a
  screen reader would be noise, not a description; the real accessible
  labels live on the surrounding buttons.

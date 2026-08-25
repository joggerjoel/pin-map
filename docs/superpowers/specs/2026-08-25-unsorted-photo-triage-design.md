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
  using (auth.uid() = user_id and place_query is null)
  with check (
    auth.uid() = user_id
    and place_query is not null
    and btrim(place_query) <> ''
  );

revoke update on public.pinmap_place_photos from authenticated, anon;
grant update (place_query) on public.pinmap_place_photos to authenticated;

create index if not exists pinmap_place_photos_unsorted_idx
  on public.pinmap_place_photos (user_id, created_at, id)
  where place_query is null;
```

The `using` clause's `place_query is null` isn't redundant with
`assignPhotoPlace`'s own `and place_query is null` — `using` is
evaluated by Postgres against the row's state *before* the update,
independent of what query executes it. Without it, the Invariants
section's "moves from `null` to a real value, once" claim would only be
true because the one function this app happens to call does it that
way — any authenticated owner could otherwise issue their own `UPDATE`
directly against PostgREST (their own valid session already has
column-level `UPDATE` on `place_query` for their own rows) and overwrite
an already-assigned photo's `place_query`. With it, that transition is
enforced by Postgres itself, not by which client code exists.

The `with check` clause's `place_query is not null and btrim(place_query)
<> ''` closes the other half of the same invariant: "moves to a *real*
value" implicitly meant non-blank, but nothing enforced that until now —
a direct API call could otherwise set `place_query` to `''` and have it
technically satisfy `is not null` while being meaningless to every
existing place-lookup in the app (`PlaceList`/`fetchPhotos` key on
`query`, none of which treat `''` specially). `assignPhotoPlace` (§2)
also validates `placeQuery.trim() !== ""` at the repository boundary
before ever issuing the update — redundant with the DB constraint by
design, so a bug in one layer doesn't silently rely on the other.

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
  after.id)`. PostgREST's `.or()` grammar is a flat comma-separated list
  of `column.op.value` terms — expressing an `OR` of an `AND` isn't three
  flat terms, it needs an explicit `and(...)` group nested inside the
  `or(...)` string: `` .or(`created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")`) ``.
  Writing it as three flat OR'd terms instead would silently produce a
  different (wrong) query — one that also matches any row with `id >
  after.id` regardless of `created_at`, re-returning already-seen rows.
  The double-quoting around each value is unconditional, not "when it has
  punctuation": `after.createdAt` contains `:` and (usually, but not
  reliably — Postgres trims trailing zero fractional seconds, so a
  timestamp landing on a whole second has no dot) `.`, both reserved in
  this grammar. `after.createdAt`/`after.id` are also validated as a
  well-formed ISO timestamp / UUID before being interpolated at all — the
  function is exported and callable directly with an arbitrary `after`
  argument, not only through the UI's own generated cursors, so this
  isn't purely a formatting nicety. `id` is the tiebreaker since the bulk
  import can produce `created_at` ties. Returns `null` (not `[]`) on
  `error` or a thrown exception, so "failed" and "empty page" stay
  distinguishable for every page, not just the first.

  `UnsortedPhoto` is `{id, storagePath, createdAt, kind}`. `kind: "image"
  | "video"` is derived from the extension: `.mp4`/`.mov`/`.webm` →
  video, everything else → image, checked against the actual imported
  batch (`videos.jsonl`: 22 entries, all `video/mp4`; `images.jsonl`:
  4,929 entries spanning `image/jpeg`, `image/png`, `image/webp`,
  `image/gif`) — every real row today falls cleanly into this split.

  URL rules, all three derived from `storagePath` via `photosRepository`'s
  existing `publicUrl` helper — and, critically, the image transform only
  ever applies to `kind: "image"`, never to a video: `supabase-imgproxy`
  transforms images, it doesn't extract a frame from a video file, so
  requesting a transformed URL for a video's `storagePath` would be
  requesting something imgproxy can't produce.

  The existing `publicUrl(storagePath)` helper in `photosRepository.ts`
  gains one new optional parameter rather than a second helper being
  written alongside it: `publicUrl(storagePath, options?: { width?:
  number })`, passing `options` straight through as `getPublicUrl`'s
  `transform` argument when present. Every existing call site (the
  per-place `PlacePhoto` flow) omits the second argument and is
  unaffected.
  - Image, grid thumbnail: `publicUrl(path, { width: 240 })`.
  - Image, lightbox (§5): `publicUrl(path)`, untransformed.
  - Video, card (there is no separate "video thumbnail"): `publicUrl(path)`,
    untransformed — the `<video preload="metadata">` element lets the
    *browser* derive a first-frame preview client-side from the real
    file; there's nothing server-side to transform.

  Before relying on the image transform at all, verify on aorus4 that
  Supabase Storage's `storage-api` actually has image transformation
  enabled and pointed at the running `supabase-imgproxy` (an
  `ENABLE_IMAGE_TRANSFORMATION`-style flag plus an `IMGPROXY_URL` — a
  container merely running elsewhere in the stack doesn't imply
  `storage-api` is wired to use it) — a direct `curl` of a transformed
  URL for one real photo, confirming a resized image comes back, before
  any grid code is written against it. Also confirm the installed
  `@supabase/storage-js` version actually supports the `transform` option
  on `getPublicUrl` — it's not universal across versions.

  Keyset pagination survives concurrent assigns: every successful
  `assignPhotoPlace` removes a row from the `place_query is null` set,
  and offset/limit pagination would skip rows as that shift happens
  underneath it. A cursor anchored to a specific already-fetched row's
  `(created_at, id)` doesn't have that problem — "give me the next N
  rows after this specific row" stays correct regardless of how many
  earlier rows left the set in the meantime.

- **`assignPhotoPlace(photoId, placeQuery): Promise<"ok" | "conflict" | "error">`**
  — validates `placeQuery.trim() !== ""` before issuing any query,
  returning `"error"` immediately if it's blank (matching the DB's own
  `with check` constraint, §1 — this is the same guarantee enforced at
  both layers on purpose, not a substitute for either one). Otherwise:
  `update pinmap_place_photos set place_query = placeQuery where id =
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

Every existing call site (`useGeocoder.ts`, three of them — two inside
the batch `pinPlaces` path, one inside the single-place `pinPlace` path)
currently calls this with `void upsertPins(...)`, discarding the return value; `void`
still type-checks against any resolved-promise type, so this is a
non-breaking change for all of them, and none of them change — `pinPlace`
stays exactly as it is today too (see §4 for why). The only new caller
that actually uses the result is `pinPlaceSilent` (§4), a new sibling
function, not a change to any existing call site.

### 4. `pinPlaceSilent`: a triage-only sibling to `pinPlace`

`useGeocoder.ts`'s existing `pinPlace(query, tag)` stays exactly as it is
today (`Promise<void>`, mutates the hook's own `error`/`failedLines` on
failure) — `AddPin` keeps using it unchanged. Reusing it for triage was
an earlier draft's mistake: it would have meant either mutating shared
error state from inside a panel that has no visible surface for that
state (§6 discusses why — `AddPin`/`PlaceInput` are unmounted while the
panel is open), or bolting a fragile "only clear if opened" ref onto
`App.tsx` to compensate, which itself never got reset and could wipe a
different, unrelated `AddPin` error. Simpler to not share the mutation at
all: add a new function that shares the same geocode-then-persist
mechanics but is pure — it returns a discriminated result and never
touches `error`/`failedLines`, so there's nothing to clear and no ref to
forget to reset.

```ts
export type PinPlaceResult =
  | { status: "ok"; query: string }
  | { status: "invalid" }
  | { status: "geocode-error" }
  | { status: "persistence-error" };

export async function pinPlaceSilent(
  query: string,
  tag: { category?: PlaceCategory; icon?: PlaceIcon; customTag?: CustomTag },
): Promise<PinPlaceResult> { /* below */ }
```

- Empty input → `{status: "invalid"}`.
- A pin already exists matching case-insensitively (the existing dedup
  short-circuit) → `{status: "ok", query}` with the **existing** pin's
  stored `query`, exactly as stored (not the freshly typed text, which
  may differ in case/whitespace).
- Geocode fails → `{status: "geocode-error"}`.
- Geocode succeeds → the optimistic `setPinnedPlaces` update runs
  (identical to `pinPlace`'s own, so the new pin shows up immediately on
  the map the same way an `AddPin` pin does), then `await`s the
  corrected `upsertPins` (§3). On `"ok"`: resolves `{status: "ok",
  query: trimmed}`. On `"error"`: the optimistic entry is rolled back
  (`setPinnedPlaces((prev) => prev.filter((p) => p.query !== trimmed))`)
  and it resolves `{status: "persistence-error"}` — no `failedLines`
  write, since this function never touches that state.
- `incrementPlacesPinned(1)` — called unconditionally today inside
  `pinPlace` right after a successful geocode — is called here only
  after `upsertPins` resolves `"ok"`, not merely after a successful
  geocode: the counter should reflect pins that actually persisted, and
  this function has the awaited result available to gate on, unlike
  `pinPlace`'s existing fire-and-forget call site (which this doesn't
  change).

**Single-flight guard for concurrent duplicate creates**, scoped to
`pinPlaceSilent` only (a `useGeocoder`-level `pendingPinsRef:
Map<string, Promise<PinPlaceResult>>`, keyed by the lowercased/trimmed
query) — not shared with `pinPlace`, whose `Promise<void>` return type
and error-mutating side effect don't fit the same map. `pinPlace` keeps
its existing (weaker, pre-existing) dedup behavior unchanged; this guard
exists specifically for the scenario the panel actually has — two
different triage rows each typing the same new place and both calling
`pinPlaceSilent` before either's `pinnedPlacesRef` dedup check would
catch it (that dedup only guards against re-adding an *already-pinned*
place, not two simultaneous in-flight creates of the same new one). If a
call for a given key is already in flight, return that same promise
instead of starting a second geocode+upsert+optimistic-append; wrap the
promise in a `.finally()` that deletes the map entry once it settles,
success or failure alike — without that, a key whose attempt resolved to
an error would keep returning that same stale failed promise to every
later retry for the same text, silently making the panel's own "try
again" affordance a no-op forever for that place name. `AddPin` itself
has no equivalent multi-row-concurrency scenario (it's a single form),
so `pinPlace` not sharing this guard isn't a gap for its own use case.

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
consecutive calls) is narrow. Recovery is *not* "re-triage it in the
panel," though — the Invariants section (and now the RLS `using` clause
itself, §1) rule that out on purpose: `place_query` moves from `null`
once and stays put, so an orphaned photo (assigned to a pin that never
persisted) is invisible to this panel forever, not merely until someone
gets to it. The honest recovery path is direct SQL (`update
pinmap_place_photos set place_query = null where id = ...`, run as an
operator, same access level as applying the migration itself) or
accepting the orphan — not an in-app affordance. An unused pin (the
milder half of this race) can be deleted normally, no special access
needed. Worth building the RPC if this ever stops being a narrow,
manually-recoverable edge case.

### 5. Component: `src/components/UnsortedPhotosPanel.tsx` (new)

```ts
export interface UnsortedPhotosPanelProps {
  userId: string; // always non-null; see §6
  pinnedPlaces: PinnedPlace[]; // App passes geocoder.pinnedPlaces
  canCreatePin: boolean; // App passes effectiveToken !== null
  onPinPlace: (query: string, tag: PinTag) => Promise<PinPlaceResult>; // geocoder.pinPlaceSilent
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
geocode/assign operations needing independent tracking. Expanding a
*different* card is disabled while the currently-expanded one has an
assign sequence in flight (`isAssigning` true) — not just each row's own
actions disabled against a second click on itself (§ below), but the
"open a different row" action too — specifically so a card can never be
collapsed while its own result is still pending, which would otherwise
leave that row's outcome with nowhere to render (see "Resolving an
assignment," which reports outcomes through a panel-level toast for
exactly this reason, but the row-level `assignError` for an `"error"`
result still needs its own card visible to retry from). `assignError` is
keyed by photo id and only ever shown on that photo's own card, cleared
when the row collapses after resolving.

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
existing match's `place.query` directly, or `onPinPlace`'s `{status:
"ok", query}`) calls `assign(photo, query)`. The create-pin button is
already disabled on empty input, so the two realistic non-`"ok"`
`onPinPlace` outcomes through this UI are `"geocode-error"` and
`"persistence-error"` — both shown as "Couldn't create that pin — try
again." on the row (one message covers both; the distinct statuses exist
for future callers, not because this UI differentiates them today)
without attempting `assign`.

`assign`'s three-way result determines what happens next, and — unlike
an earlier draft of this design — removal from the grid is never delayed
to let a message be read: the hook already removes the photo from
`photos` synchronously on `"ok"`/`"conflict"` (§6), so the component
doesn't fight that by trying to keep the card around. Instead, the panel
owns one small, non-blocking notice area (not per-card) that a resolved
outcome writes into and that auto-dismisses on its own timer, entirely
decoupled from any card's lifecycle: `"ok"` → "Saved"; `"conflict"` →
"Already assigned elsewhere" (still counts as one fewer unsorted photo,
so `onAssigned()` fires the same as `"ok"` — a `"conflict"` just means
someone else's action caused the removal, not this panel's own write).
`"error"` is the one outcome that *doesn't* go to the shared notice area
and *doesn't* remove the card: it sets that specific photo's
`assignError` and stays visible on its own row, since it needs a retry
affordance attached to a specific card, not a passing notice.

The notice's own dismiss timer needs the same discipline every other
timer/async result in this design gets: its `setTimeout` id lives in a
ref, not a bare local variable, so a second notice arriving before the
first has dismissed clears the outstanding timeout before starting a
new one (otherwise an earlier notice's dismiss could fire after a later
notice has already replaced it, clearing text the user hasn't read yet).
An unmount effect clears that same ref's timeout unconditionally. And
because `assign`/`onPinPlace` are awaited before the notice is ever
set, every one of those call sites checks a `mountedRef` (set `false` in
the same unmount cleanup) before calling any state setter — closing over
the general case, not just the notice, that a slow network response can
resolve after the panel (and the hook instance with it, §6) is already
gone. Rendered as `role="status" aria-live="polite"` — an unlabeled
`<div>` update wouldn't be announced to a screen reader at all, and
`"assertive"` would be gratuitously interruptive for a non-error
confirmation.

**In-flight guards are refs, not just state.** `isAssigning` is backed by
a ref checked and set *synchronously*, before the async call starts, not
only by a React state value — two calls in the same tick (a double-click
before React re-renders) can both observe a stale `false` from state; a
ref set inline avoids that race. The full sequence for a row — from
`onPinPlace` (if applicable) through `assign` resolving — is covered by
one such guard, so a double-click during the geocode step can't fire two
`pinPlaceSilent` calls before the single-flight guard (§4) or the dedup
check would otherwise catch it. Because removal is no longer delayed,
there's no window after `assign` resolves where a stale timer could fire
against an unmounted card or a closed panel — the guard's job ends the
moment `assign` (and `onAssigned`/the notice) resolves, not some fixed
interval later. The hook's own `isLoadingMore`/`isInitialLoading` guards
(§6) follow the identical synchronous-ref pattern for the same reason.

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

A second effect calls `refetch()` on the browser's `focus` event (while
`userId` is non-null) — cheap (one `head: true` count query), and it's
what keeps the header button (§6 below) from being a dead end once
`totalCount` reaches `0` and the button that would otherwise trigger a
refetch has hidden itself. Without this, a second import landing later in
the same session would have no way to ever reveal itself again short of
a full reload — the "quietly disappear once triaged" behavior the button
is deliberately designed to have (see below) shouldn't also mean
"permanently forgets to check again."

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
response, on top of `isLoadingMore`/`isInitialLoading` themselves
stopping a second call from starting at all while one is in flight (the
panel's own `isAssigning` guard, §5, follows this same synchronous-ref
pattern). On mount: fetches the first page (`limit: 60`, a module-level
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

- `useUnsortedPhotoCount(userId)` instantiated at `App` level, passing
  `auth.userId` — the signed-in caller's own id — never `ownerUserId`
  (the read-only "view the owner's data as a guest" concept `usePhotos`
  uses elsewhere in this app). The panel is the same: `userId` is always
  the caller's own. A signed-in guest therefore only ever sees *their
  own* unsorted-photo count and grid through this feature — for a guest
  that's `0` today, since only the owner's account has rows from the
  mitm-proxy import — never the owner's raw, untriaged batch. This
  matters because the existing `select` RLS policy (§1) lets a guest
  *view* the owner's already-placed photos; that's an intentional,
  existing exposure this feature doesn't extend to the unsorted backlog,
  since nothing in this design ever queries by `ownerUserId`.
- Header button next to "Imports", gated on `auth.status ===
  "signed-in"` (`userId` guaranteed non-null). Label: `Unsorted` when
  `totalCount === null`, `Unsorted ({totalCount})` otherwise; rendered
  whenever `totalCount` is `null` or `> 0` (equivalently: hidden only at
  exactly `0`, since `decrement`'s floor means it's never negative — the
  focus-triggered `refetch()` above is what keeps this from being a
  permanent dead end once it hides). Click sets `showUnsortedPhotos:
  true` and calls `count.refetch()` — every open re-fetches fresh rather
  than trusting a possibly-`null` or drifted value.
- Panel renders when `showUnsortedPhotos && auth.status === "signed-in"`.
  Two exit paths reset `showUnsortedPhotos` to `false`: the panel's own
  `onClose`, and an effect on `auth.status` becoming `"signed-out"`.
  Clicking "Imports" also resets it, so returning from Imports lands on
  the normal place list rather than a stale triage panel. None of these
  need to touch `geocoder`'s error state — `pinPlaceSilent` (§4) never
  writes to it in the first place, so there's nothing to clear and no
  ref tracking "was the panel ever open" to forget to reset.
- `<UnsortedPhotosPanel userId={userId} pinnedPlaces={geocoder.pinnedPlaces}
  canCreatePin={effectiveToken !== null} onPinPlace={geocoder.pinPlaceSilent}
  onOpenLightbox={openPhotoLightbox} onAssigned={count.decrement}
  onEmpty={count.markEmpty} onClose={() => setShowUnsortedPhotos(false)}
  />` in place of `<AddPin>` / `<PlaceInput>` / `<PlaceList>`.

## Acceptance tests

- **`photosRepository.test.ts`** — each new function against both a
  resolved `{ error }` (not just a rejected promise) and a thrown
  exception, for every failure case: `fetchUnsortedPhotoCount`
  (`null` on either failure mode, distinct from `0`); `fetchUnsortedPhotos`
  (keyset pagination — cursor advances, `id` tiebreak, short/empty/full
  page — `null` on either failure mode, `kind` derivation); `assignPhotoPlace`
  (`"ok"` on an affected row, `"conflict"` on zero rows with no `error`,
  `"error"` on a resolved `error` or a throw, and `"error"` for a blank/
  whitespace-only `placeQuery` without ever calling Supabase). Separately, the URL-derivation
  helper: an image gets a transformed URL for the grid and an
  untransformed one for the lightbox; a video always gets the
  untransformed URL, never a transform request.
- **`pinsRepository.test.ts`** — `upsertPins` returns `"ok"`/`"error"` for
  both a resolved `{ error }` and a thrown exception; empty `places`
  short-circuits to `"ok"` without calling Supabase.
- **`useGeocoder.test.ts`** — `pinPlace` (unchanged) keeps its existing
  test coverage untouched. New coverage for `pinPlaceSilent`: resolves
  `{status: "ok", query: trimmed}` on a successful geocode + upsert, and
  calls `incrementPlacesPinned(1)` only in that case — not merely on a
  successful geocode; resolves `{status: "ok", query}` with the
  *existing* pin's stored query on the dedup short-circuit (verified with
  a case/whitespace-differing input, to prove it's not just echoing the
  argument back), without incrementing the counter again; resolves
  `{status: "persistence-error"}` with the optimistic entry rolled back
  and no counter increment when `upsertPins` resolves `"error"`;
  resolves `{status: "geocode-error"}` / `{status: "invalid"}` for a
  geocode failure / empty input; never calls `setError`/`setFailedLines`
  in any of these cases (asserted directly against the hook's `error`/
  `failedLines`, which must stay untouched by any `pinPlaceSilent` call).
  Single-flight: two concurrent `pinPlaceSilent` calls for the same new
  query share one in-flight geocode/upsert and resolve the same outcome,
  not two separate creates or two counter increments; a concurrent
  `pinPlace` call for the same query is unaffected by (and doesn't
  interact with) `pinPlaceSilent`'s guard, since the map is scoped to
  `pinPlaceSilent` only. After a shared `pinPlaceSilent` attempt
  resolves — success or failure — a subsequent call for the same
  query text is a fresh attempt, not a replay of the cached result
  (proves the `pendingPinsRef` entry is actually cleaned up).
- **`useUnsortedPhotoCount.test.ts`** — skips fetching while `userId` is
  `null`; fetches once non-null; a response from a superseded generation
  (changed `userId`, or an older `refetch()`) is dropped; `refetch`
  updates `totalCount` from a fresh fetch, including via a simulated
  window `focus` event; `decrement` floors at 0 and no-ops on `null`;
  `markEmpty` forces `0` from any state.
- **`useUnsortedPhotos.test.ts`** — `isInitialLoading` blocks `loadMore`/
  `retry` until the first page settles; two `loadMore()` calls issued in
  the same tick (before any state update) result in exactly one fetch;
  cursor/`hasMore` behavior for a short/empty/full/failed page, including
  after the currently-loaded photos have all been assigned away; `assign`
  removes on `"ok"`/`"conflict"` immediately (synchronously on
  resolution, no delay), keeps on `"error"`; draining `photos` while
  `hasMore` is true auto-triggers exactly one refill.
- **`UnsortedPhotosPanel.test.tsx`** — all five render-state branches,
  including branch 3 (empty-but-`hasMore`, both its loading and
  `loadMoreError` sub-states) never showing "All caught up" or calling
  `onEmpty`, vs. branch 4 doing exactly that; only one row expanded at a
  time, and expanding a different row is blocked while the current one's
  `isAssigning` is true; a video card's assign trigger is a real,
  keyboard-reachable button and its `<video>` `src` is always the
  untransformed URL; "Preview" opens `onOpenLightbox` with the
  untransformed full-size URL, never the thumbnail transform; an `"ok"`/
  `"conflict"` assign removes the card immediately and shows the shared
  notice ("Saved" / "Already assigned elsewhere") independent of the
  card — including when the card that resolved isn't the currently
  expanded one; an `"error"` shows on that specific card only, doesn't
  remove it, and doesn't touch the shared notice; `canCreatePin: false`
  disables "Create new pin" with its explanatory label while
  existing-pin matches still work; a double-click on any row action
  before the first response resolves produces exactly one `assign`/
  `onPinPlace` call; closing the panel or unmounting mid-assign produces
  no further state updates or duplicate callbacks once the pending call
  eventually resolves (the `mountedRef` guard, §5); the notice area
  renders with `role="status"` and `aria-live="polite"`; a second notice
  arriving before the first one's dismiss timer has fired clears that
  timer and shows the new text instead of both racing to clear it; the
  notice's timer is cleared on unmount (no dismiss-triggered state update
  after the panel is gone).
- **`App.test.tsx`** — header button visibility/label across
  `null`/`0`/`N`; click calls `refetch()`; both the panel and header are
  gated on `signed-in`; sign-out resets `showUnsortedPhotos`; clicking
  "Imports" does the same; a pre-existing `AddPin` error/`failedLines`
  entry is untouched by opening, using, and closing the triage panel, and
  by an Imports round-trip, since nothing on the triage path writes to
  that state at all; opening the panel swaps in `UnsortedPhotosPanel` in
  place of `AddPin`/`PlaceInput`/`PlaceList` with `MapView` still mounted.
- **`src/test/unsortedPhotosRls.live.test.ts`** (new) — follows this
  repo's existing live-Supabase pattern (`src/test/
  importCandidatesRls.live.test.ts`: `describe.skipIf(!shouldRun)` gated
  on `RUN_LIVE_SUPABASE_TESTS=1`, real creds loaded from `.env` via that
  file's `loadRealEnv()`, a service-role admin client to create two
  throwaway users). Against the real database (not the mocked client
  every other test in this design uses): a second user's `UPDATE` on the
  first user's unsorted-photo row affects zero rows; the first user's own
  `UPDATE` on `storage_path` is rejected (the revoke+grant column scoping,
  §1); an `UPDATE` attempting to set `place_query` to `''` or to `null`
  is rejected by the `with check` clause; an `UPDATE` on an already-
  assigned row (`place_query` already non-null) affects zero rows (the
  `using` clause). This is what actually runs the RLS/grant guarantees on
  every change to this policy, not just once by hand — there's no CI in
  this repo to run it automatically (`.github/workflows` doesn't exist
  here at all, matching every other test in the codebase), so it's run
  manually via `bun run test -- unsortedPhotosRls.live`, same as the
  existing one, immediately after applying the migration below and again
  after any future change to `schema_place_photos_update_policy.sql`.
- **Manual, after applying the migration to production and running the
  live RLS test above**: through the actual UI, an existing-pin match and
  a create-new-pin path succeed end-to-end, including the create-pin
  failure case's inline error; clicking "Load more" at least once against
  real PostgREST (the keyset `.or()` filter is the one part no
  mocked-client or the live RLS test — which doesn't exercise pagination
  — can validate); confirm the grid thumbnail transform actually returns
  a resized image (a direct request to a transformed URL, outside the
  app, before writing any UI code against it) and measure actual
  transferred bytes for a "Load more" page to confirm it's smaller than
  the originals; confirm a video card renders its `<video>` element
  without ever hitting the transform endpoint.

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

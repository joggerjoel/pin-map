# Unsorted-photo geo-triage panel

**Date:** 2026-08-25
**Status:** approved, not yet implemented
**Relation:** standalone. Builds on the `place_query is null` "unsorted"
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

## Design

### 1. RLS gap: no `UPDATE` policy

`schema_place_photos.sql` has `select`/`insert`/`delete` policies but no
`update` — nothing has ever needed to change a photo's `place_query` after
upload. Assigning a place to an unsorted photo is an UPDATE, so add, in a
new `supabase/schema_place_photos_update_policy.sql`:

```sql
create policy "pinmap_place_photos_update_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant update on public.pinmap_place_photos to authenticated;
```

Owner-only, matching the existing insert/delete policies — a signed-in
guest can already *view* the owner's photos (per the existing select
policy's `or user_id in (select user_id from public.pinmap_owner)` clause)
but can't modify them, and triage doesn't change that.

### 2. Repository: `src/lib/photosRepository.ts`

Add two functions alongside the existing `fetchPhotos`/`uploadPhoto`/
`deletePhoto`:

- `fetchUnsortedPhotos(userId, {limit, offset}): Promise<{photos: UnsortedPhoto[], totalCount: number}>`
  — `select *, count: "exact"` where `user_id = userId and place_query is
  null`, ordered by `created_at`, paginated with `.range(offset, offset +
  limit - 1)`. `UnsortedPhoto` is `PlacePhoto` with `placeQuery` dropped
  (there isn't one yet) and a derived `kind: "image" | "video"` from the
  `storage_path` extension (`.mp4`/`.mov`/`.webm` → video, everything else
  → image) — the DB doesn't store content-type, and this is the same
  information the import script already had via `subdir` but didn't
  persist, so re-deriving from the extension is simplest.
- `assignPhotoPlace(photoId, placeQuery): Promise<boolean>` — `update
  pinmap_place_photos set place_query = placeQuery where id = photoId`,
  returns whether it succeeded. No `userId` param needed — RLS already
  scopes the update to rows you own.

Both follow the existing functions' try/catch-and-return-empty-or-false
shape rather than throwing.

### 3. Hook: `src/hooks/useUnsortedPhotos.ts` (new)

Deliberately separate from `usePhotos` — that hook serves per-place
thumbnails for the signed-in user *or* the owner (read-only guest view);
triage is a self-only write action, so this hook only ever looks at
`userId`, never `ownerUserId`.

```ts
export interface UseUnsortedPhotosResult {
  photos: UnsortedPhoto[];
  totalCount: number;
  hasMore: boolean;
  loadMore: () => void;
  assign: (photo: UnsortedPhoto, placeQuery: string) => Promise<boolean>;
}
```

- Loads page 1 (60 photos) on mount when `userId` is non-null; `loadMore`
  fetches the next page and appends.
- `assign` calls `photosRepository.assignPhotoPlace`; on success, removes
  the photo from local `photos` state and decrements `totalCount`
  (optimistic — matches `removePhoto` in `usePhotos`). Returns the
  success bool so the calling component can show an inline error on
  failure instead of silently dropping it — unlike the app's other
  fire-and-forget writes, this is a deliberate one-off action the user is
  actively waiting on, so silent failure would just look broken.
- `userId === null` → empty photos, `totalCount: 0`, no fetch.

### 4. `pinPlace` gains a return value

`useGeocoder.ts`'s `pinPlace(query, tag)` is currently `Promise<void>` —
failures only surface via `setError`/`setFailedLines`, with no way for a
caller to know whether the pin actually ended up existing. The triage
panel's "create new pin" action needs that: it must call `assignPhotoPlace`
with the new pin's query *only if the pin now exists*.

Change the return type to `Promise<boolean>`: `true` if a pin now exists
for that query (just created, or already existed via the dedup
short-circuit), `false` on geocode failure or empty input. Existing
callers (`AddPin`'s `onAdd`) ignore the return value, so this is additive.

### 5. Component: `src/components/UnsortedPhotosPanel.tsx` (new)

```ts
export interface UnsortedPhotosPanelProps {
  photos: UseUnsortedPhotosResult; // from useUnsortedPhotos(userId), lifted to App — see §6
  pinnedPlaces: PinnedPlace[];
  onPinPlace: (query: string, tag: PinTag) => Promise<boolean>;
}
```

Takes the hook's result as a prop rather than calling `useUnsortedPhotos`
itself (see §6 for why it's instantiated at the `App` level). Renders:

- A grid of thumbnails, `loadMore` behind a "Load more (N remaining)"
  button below the grid (hidden once `hasMore` is false).
- Images: `<img>` pointed at the same public storage URL scheme
  `photosRepository` already builds. Videos: `<video preload="metadata"
  muted>` — the browser shows the first frame without fetching the whole
  file.
- Clicking a thumbnail expands an inline assign row beneath it: a text
  input filtering `pinnedPlaces` client-side (case-insensitive substring
  on `place.query`), showing up to 8 matches as buttons. Below the
  matches, a "Create new pin “{typed text}”" button (disabled when the
  input is empty) that calls `onPinPlace(text, DEFAULT_TAG)` — reusing
  `TagPicker`'s existing `DEFAULT_TAG` (same one `AddPin` starts with);
  the tag is editable afterward via `PlaceList`'s existing tag-edit UI,
  same reasoning the `future`-tag spec used for its own default color.
- Selecting a match or creating a new pin calls `assign(photo, query)`
  (after `onPinPlace` resolves `true`, for the create-new path). On
  `assign` failure, show a small inline error under that photo's row
  instead of removing it from the grid; the photo stays clickable to
  retry.
- Each expanded row is independent local state (`expandedPhotoId`,
  `assignError` keyed by photo id) — no shared/global error banner, so
  one failed assign doesn't affect the rest of the grid.

### 6. Wiring: `src/App.tsx`

Same conditional-swap pattern already used for
`effectiveToken !== null ? <AddPin/.../> : <p>...</p>`, not the full-view
swap `ImportsPanel` uses (`MapView` renders outside `<aside>`, so it's
untouched either way):

- New `showUnsortedPhotos` boolean state, default `false`.
- A header button next to the existing "Imports" button:
  `Unsorted ({totalCount})` — but only rendered once
  `photos.totalCount > 0`, so it quietly disappears once fully triaged
  rather than sitting there empty forever. Getting `totalCount` before
  the panel is open means calling `useUnsortedPhotos(userId)` at the
  `App` level (it's cheap — one paginated query on mount) and passing its
  result down, rather than instantiating the hook inside the panel.
- When `showUnsortedPhotos` is true, render `<UnsortedPhotosPanel>` in
  place of the `<AddPin>` / `<PlaceInput>` / `<PlaceList>` block inside
  `<aside>`. The same button's label switches to "Back to places" and its
  handler flips `showUnsortedPhotos` back to `false` — one button, two
  states, no separate close control.

## Testing

- `photosRepository.test.ts`: `fetchUnsortedPhotos` pagination + count,
  `kind` derivation from extension, `assignPhotoPlace` success/failure.
- `useUnsortedPhotos.test.ts`: initial load, `loadMore` appends and
  respects `hasMore`, `assign` removes on success and keeps-with-error on
  failure, `userId === null` short-circuits to empty.
- `useGeocoder.test.ts`: extend existing `pinPlace` tests to assert the
  resolved boolean for the success, dedup-short-circuit, and
  geocode-failure cases.
- `UnsortedPhotosPanel.test.tsx`: renders a page of thumbnails, video
  items render as `<video>`, "Load more" fetches the next page, typing in
  an expanded row filters matches, selecting a match assigns and removes
  the photo, "Create new pin" path calls `onPinPlace` then removes the
  photo, a failed assign shows the inline error and keeps the photo.
- Manual: triage a handful of the real imported photos against
  production, confirm both an existing-pin match and a create-new-pin
  path work end-to-end, same as this session's live-verification pattern
  for the login-notification feature.

## Out of scope

- Bulk/multi-select assignment (tag N photos to one place at once) — the
  approved goal is browse-and-cherry-pick, not full-backlog processing.
- Any EXIF/timestamp/location-based auto-suggestion of a place — Facebook
  strips that metadata, which is exactly why these are unsorted.
- Infinite scroll — a "Load more" button is simpler and sufficient at
  this scale (60/page over ~5,000 items).
- Deleting or bulk-archiving unsorted photos from this panel — out of
  scope for a first pass; existing per-place `deletePhoto` is unaffected
  and still available once a photo is assigned.

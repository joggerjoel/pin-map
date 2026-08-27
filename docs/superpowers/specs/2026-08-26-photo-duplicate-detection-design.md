# Photo duplicate detection

**Date:** 2026-08-26
**Status:** design approved, not yet implemented.
**Relation:** builds directly on the AI-tagging pipeline
(`ai-tagging-plan.md`, `scripts/backfill-photo-tags.ts`,
`scripts/lib/tagPhoto.ts`), which stores a `phash` on every image row
specifically so a later phase could add duplicate detection, but
deliberately left the Hamming-distance threshold and the detection
mechanism itself as an unbuilt "phase 2" decision (ai-tagging-plan.md,
"Duplicate/similarity comparison across the whole backlog").

## Problem

The ~8,037-photo backlog (and every photo tagged since) has a `phash`
column, but nothing reads it. Visually identical or near-identical
photos (re-uploads, re-saves, minor recompressions) sit in the backlog
indistinguishable from unique ones — there's no way to see or filter for
them in Browse, Groups, or anywhere else in the app.

## Scope

- **Near-identical, not just byte-exact**: two photos count as duplicates
  if their phashes are within a small Hamming distance, not only if the
  hashes are identical. This catches re-saves/recompression of the same
  shot; it is not meant to catch genuinely different photos of the same
  subject (e.g. burst shots), which is a similarity concern already
  covered separately by the embedding-based "more like this" feature
  (`schema_find_similar_photos.sql`).
- **`duplicate_of`, not a boolean flag**: a duplicate photo points at the
  id of its canonical (original) photo, so the UI can group copies under
  one original rather than just marking "this is a duplicate of
  _something_."
- **Both a one-time backfill and ongoing coverage**: the ~8,037 existing
  `tag_status = 'complete'` rows need a historical scan (they will never
  be reselected by the tagging backfill's `tag_status = 'pending'`
  query), and every photo tagged from now on needs the same check.
- **No cleanup/merge action.** This design only detects and surfaces
  duplicates. Deleting or merging duplicate photos is out of scope.

## Invariants

- `duplicate_of` only ever points at a photo where `duplicate_of is
null` (a true canonical) — never at another duplicate. This keeps
  "who is this a copy of" a single lookup, never a chain to walk.
- Within a set of mutually-duplicate photos, the **earliest-created**
  photo is always the canonical one. Detection always processes rows in
  `(created_at, id)` order, so an older photo is never retroactively
  marked as a duplicate of a newer one.
- `duplicate_checked_at` distinguishes "confirmed not a duplicate" from
  "not yet checked" — `duplicate_of is null` alone is ambiguous between
  those two states, and nothing in the UI or detection script may treat
  them as the same thing.
- Detection only ever compares photos belonging to the same `user_id`,
  matching the existing `find_similar_photos` RPC's scoping.
- Retuning the Hamming-distance threshold later does not retroactively
  recheck already-`duplicate_checked_at` rows — same stance this
  pipeline already takes on `pipeline_version` bumps (ai-tagging-plan.md,
  "Retagging after a taxonomy, model, or prompt change"). Not built
  speculatively now.

## Design

### 1. Schema: `duplicate_of` + `duplicate_checked_at`

New file `supabase/schema_place_photos_duplicate_of.sql`:

```sql
alter table public.pinmap_place_photos
  add column if not exists duplicate_of        uuid references public.pinmap_place_photos(id),
  add column if not exists duplicate_checked_at timestamptz;

alter table public.pinmap_place_photos
  add constraint pinmap_place_photos_duplicate_not_self_check
    check (duplicate_of is null or duplicate_of <> id);

create index if not exists pinmap_place_photos_duplicate_of_idx
  on public.pinmap_place_photos (duplicate_of)
  where duplicate_of is not null;

create index if not exists pinmap_place_photos_duplicate_unchecked_idx
  on public.pinmap_place_photos (created_at, id)
  where phash is not null and duplicate_checked_at is null;

grant select (duplicate_of) on public.pinmap_place_photos to authenticated;
```

`duplicate_checked_at` and `phash` itself stay server-only (no grant),
matching `phash`/`embedding`/`has_face`'s existing lockdown in
`schema_place_photos_ai_tags.sql` — the client only ever needs to know
_whether_ a photo is a duplicate and _of what_, never the raw hash.

The partial index on `(created_at, id) where phash is not null and
duplicate_checked_at is null` is the detection script's selection query,
mirroring `pinmap_place_photos_pending_idx`'s existing pattern for the
tagging backfill.

### 2. Detection: `scripts/backfill-photo-duplicates.ts`

A new script, structurally modeled on `backfill-photo-tags.ts` (file
lock via `acquireLock`/`releaseLock`, batch loop, safe to interrupt and
re-run — re-running after a full pass is a fast no-op since the
`duplicate_checked_at is null` selection returns nothing once every row
is checked).

Shared logic lives in `scripts/lib/duplicatePhoto.ts`:

```ts
export const DUPLICATE_HAMMING_THRESHOLD = 6; // out of 256 bits, ~2.3%

export function hammingDistance(a: string, b: string): number {
  // a, b are 64-hex-char phash strings (pinmap_place_photos_phash_format_check).
  // Compare as equal-length hex, XOR nibble-by-nibble, popcount the result.
}

export interface CanonicalCandidate {
  id: string;
  phash: string;
}

export function findDuplicateMatch(
  phash: string,
  canonicals: CanonicalCandidate[],
): string | null {
  // Returns the id of the closest canonical within DUPLICATE_HAMMING_THRESHOLD,
  // or null if none qualifies.
}
```

Script flow:

1. Acquire a dedicated lock file (separate path from the tagging
   backfill's lock — this script can run while that one is idle, e.g.
   invoked standalone for the historical pass).
2. Load the full canonical catalog once: `select id, user_id, phash from
pinmap_place_photos where duplicate_of is null and phash is not
null` — a few hundred KB for the whole backlog, per
   ai-tagging-plan.md's own sizing note. Partitioned client-side into a
   `Map<userId, CanonicalCandidate[]>`, since a row may only match
   another row with the same `user_id` (Invariants). Unlike the tagging
   backfill's own selection query, this one can't skip `user_id` — it's
   the partition key, not incidental.
3. Fetch unchecked rows in `(created_at, id)` order
   (`duplicate_checked_at is null and phash is not null`), including
   `user_id`, batch size matching the tagging backfill's `BATCH_SIZE`.
4. For each row: `findDuplicateMatch` against
   `catalog.get(row.user_id) ?? []`.
   - Match found → `update ... set duplicate_of = :matchId,
duplicate_checked_at = now() where id = :id and duplicate_checked_at
is null`.
   - No match → `update ... set duplicate_checked_at = now() where id =
:id and duplicate_checked_at is null`, then append `{id, phash}` to
     `catalog.get(row.user_id)` (creating the entry if this user had no
     prior canonicals) so later rows in the same run can match against
     it.
5. Loop until no unchecked rows remain (or interrupted).

**Not sharded.** Unlike `backfill-photo-tags.ts`, this script takes no
`--index`/`--of`. Two shards each maintaining their own in-memory
canonical catalog could both confirm two identical photos as canonical
at the same time, before either sees the other's write — a real
correctness gap, not just wasted work like the tagging backfill's
unsharded-multi-machine case. Sharding would need a coordination
mechanism (e.g. a serializing DB lock around the compare-and-write) that
isn't justified: this step is in-process Hamming-distance math, not an
Ollama round-trip, so there's no throughput reason to shard it in the
first place.

**Ongoing coverage without a second scheduled job**: `backfill-photo-
tags.ts`'s `main()` calls this script's exported run function once after
its own loop finishes, so `bun run scripts/backfill-photo-tags.ts`
remains the one command that fully processes new photos — tag, then
check for duplicates against the current catalog. The standalone script
entry point still exists for the one-time historical pass (and for
manually re-running after a deliberate threshold change).

### 3. Frontend

- `UnsortedPhoto` (`src/lib/photosRepository.ts`) gains `duplicateOf:
string | null`; every `select(...)` that builds this type adds
  `duplicate_of`.
- `PhotoGrid.tsx` renders a small "Duplicate" badge on any card where
  `duplicateOf !== null`. Shared by Browse and Groups, no change to
  selection or mass-action behavior.
- `BrowsePanel.tsx` gets a "Duplicates" filter chip alongside the
  existing `TAG_CHIPS`, following the same `tagFilter`/`"untagged"`
  pattern already there — selecting it restricts the query to
  `duplicate_of is not null`.

### 4. Edge cases

- A photo whose vision-tagging fails permanently (`tag_status =
'failed'`) never has a `phash` persisted today (`tagPhoto()` returns
  failure as a whole, discarding the already-computed hash), so it's
  excluded from both being checked and being a canonical candidate.
  Consistent with this pipeline's existing "failed is terminal" stance —
  not a new gap introduced by this feature.
- Videos (`tag_status = 'skipped'`, no `phash`) are naturally excluded
  by the `phash is not null` filter.
- A photo can be both a duplicate (`duplicate_of` set) and separately
  belong to a Group, or be assigned to a place — this feature doesn't
  interact with either.

## Testing

- `hammingDistance`: known hash pairs at distance 0, a small distance
  under threshold, and a large distance over threshold; equal-length
  input assumed (format already enforced by
  `pinmap_place_photos_phash_format_check`).
- `findDuplicateMatch`: empty catalog → null; single candidate within
  threshold → its id; single candidate over threshold → null; multiple
  candidates → the closest one, not just the first match.
- `backfill-photo-duplicates.ts`'s ordering/canonical-selection logic:
  a small in-memory scenario (three phashes, two within threshold of
  each other) asserting the earliest-created of the pair becomes
  canonical and the later one gets `duplicate_of` pointing at it, the
  same way `scripts/lib/tagPhoto.test.ts` tests `tagPhoto.ts`'s pure
  logic without hitting Ollama or Supabase.

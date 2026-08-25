# Pin Map — AI Photo Tagging Pipeline Plan

Companion to [idea.md](idea.md), [todo.md](todo.md), and
[docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md](docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md)
(the unsorted-photo triage panel this pipeline's output will eventually feed).

## Scope: pipeline only, no UI

This plan covers **computing and storing** three signals for every photo in
`pinmap_place_photos` — a perceptual hash, a semantic embedding, and a set of
tags (scene category + person-present) — via a local batch script. It
deliberately does **not** cover any panel UI (duplicate clustering, tag
filters, bulk-skip-by-category, similarity-based place suggestions). That's a
second plan, written after this pipeline has run against the real ~8,037-photo
backlog and produced output worth designing a UI around — building four UI
surfaces on top of untested model output would mean making UI decisions
before knowing whether the tags are even good. See "Decisions made during
brainstorming" below for the full reasoning.

## Implementation tracking

Every piece below has a same-named section in
[ai-tagging-todo.md](ai-tagging-todo.md):

| Plan section                          | Todo section                              |
| ------------------------------------- | ----------------------------------------- |
| Risk spike (validate before building) | "P0 — Spike: validate the risky unknowns" |
| Schema changes                        | "P0 — Schema"                             |
| Perceptual hash                       | "P1 — Perceptual hash"                    |
| Vision tagging + caption              | "P1 — Vision tagging"                     |
| Embedding                             | "P1 — Embedding"                          |
| Person detection                      | "P1 — Person detection"                   |
| Backfill script                       | "P1 — Backfill script"                    |
| Future-import wiring                  | "P2 — Wire into `import-mitm-photos.ts`"  |
| Edge cases                            | "P2 — Edge cases"                         |

If a future edit adds a piece to either doc without a matching row/section
here, that's the same defect recurring — update this table alongside the
change, not after.

## Decisions made during brainstorming

- **Vector store: pgvector in the existing self-hosted Supabase instance**,
  not a standalone ChromaDB service. No new stateful service to run, deploy,
  or back up — the embedding is just another column on the row it describes.
- **"Duplicate" means two things, computed separately**: a cheap perceptual
  hash (pHash) for near-identical shots (bursts, re-saves, re-exports), and
  the semantic embedding for "similar but not identical" (e.g. five photos
  from the same dinner). Neither substitutes for the other.
- **Runs as a backfill now, and gets wired into future imports** — not a
  one-time-only script. `import-mitm-photos.ts` already runs locally
  on-demand for each new capture batch; the tagging logic is factored into a
  shared module so a future import calls it per newly-inserted row instead
  of needing a separate manual backfill pass every time.
- **Ollama for both tagging and embeddings, face-api.js for person
  detection specifically** (explicit user choice, not a default) — see
  "Vision tagging" and "Person detection" below for how each is actually
  wired given what Ollama does and doesn't support natively.
- **Videos are out of scope for v1.** Vision models operate on static
  images; captioning a video means extracting a representative frame first,
  which is an independent piece of complexity. Video rows are left
  `tagged_at = null` (same "not yet processed" state as any row not yet
  reached), not silently skipped — a future pass can add frame extraction
  without a schema change.

## Architecture

### Schema changes

New columns on `pinmap_place_photos` (no RLS changes needed — same table,
same owner-scoped policies already in place; the batch script writes via the
service-role key exactly like `import-mitm-photos.ts` and
`seed-owner-places.ts` already do):

```sql
alter table public.pinmap_place_photos
  add column if not exists caption     text,          -- the vision model's one-paragraph description
  add column if not exists tags        text[],        -- e.g. {landscape,people}, from a fixed taxonomy (see below)
  add column if not exists has_person  boolean,        -- face-api.js signal, kept separate from `tags` since it's a distinct detector
  add column if not exists phash       text,           -- perceptual hash, hex string
  add column if not exists embedding   vector(768),    -- dimension: CONFIRM against the actual embedding model's output length before applying this migration (see Open Questions)
  add column if not exists tagged_at   timestamptz;    -- null = not yet processed; set once, atomically with the other columns, on success

create index if not exists pinmap_place_photos_untagged_idx
  on public.pinmap_place_photos (user_id, created_at)
  where tagged_at is null;
```

The embedding similarity index (`ivfflat` or `hnsw`, whichever the
self-hosted Postgres's pgvector version supports) is deliberately **not**
part of this migration — building a similarity index before there's a
meaningful volume of real embeddings in the table is premature, and which
index type is available depends on the installed pgvector version. Added
once the backfill has actually populated the column (see Open Questions).

`phash` is stored as plain text, not compared in SQL. Duplicate/similarity
clustering for the eventual UI will operate on whatever set of photos is
already loaded client-side (the triage panel already loads pages of up to 60
photos at a time — see the triage design's `useUnsortedPhotos` hook),
computing Hamming distance in JS. No Postgres-side hash-distance function is
needed for that access pattern, so none is built here.

### Perceptual hash

`blockhash-core` (pure JS, no native dependencies — matters because this
runs under Bun, and native `node-gyp` addons are a recurring source of
friction there, see "Person detection" below). Computed directly from the
downloaded image bytes; no external process, no Ollama involved. This is the
"near-identical" duplicate signal and needs no AI model.

### Vision tagging + caption

Ollama's `/api/generate` (or `/api/chat`) with a vision-capable model,
against a fixed prompt that asks for:

1. A one-paragraph natural-language caption.
2. Zero or more tags from a **fixed taxonomy**: `landscape`, `people`,
   `screenshot`, `document`, `food`, `animal`, `other`. A closed vocabulary,
   not free-form tags — keeps the eventual tag-filter UI (phase 2) simple
   and keeps model output parseable without relying on the model inventing
   consistent label spelling across 8,037 independent calls.

**Model choice: `moondream`** (~1.7GB) as the default, not `llama3.2-vision`
(~8GB) — moondream is purpose-built for fast captioning/classification, and
at 8,037 images, per-image latency directly determines whether this backfill
takes minutes or hours. `llama3.2-vision` is the documented fallback if
moondream's tag quality proves too poor on real photos during the P0 spike —
swapping the model name in one config constant, not a pipeline rewrite.

Response parsing asks the model to reply as JSON (`{"caption": "...", "tags":
[...]}`); a response that fails to parse as valid JSON, or names a tag
outside the fixed taxonomy, is treated as a failed attempt for that photo
(logged, `tagged_at` left null, picked up by the next run) rather than
guessed at or partially accepted.

### Embedding

Ollama does not have a first-class image-embedding model in general use —
its `/api/embeddings` endpoint is built for text-embedding models
(`nomic-embed-text`, `mxbai-embed-large`, etc.), not multi-modal ones. Rather
than reaching outside Ollama for a CLIP implementation, this pipeline uses a
**two-hop approach**: the vision model's caption text (already being
generated for tagging, above) is embedded with a dedicated Ollama text-embedding
model (**`nomic-embed-text`**, ~274MB). This keeps the entire pipeline on
Ollama as the user asked, at the cost of the embedding being _of the
caption_, not of the raw pixels — two photos will only cluster as "similar"
if the model described them similarly. That's an acceptable trade for this
use case (finding near-duplicate bursts/similar shots via a text-model
proxy), but it's a real, documented trade, not a hidden limitation.

### Person detection

**`face-api.js`**, per explicit request, kept as its own signal
(`has_person`) rather than folding "has a person" into the vision model's
`people` tag — a dedicated detector is more consistent than an LLM's
judgment call on borderline cases (a person barely visible in the
background, a statue, a photo of a photo).

**Real risk, flagged rather than glossed over**: `face-api.js` depends on
`@tensorflow/tfjs-node` and `canvas`, both native Node addons
(`node-gyp`-compiled). Bun's native-addon compatibility has historically been
inconsistent for exactly this kind of package. The P0 spike (below) tests
this directly before any other pipeline code is written. If it doesn't work
under Bun, the fallback is running just the face-detection step as a small
standalone **plain-Node** subprocess (invoked via `Bun.spawn`, communicating
over stdin/stdout as JSON) rather than dropping face-api.js — the rest of
the pipeline (hashing, Ollama calls, Supabase writes) stays in Bun either
way.

### Backfill script

`scripts/backfill-photo-tags.ts`, matching the existing `scripts/*.ts`
convention (`import-mitm-photos.ts`, `seed-owner-places.ts`,
`backfill-class-roster-living-coords.ts` — none of these have unit tests;
they're one-off/operator-run tools, not part of the app's TDD-covered
surface, and this follows the same convention).

- Selects rows via the `tagged_at is null` partial index, in batches (e.g.
  50 at a time) rather than loading all ~8,037 candidate rows into memory at
  once.
- For each row: download the image from Storage, compute the phash, call
  Ollama for caption+tags, embed the caption, run face-api.js, then write all
  five new columns **plus `tagged_at = now()`** back in a single `update` —
  partial success (e.g. phash computed but Ollama timed out) leaves
  `tagged_at` null so the row is retried next run, never half-written with a
  stale `tagged_at`.
- Logs progress (`N / 8037 processed, M failed`) — this is a long-running
  local process against real API/model calls, and needs to be resumable if
  interrupted, not just re-runnable from scratch.

### Future-import wiring

The per-photo tagging logic (hash + caption/tags + embedding + face
detection) is factored into a shared function
(`scripts/lib/tagPhoto.ts`), imported by both `backfill-photo-tags.ts` and
`import-mitm-photos.ts`. After `import-mitm-photos.ts` inserts a new row, it
calls the same function immediately — no separate mechanism (no DB trigger,
no cron, no webhook) needed, since both scripts already run locally on the
same machine that has Ollama installed. A future import that fails to tag a
photo for any reason still leaves the row with `tagged_at = null`, so a
later `backfill-photo-tags.ts` run naturally catches anything that was
missed at import time.

## Data flow

```
scripts/backfill-photo-tags.ts (or import-mitm-photos.ts, per-row)
  → select rows where tagged_at is null (batched)
  → for each row:
      download image bytes from Storage
      → blockhash-core: compute phash                      (no AI)
      → Ollama /api/generate (moondream): caption + tags     (local model call)
      → Ollama /api/embeddings (nomic-embed-text): embed caption
      → face-api.js (Bun, or Node subprocess fallback): has_person
      → update pinmap_place_photos set
          caption=..., tags=..., has_person=..., phash=...,
          embedding=..., tagged_at=now()
        where id = ...
  → log progress; failed rows keep tagged_at = null for the next run
```

## Error handling

- **Ollama unreachable / model not pulled**: fails the whole run immediately
  with a clear message (not a per-photo retry storm) — this is an
  environment problem, not a per-photo one.
- **A single photo's Ollama call times out or returns unparseable JSON**:
  logged, row left untagged, script continues to the next photo. Never
  guesses a tag or writes a caption the model didn't actually produce.
- **Image bytes fail to download or decode** (corrupt file, unsupported
  format): same treatment — logged, left untagged, script continues.
- **face-api.js finds zero faces**: a real, valid result (`has_person =
false`), not an error.

## Edge cases

- **Videos**: `tagged_at` stays null indefinitely for video rows in v1 (no
  vision model call attempted) — see "Videos are out of scope for v1" above.
  The backfill script's row-selection query does not need to distinguish
  images from videos itself; it's a documented limitation that a future pass
  (frame extraction) can lift without a schema change.
- **A photo already assigned to a place** (not just the unsorted backlog):
  this pipeline tags every row in `pinmap_place_photos`, assigned or not —
  tags/embeddings are useful for the "suggest a place from similar
  already-assigned photos" feature planned for phase 2, which specifically
  needs assigned photos to already have embeddings.
- **Re-running the backfill after tags already exist**: a no-op for already-
  tagged rows (`tagged_at is not null` excludes them from selection) —
  always safe to re-run, never re-processes or re-charges anything (nothing
  here costs money; everything is local).
- **Retagging after a taxonomy or model change**: not handled by this
  pipeline as designed (`tagged_at is not null` means "done," permanently,
  under the current design) — deliberately out of scope; if the tag
  taxonomy changes later, that's a new decision (e.g. a `tag_version`
  column) made at that time, not speculatively built now.

## Open Questions

Must be resolved by the P0 spike before the rest of the pipeline is built —
see `ai-tagging-todo.md`:

- **Embedding dimension**: `nomic-embed-text`'s actual output vector length
  must be confirmed directly (call `/api/embeddings` once, check
  `len(embedding)`) before the `vector(768)` column width in the migration
  is finalized — 768 is a reasonable expectation for this model family, not
  a confirmed fact.
- **face-api.js under Bun**: works directly, or needs the Node-subprocess
  fallback? Determines a real chunk of the Backfill script's shape.
- **moondream tag quality on real photos**: good enough, or does the
  pipeline need `llama3.2-vision` instead (slower, better)? Only answerable
  by looking at real output on a real sample.
- **Throughput**: how long does one photo actually take end-to-end (hash +
  Ollama caption + Ollama embed + face detection)? Determines whether the
  full 8,037-photo backfill is a 20-minute job or needs to run overnight —
  affects nothing about the design, but is worth knowing before kicking off
  the full run.
- **pgvector availability/version** on the self-hosted instance — determines
  whether `ivfflat` or `hnsw` is available for the similarity index added
  later (not part of this migration, but worth confirming early since it
  affects the phase-2 UI plan's feasibility).

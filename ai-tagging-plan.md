# Pin Map — AI Photo Tagging Pipeline Plan

Companion to [idea.md](idea.md), [todo.md](todo.md), and
[docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md](docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md)
(the unsorted-photo triage panel this pipeline's output will eventually feed).

**Revision note (2026-08-25):** a review of the first draft found three
blockers (an unbounded video-selection loop, no protection against a
permanently-failing row starving the whole queue, and an underspecified
image-decode step) plus five more material gaps (face-vs-person framing,
missing processing provenance, an unreviewed public-exposure change,
incomplete future-insert coverage, and undefined concurrency behavior). This
revision resolves all of them before any schema migration is written — see
each section below; nothing here has shipped yet.

## Scope: pipeline only, no UI

This plan covers **computing and storing** three signals for every _image_
row in `pinmap_place_photos` — a perceptual hash, a semantic embedding, and a
set of tags (scene category + face-present) — via a local batch script. It
deliberately does **not** cover any panel UI (duplicate clustering, tag
filters, bulk-skip-by-category, similarity-based place suggestions). That's a
second plan, written after this pipeline has run against the real ~8,037-photo
backlog and produced output worth designing a UI around.

## Implementation tracking

Every piece below has a same-named section in
[ai-tagging-todo.md](ai-tagging-todo.md):

| Plan section                          | Todo section                              |
| ------------------------------------- | ----------------------------------------- |
| Risk spike (validate before building) | "P0 — Spike: validate the risky unknowns" |
| Schema changes                        | "P0 — Schema"                             |
| Column-level exposure                 | "P0 — Column-level exposure review"       |
| Concurrency and ownership             | "P0 — Concurrency guard"                  |
| Perceptual hash                       | "P1 — Perceptual hash"                    |
| Vision tagging + caption              | "P1 — Vision tagging"                     |
| Embedding                             | "P1 — Embedding"                          |
| Face detection                        | "P1 — Face detection"                     |
| Backfill script                       | "P1 — Backfill script"                    |
| Automated tests                       | "P1 — Automated tests"                    |
| Future-insert coverage                | "P2 — Future-insert coverage"             |
| Edge cases                            | "P2 — Edge cases"                         |

If a future edit adds a piece to either doc without a matching row/section
here, that's the same defect recurring — update this table alongside the
change, not after.

## Decisions made during brainstorming

- **Vector store: pgvector in the existing self-hosted Supabase instance**,
  not a standalone ChromaDB service.
- **"Duplicate" means two things, computed separately**: a cheap perceptual
  hash (pHash) for near-identical shots, and the semantic embedding for
  "similar but not identical." Neither substitutes for the other.
- **Runs as a backfill now, and stays safe/cheap to re-run** so it also
  naturally covers photos the app itself inserts later (see "Future-insert
  coverage" — this changed from the first draft's "wire into
  `import-mitm-photos.ts` only" after review found that path misses the
  app's own upload flow).
- **Ollama for both tagging and embeddings, face-api.js for face
  detection specifically** (explicit user choice) — see "Vision tagging"
  and "Face detection" below.
- **Videos are excluded, deterministically, not left in limbo.** See
  "Processing status" below — this replaced the first draft's `tagged_at is
null` approach, which had no way to ever stop selecting video rows.

## Architecture

### Processing status (replaces the first draft's `tagged_at`-only design)

The first draft used a single nullable `tagged_at` as both "is this done"
and "when did it finish." Review correctly found two failures in that: video
rows can never leave the `null` state (every batch re-selects them forever,
"fast no-op after a successful pass" is false, and they can crowd out real
work), and a permanently-failing image (corrupt file, model consistently
returns unparseable output) is retried forever with no way to reach a
terminal state.

Replaced with an explicit status column plus attempt tracking:

- `tag_status text not null default 'pending'` — one of `pending`,
  `complete`, `skipped`, `failed`. Only `pending` rows are ever selected by
  the backfill script.
  - `skipped`: set immediately, once, for any row whose `media_type` isn't
    `'image'` — a **deliberate, terminal, non-error** state, distinct from
    `failed` so a log/report can tell "we chose not to process this" apart
    from "we tried and it broke."
  - `failed`: set once `tag_attempts >= MAX_ATTEMPTS` (default 3, a named
    constant). Terminal — excluded from future selection. Not silently
    retried forever, and not silently dropped either: `tag_last_error`
    records why, so a human can look at the failed set and decide whether to
    fix something and manually reset it back to `pending`.
  - `complete`: every one of `caption`, `tags`, `phash`, `embedding` is
    non-null and `tagged_at` is set. Enforced by a check constraint (below),
    not just application discipline.
- `tag_attempts integer not null default 0` — incremented on every failed
  attempt (not on success).
- `tag_last_error text` — nullable, the most recent failure's message.
- `tag_last_attempted_at timestamptz` — nullable, set on every attempt
  (success or failure), independent of `tagged_at` (which is only set on
  success).
- `media_type text not null` — `'image'` or `'video'`, determined once per
  row (see "Backfilling `media_type` for existing rows" below) and never
  recomputed.

Row selection for the backfill script becomes:

```sql
select id, storage_path from public.pinmap_place_photos
where tag_status = 'pending'
order by created_at asc, id asc
limit :batch_size;
```

Deterministic ordering (`created_at, id` — the same keyset idiom already
used by `fetchUnsortedPhotos` in `photosRepository.ts`) means two runs over
an unchanged table select rows in the same order, and a batch never silently
reorders around a row another process is touching.

### Schema changes

```sql
alter table public.pinmap_place_photos
  add column if not exists caption               text,
  add column if not exists tags                  text[],
  add column if not exists has_face               boolean,
  add column if not exists phash                  text,
  add column if not exists embedding              vector(768), -- CONFIRM dimension in the P0 spike before applying
  add column if not exists tagged_at              timestamptz,  -- set only on success, alongside tag_status = 'complete'
  add column if not exists media_type             text not null default 'image',
  add column if not exists tag_status             text not null default 'pending',
  add column if not exists tag_attempts           integer not null default 0,
  add column if not exists tag_last_error         text,
  add column if not exists tag_last_attempted_at  timestamptz,
  add column if not exists pipeline_version       integer;

alter table public.pinmap_place_photos
  add constraint pinmap_place_photos_media_type_check
    check (media_type in ('image', 'video')),
  add constraint pinmap_place_photos_tag_status_check
    check (tag_status in ('pending', 'complete', 'skipped', 'failed')),
  add constraint pinmap_place_photos_tags_taxonomy_check
    check (tags is null or tags <@ array[
      'landscape', 'people', 'screenshot', 'document', 'food', 'animal', 'other'
    ]),
  add constraint pinmap_place_photos_caption_nonblank_check
    check (caption is null or length(btrim(caption)) > 0),
  add constraint pinmap_place_photos_complete_implies_outputs_check
    check (
      tag_status <> 'complete'
      or (caption is not null and tags is not null and phash is not null
          and embedding is not null and tagged_at is not null
          and pipeline_version is not null)
    );

create index if not exists pinmap_place_photos_pending_idx
  on public.pinmap_place_photos (created_at, id)
  where tag_status = 'pending';
```

`phash`'s exact expected length (hex chars, derived from the bit-length
parameter chosen for `blockhash-core`) is confirmed in the P0 spike; a
`check (phash is null or phash ~ '^[0-9a-f]+$')`-style length constraint is
added once that number is known, not guessed here.

**Backfilling `media_type` for existing rows.** The ~8,037 already-imported
rows have no stored record of "image" vs. "video" — `import-mitm-photos.ts`
knew this at import time (`subdir: "images" | "videos"`) but discarded it.
Going forward, the importer stores it directly (see "Future-insert
coverage"). For the existing backlog, a one-time backfill statement infers
it from the file extension, the same way the client already does
(`kindFromStoragePath` in `photosRepository.ts`) — but that function's
`VIDEO_EXTENSIONS` set (`mp4`, `mov`, `webm`) was written for whatever the
_client_ has actually encountered, not verified against what
`import-mitm-photos.ts` actually wrote to Storage. Before running the
backfill UPDATE, the P0 spike checks the real distinct extensions in
`storage_path` and confirms the list is complete — an unmatched extension
must not silently default to `'image'` and get sent to a vision model that
will choke on it.

```sql
update public.pinmap_place_photos
set media_type = case
    when storage_path ~* '\.(mp4|mov|webm)$' then 'video'  -- confirm this list in the spike
    else 'image'
  end,
  tag_status = case
    when storage_path ~* '\.(mp4|mov|webm)$' then 'skipped'
    else tag_status
  end
where media_type is null or media_type = 'image'; -- run once, immediately after the column-add migration
```

This is what makes "a full successful pass is a fast no-op on re-run"
actually true: video rows land in `tag_status = 'skipped'` once, and the
`where tag_status = 'pending'` selection never sees them again.

### Column-level exposure (new — resolves a real privacy gap the first draft missed)

`pinmap_place_photos` is **already publicly readable**: `schema_place_photos.sql`
grants bare `select` to `anon`, and the table's RLS `select` policy allows
`user_id in (select user_id from public.pinmap_owner)` — meaning _anyone,
unauthenticated_, can already read every row belonging to the map's owner,
by design (`idea.md` describes the Personal Travel Map as public). Today
that means an anonymous caller can see `storage_path`/`created_at` for every
one of the ~8,037 still-unsorted photos — not very revealing on its own (a
hash-derived filename).

Adding `caption` (a natural-language description) and `embedding` (a
semantic vector enabling similarity/search over the whole backlog) to that
same publicly-selectable table is a materially different exposure: it would
let anyone build a searchable description of the owner's entire private,
not-yet-triaged photo backlog — screenshots, documents, people, whatever's
actually in there — from the public internet, unauthenticated. That's not
something to inherit by default from the existing broad grant.

**Fix: explicit column-level privileges, no RLS policy change needed.**
Every current client read of this table already selects specific columns,
not `select("*")` — confirmed directly
([photosRepository.ts:53](src/lib/photosRepository.ts:53),
[:117](src/lib/photosRepository.ts:117),
[:139](src/lib/photosRepository.ts:139),
[:190](src/lib/photosRepository.ts:190)) — so tightening the grant to
exactly those columns changes nothing about what the app already does:

```sql
revoke select on public.pinmap_place_photos from anon, authenticated;
grant select (id, user_id, place_query, storage_path, created_at)
  on public.pinmap_place_photos to anon, authenticated;
```

Every new column (`caption`, `tags`, `has_face`, `phash`, `embedding`,
`tagged_at`, `media_type`, `tag_status`, `tag_attempts`, `tag_last_error`,
`tag_last_attempted_at`, `pipeline_version`) is **server-only** — readable
only via the service-role key, which bypasses grants and RLS entirely (the
same key the batch script already uses to write). Nothing client-side reads
any of them yet, since there's no UI in this plan's scope. When phase 2
needs a specific column exposed (e.g. `tags` for a filter bar), that's a
deliberate, scoped grant made at that time — not something carried over
from before this pipeline existed. Raw `embedding` vectors in particular are
not expected to ever need direct table-level client exposure; a future
similarity search should go through a `security definer` RPC that returns
matches, not the vectors themselves.

### Concurrency and ownership (new)

This is a manually-run local script, but nothing currently stops two
instances from running at once (e.g. started twice by accident) and racing
each other over the same rows.

- **Primary guard: a Postgres advisory lock**, taken at script start
  (`select pg_try_advisory_lock(:fixed_key)`). If it's already held, the
  script logs "another instance is already running" and exits immediately
  — simplest correct fix for a single-operator tool, no lease/heartbeat
  machinery needed.
- **Defense in depth: every write is conditional.** The final per-row update
  is `where id = :id and tag_status = 'pending'`, checking the affected-row
  count is exactly 1. If a row was somehow already claimed and completed by
  another process (advisory lock notwithstanding — e.g. a stale lock from a
  killed process), the second writer's update affects zero rows and is
  treated as "someone else finished this one," not an error.

### Processing provenance (new — `pipeline_version`)

Per review: an Ollama model tagged `:latest`, a prompt wording change, a
face-detector weight update, or a phash bit-length change can each silently
produce results incompatible with rows tagged before the change, with
nothing recording that a row's `caption`/`tags`/`embedding` came from a
different pipeline than another row's. A single integer column is enough —
this does not need to become a retagging system:

- `pipeline_version integer`, set on every successful write, alongside the
  other outputs (part of the "`complete` implies all outputs present"
  constraint above).
- **What `pipeline_version = 1` means** (recorded here, in prose, not in the
  database): the exact Ollama model tag/digest for vision tagging, the exact
  Ollama model tag/digest for embedding, the exact face-api.js model-weight
  file commit/checksum, the exact prompt text (or a hash of it), and the
  exact `blockhash-core` bit-length parameter — each confirmed and filled in
  by the P0 spike (see Open Questions) once the actual models are pulled and
  the actual weight files are committed. If any of those five things change
  later, that's `pipeline_version = 2`, made as a deliberate decision at that
  time (bump the constant, decide whether to reset existing rows to
  `pending`), not built as machinery now.
- Model tags: pull with an explicit version tag where the model publishes
  one (not floating `:latest`), and record the digest `ollama list` reports
  for whatever's actually pulled.

### Perceptual hash

`blockhash-core` operates on **decoded pixel data** (width, height, RGBA
buffer), not raw file bytes — the first draft understated this. Decoding is
done with **`sharp`** (built on libvips):

```ts
const { data, info } = await sharp(imageBytes)
  .rotate() // EXIF-orientation-normalize BEFORE hashing, or visually-identical
  // photos with different orientation tags hash differently
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// blockhash-core consumes { data, width: info.width, height: info.height }
```

- **Format support**: JPEG/PNG/WebP/GIF via `sharp`/libvips reliably.
  **HEIC is a real open question** — libvips' HEIC support depends on build
  flags, and this is a personal iPhone photo backlog where HEIC is plausibly
  common. The P0 spike tests a real HEIC file from the actual backlog before
  this is assumed to work; if it doesn't, the fallback is a dedicated HEIC
  decode step (e.g. `heic-convert`) before handing bytes to `sharp`, not a
  silent skip.
- **Animated images**: first frame only (`sharp`'s default when `{animated:
true}` is not passed) — documented behavior, not an oversight.
- **Size limits**: `sharp`'s default pixel-count ceiling
  (`limitInputPixels`) is left in place rather than raised, and files above
  a configured byte-size cap (e.g. 50MB) are treated as a failed attempt
  (logged, `tag_attempts` incremented) rather than decoded — prevents one
  unusually large file from spiking memory use mid-batch.
- **Hash encoding**: a fixed bit-length parameter (recommended: 16, giving a
  256-bit/64-hex-char hash — enough discriminative power for near-duplicate
  detection without an excessive column width), confirmed in the spike and
  recorded in the `pipeline_version = 1` definition above. The Hamming-
  distance threshold used to actually call two hashes "duplicates" is a
  phase-2 UI decision, not fixed here — this pipeline's job is only to
  produce a comparable hash for every row.

### Vision tagging + caption

Ollama's `/api/generate` (or `/api/chat`) with a vision-capable model,
against a fixed prompt asking for JSON: `{"caption": "...", "tags":
[...]}`.

- **Taxonomy is fixed and closed**: `landscape`, `people`, `screenshot`,
  `document`, `food`, `animal`, `other`. `other` is **exclusive** — if it
  appears, no other tag may also appear, forcing the model to make a real
  categorization choice rather than hedging. **Zero tags is invalid** — the
  model must always return at least one tag (falling back to `other` if
  nothing else fits); an empty `tags` array is treated as a parse failure,
  same as malformed JSON.
- A response that fails to parse as JSON, includes a tag outside the
  taxonomy, includes `other` alongside another tag, or returns an empty tag
  list, is a **failed attempt**: `tag_attempts` incremented,
  `tag_last_error` recorded, `tag_last_attempted_at` set, `tag_status` left
  `pending` (or flipped to `failed` if this was the last allowed attempt).
- `has_face` (from face detection, below) is an **independent signal** from
  the `people` tag — no consistency is enforced between them. They answer
  different questions (a scene classifier's judgment vs. a face detector's),
  and a photo can legitimately have `people: true, has_face: false` (people
  visible but turned away) or the reverse (a face in a screenshot of a video
  call).

**Model choice**: `moondream` (~1.7GB) as the default over `llama3.2-vision`
(~8GB), for per-image latency across 8,037 images. `llama3.2-vision` is the
documented fallback if moondream's tag quality is insufficient. **This is no
longer a subjective "eyeball ~10 photos" call**: the P0 spike hand-labels a
fixed sample of 20 real photos (spanning the taxonomy) once, as ground
truth, and requires the chosen model to match that ground truth on at least
17 of 20 (85%) before it's accepted — a measurable acceptance gate, not a
vibe check.

### Embedding

Ollama has no first-class image-embedding model in general use — its
`/api/embeddings` endpoint targets text-embedding models. This pipeline
uses a **two-hop approach**: the caption text (already produced above) is
embedded with **`nomic-embed-text`** (~274MB). The embedding is _of the
caption_, not the raw pixels — two photos only cluster as "similar" if the
model described them similarly. A real, documented trade-off, not a hidden
limitation.

### Face detection

Renamed from the first draft's `has_person` to **`has_face`**, because
that's what it actually measures: `face-api.js` detects visible faces, not
people — it misses a person facing away or otherwise faceless-in-frame, and
can register a false positive on a face in a poster, screenshot, or TV in
the photo. Documented meaning: `has_face = true` means "at least one
face-like region was detected by face-api.js's TinyFaceDetector"; nothing
stronger should ever be inferred from it downstream.

**Model provisioning, versioned**: face-api.js's model weight files
(manifest JSON + shard `.bin` files for `TinyFaceDetector` — the smallest
model, sufficient for a binary presence check, not the larger
`SsdMobilenetv1`) are **not** fetched by `npm`/`bun install` — they're
static files from face-api.js's own repository. They're committed directly
into this repo (`scripts/lib/face-models/`, a few MB), with their source
commit/release and a checksum recorded in the `pipeline_version = 1`
definition — pinned and checksummed, not fetched fresh from a third-party
URL on every environment setup.

**Real risk, tested first**: `face-api.js` depends on `@tensorflow/tfjs-node`
and `canvas`, both native `node-gyp`-compiled addons — Bun's native-addon
compatibility has historically been inconsistent for exactly this kind of
package. The P0 spike tests this directly before any other pipeline code is
written. If it doesn't work under Bun, the fallback is running just the
face-detection step as a small standalone **plain-Node** subprocess
(`Bun.spawn`, JSON over stdin/stdout) — the rest of the pipeline stays in
Bun either way.

### Backfill script

`scripts/backfill-photo-tags.ts`. Unlike the first draft's assumption, this
is **not** exempt from the project's TDD convention once its logic is
shared with an ongoing-import path (see "Future-insert coverage" and
"Automated tests" below) — the "one-off scripts have no tests" precedent
(`import-mitm-photos.ts` et al.) applies to scripts that are genuinely
one-shot; this one is re-run repeatedly and its core logic is imported
elsewhere.

- Takes the advisory lock; exits immediately if already held.
- Selects `tag_status = 'pending'` rows, ordered `(created_at, id)`, in
  batches (e.g. 50), not all ~8,037 candidates at once.
- Per row: decode + hash, call Ollama for caption/tags (one immediate retry
  with a short backoff on a transient network/timeout error before counting
  it as a failed attempt), embed the caption, run face detection, then
  either:
  - **success**: one conditional `update ... where id = :id and tag_status
= 'pending' set caption=..., tags=..., has_face=..., phash=...,
embedding=..., tagged_at=now(), tag_status='complete',
pipeline_version=:version, tag_last_attempted_at=now()`.
  - **failure**: `update ... where id = :id set tag_attempts =
tag_attempts + 1, tag_last_error = :error, tag_last_attempted_at =
now(), tag_status = case when tag_attempts + 1 >= :max_attempts then
'failed' else 'pending' end`.
- Configurable constants: `BATCH_SIZE`, `MAX_ATTEMPTS` (default 3),
  `OLLAMA_TIMEOUT_MS`, `MAX_IMAGE_BYTES`, `CONCURRENCY` (default 1 —
  Ollama typically serializes inference on one loaded model instance, so
  parallelism mostly benefits the download/hash/DB-write portions; raised
  later only if the spike shows real throughput gain from
  `OLLAMA_NUM_PARALLEL`).
- Handles `SIGINT` by logging a clean stop message and not starting a new
  row — no special partial-write cleanup is needed, because every write is
  already a single atomic per-row update; a row interrupted mid-processing
  (before its update) simply stays `pending`.
- Logs progress (`N processed, M failed, K skipped, T remaining`).

### Automated tests

Reversed from the first draft. Once `tagPhoto.ts`'s logic is shared with an
ongoing insertion path, it needs the coverage this project's TDD convention
already expects elsewhere:

- Response parsing: valid JSON accepted; malformed JSON, an out-of-taxonomy
  tag, `other` alongside another tag, and an empty tag array are all
  rejected as failed attempts.
- Deterministic hashing: the same image bytes produce the same phash twice.
- Attempt/status transitions: a failing row increments `tag_attempts` and
  eventually reaches `failed` at `MAX_ATTEMPTS`, never retried past it by
  the selection query.
- The conditional update: a row already flipped to `complete`/`failed` by a
  concurrent writer is not overwritten by a second writer's stale attempt.
- `media_type` inference against the real extension set found during the
  spike.

### Future-insert coverage (revised — the first draft's gap)

The first draft only wired `import-mitm-photos.ts`. Review correctly found
a second, more commonly-used insertion path: the app's own
`uploadPhoto()` (`photosRepository.ts:71`), used whenever the owner attaches
a photo directly to a pin from the browser. That code runs client-side, in
a visitor's browser — it has no access to a locally-run Ollama instance and
never will, so "call the tagging function synchronously from the client
insert" is not an available option for that path.

**Resolution**: the backfill script is the actual coverage mechanism for
_all_ insertion paths, not just MITM imports — because row selection is
driven by `tag_status = 'pending'` (the default for every new row,
regardless of which code path inserted it), simply re-running
`backfill-photo-tags.ts` periodically (manually, or later via a scheduled
task — not part of this plan) picks up anything inserted since the last
run, MITM-imported or uploaded through the app. `import-mitm-photos.ts` is
still updated to record `media_type` directly at insert time (it already
knows `subdir`) and to call the shared `tagPhoto.ts` function per newly
inserted row as a **latency optimization** for that specific path (so a
freshly-imported batch doesn't have to wait for the next manual backfill
run) — but it is no longer the sole mechanism the design depends on for
correctness. `import-mitm-photos.ts`'s insert also gains `.select("id")`
(currently discarded, per review) since the per-row call needs the new
row's id.

## Data flow

```
scripts/backfill-photo-tags.ts
  → take advisory lock (exit if already held)
  → select id, storage_path where tag_status = 'pending'
      order by created_at, id limit :batch_size
  → for each row:
      download image bytes from Storage
      → sharp: decode + EXIF-normalize + raw pixel buffer
      → blockhash-core: compute phash from pixel buffer          (no AI)
      → Ollama /api/generate (moondream): caption + tags          (1 retry on transient error)
      → Ollama /api/embeddings (nomic-embed-text): embed caption
      → face-api.js (Bun, or Node subprocess fallback): has_face
      → success: single conditional UPDATE (all outputs + tag_status='complete' + pipeline_version)
      → failure: single UPDATE (tag_attempts += 1, tag_last_error, tag_status maybe 'failed')
  → log progress; loop until no pending rows remain in this run
```

## Error handling

- **Ollama unreachable / model not pulled**: fails the whole run
  immediately with a clear message — an environment problem, not a
  per-photo one.
- **A single photo's Ollama call times out or returns unparseable/invalid
  JSON**: one immediate retry with backoff; if that also fails, counted as
  a failed attempt (see "Processing status").
- **Image bytes fail to download, decode, or exceed the size cap**: same
  treatment.
- **face-api.js finds zero faces**: a real, valid result (`has_face =
false`), not an error.
- **A row reaches `MAX_ATTEMPTS`**: `tag_status = 'failed'`, excluded from
  future selection, visible via `tag_last_error` for manual investigation
  and reset if warranted.

## Edge cases

- **Videos**: `tag_status = 'skipped'` set once (backfill UPDATE for
  existing rows; `media_type = 'video'` set directly at insert time for new
  MITM imports), never selected again.
- **A photo already assigned to a place**: tagged the same as unsorted
  photos — assigned photos need embeddings too, for the phase-2
  similar-photo place-suggestion feature.
- **Re-running the backfill after a full successful pass**: genuinely a
  fast no-op — the `tag_status = 'pending'` selection returns nothing once
  every image row is `complete`/`failed` and every video row is `skipped`.
- **Retagging after a taxonomy, model, or prompt change**: not handled
  automatically — bump `pipeline_version` and make a deliberate decision at
  that time about whether/how to reset affected rows to `pending`. Not
  built speculatively now.
- **Duplicate/similarity comparison across the whole backlog (not just one
  loaded UI page)**: this pipeline stores `phash` and `embedding`
  specifically so phase 2 can implement real cross-backlog clustering (e.g.
  loading all ~8,037 short phash strings at once for client-side Hamming
  comparison — a few hundred KB, unlike the photos themselves — or a
  server-side RPC). The exact mechanism is a phase-2 UI decision; this
  pipeline does not assume or bake in "only compare photos within one
  loaded page."

## Open Questions

Must be resolved by the P0 spike before schema/code is written — see
`ai-tagging-todo.md`:

- **Embedding dimension** — confirm `nomic-embed-text`'s actual output
  length.
- **face-api.js under Bun** — works directly, or needs the Node-subprocess
  fallback?
- **moondream tag quality** — measured against the 20-photo labeled sample,
  ≥85% match, or fall back to `llama3.2-vision`?
- **Real file-extension set** in the existing backlog's `storage_path`
  values, for the `media_type` backfill regex — not assumed from the
  client's `VIDEO_EXTENSIONS` list without checking.
- **HEIC support** in the local `sharp`/libvips build, tested against a
  real HEIC file from the backlog if one exists.
- **phash bit-length** to standardize on (recommended: 16 / 256-bit /
  64 hex chars).
- **Exact Ollama model digests, face-api.js weight-file commit/checksum,
  and prompt text** — recorded as the `pipeline_version = 1` definition.
- **Throughput** — one photo's real end-to-end time, extrapolated to
  8,037, so the full run isn't a surprise.
- **pgvector version** on the self-hosted instance — determines `ivfflat`
  vs. `hnsw` availability for a similarity index added later (not part of
  this migration).

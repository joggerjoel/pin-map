# Pin Map — AI Photo Tagging Pipeline Plan

Companion to [idea.md](idea.md), [todo.md](todo.md), and
[docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md](docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md)
(the unsorted-photo triage panel this pipeline's output will eventually feed).

**Revision note (2026-08-25, review pass):** a review of the first draft
found three blockers (an unbounded video-selection loop, no protection
against a permanently-failing row starving the whole queue, and an
underspecified image-decode step) plus five more material gaps
(face-vs-person framing, missing processing provenance, an unreviewed
public-exposure change, incomplete future-insert coverage, and undefined
concurrency behavior). This revision resolved all of them before any
schema migration was written.

**Revision note (2026-08-25, P0 spike):** the plan's original model
choice (`moondream`, fallback `llama3.2-vision`) was tested against real
backlog photos and **neither worked** — see "Vision tagging + caption"
below. `llava` (not originally considered) is the accepted replacement,
with two real fixes applied (prompt tightening, lenient tag sanitization).
Face detection needed two fixes of its own (dropping
`@tensorflow/tfjs-node`, decoding via `sharp` instead of `canvas`'s
WebP-incapable loader) before it worked at all. Every "Open Questions"
item below is now resolved except pgvector's installed version, which is
blocked on network access to the production host.

**Revision note (2026-08-25, P0+P1 build):** the schema migration
(`supabase/schema_place_photos_ai_tags.sql`), `scripts/lib/tagPhoto.ts`,
`scripts/lib/fileLock.ts`, `scripts/backfill-photo-tags.ts`, and the
`import-mitm-photos.ts` wiring are all written, and everything reachable
without production network access has been verified for real — not just
typechecked: the migration and its RPC against a throwaway local
`pgvector/pgvector:pg16` container, `tagPhoto()` end-to-end against real
Ollama and real backlog photos, 28 automated tests, a clean `bun run
build`. One real design correction surfaced only by actually building it:
the planned Postgres advisory lock doesn't work through PostgREST's
pooled connections — replaced with a local file lock (see "Concurrency and
ownership").

**Revision note (2026-08-25, shipped to production):** network access to
`aorus4` was restored later the same day. The migration is now **applied
to the live instance** (`UPDATE 8039`, matching the real row count
exactly), pgvector confirmed at `0.8.0`, and the backfill script has
**actually tagged real production photos** (19, in a short supervised
run, plus one real transient failure that correctly stayed `pending` for
retry) — see "Still open" below for the one thing deliberately not done
yet (the full unattended run over the whole backlog). Ollama itself also
moved off the original build machine to a better-resourced one (Mac
Studio) reachable over Tailscale — see the "Ops update" note under
"Vision tagging + caption" below.

**Revision note (2026-08-27, GPU sharding + bug-fix pass):** an 8-lens
council review of this doc set against the shipped code found real
doc/code drift plus several correctness bugs, and the decision was made to
run the next backfill sharded across two real machines — aorus (GPU) and
Mac Studio (CPU) — rather than Mac Studio alone. Shipped in this pass:
`pipeline_version` bumped to 2 (closing an overdue bump for the already-
shipped face-api.js → `@vladmandic/face-api` swap); a real GPU backend for
face detection on aorus via `@vladmandic/face-api`'s separate
`dist/face-api.node-gpu.js` build (see "GPU acceleration on aorus" in
macstudio-backfill-spec.md — the earlier "needs bundle-patching or
subprocess isolation" conclusion there was wrong); `--index`/hardcoded
`SHARD_OF` two-way sharding; a genuine Ollama-outage now aborts the run
instead of burning `tag_attempts` (`OllamaUnavailableError`); the
documented-but-not-implemented invalid-JSON retry now actually happens; a
`--limit` flag for safe small-batch verification; a Storage-download
timeout; a second-`SIGINT` fix; a `record_photo_tag_failure` write-failure
gap closed; and a `search_path` hardening fix matching the pattern already
used by `find_similar_photos`. See "Error handling", "Face detection",
"Processing provenance", and "Backfill script" below for the specifics.
Deliberately **not** addressed in this pass (real findings, not
load-bearing for this specific rollout): the processing queue has no
owner/tenant scoping (a separate, broader auth/RLS fix); `fileLock.ts`'s
stale-reclaim race (only reachable by two processes on the _same_ machine,
which this topology never does); several lower-severity doc-accuracy and
provenance gaps (ground-truth dataset never committed, `:latest` Ollama tag
drift never verified at runtime, etc.).

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

| Plan section                             | Todo section                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| Risk spike (validate before building)    | "P0 — Spike: validate the risky unknowns"                  |
| Schema changes                           | "P0 — Schema"                                              |
| Column-level exposure                    | "P0 — Column-level exposure review"                        |
| Concurrency and ownership                | "P0 — Concurrency guard"                                   |
| Processing status                        | "P0 — Schema"                                              |
| Processing provenance (pipeline_version) | "P0 — GPU sharding + bug-fix pass"                         |
| Perceptual hash                          | "P1 — Perceptual hash"                                     |
| Vision tagging + caption                 | "P1 — Vision tagging"                                      |
| Embedding                                | "P1 — Embedding"                                           |
| Face detection                           | "P1 — Face detection", "P0 — GPU sharding + bug-fix pass"  |
| Backfill script                          | "P1 — Backfill script", "P0 — GPU sharding + bug-fix pass" |
| Error handling                           | "P0 — GPU sharding + bug-fix pass"                         |
| Automated tests                          | "P1 — Automated tests"                                     |
| Future-insert coverage                   | "P2 — Future-insert coverage"                              |
| Edge cases                               | "P2 — Edge cases"                                          |

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

### Concurrency and ownership (new; revised again during the P1 build)

This is a manually-run local script, but nothing currently stops two
instances from running at once (e.g. started twice by accident) and racing
each other over the same rows.

**Revised design — a Postgres advisory lock doesn't actually work here.**
The original plan called for `pg_try_advisory_lock` at script start. Found
while building `scripts/backfill-photo-tags.ts`, not while planning it:
this script only ever talks to Postgres through PostgREST/`supabase-js`,
which pools connections across separate HTTP requests. A session-scoped
advisory lock acquired via one `.rpc()` call has no guarantee of surviving
to the _next_ `.rpc()` call minutes later in the same script run — each
request can land on a different pooled connection, and the lock could be
silently released (or never meaningfully held at all) well before the
script's actual work is done. This isn't a hypothetical: it's exactly how
PostgREST's connection model works, and would have made the "starting the
script twice exits the second instance immediately" acceptance criterion
untestable in the way originally described.

- **Primary guard: a local file lock**
  (`scripts/lib/fileLock.ts`), not a database lock — the correct fit for
  what this actually is: a single-machine, single-operator, manually-run
  tool, not a distributed-coordination problem. Atomically creates a lock
  file (`fs.openSync(path, "wx")`, fails if it already exists) containing
  the holding process's PID. A second instance sees the existing file,
  checks whether that PID is still alive (`process.kill(pid, 0)`), and
  exits immediately if so. If the recorded process is dead (a crash left a
  stale lock), the lock is reclaimed automatically rather than blocking
  forever.
- **Defense in depth: every write is still conditional**, independent of
  the lock. The success-path update and the failure-path RPC (see
  "Backfill script" below) are both scoped `where id = :id and tag_status
= 'pending'`. If a row was somehow already claimed by another process (a
  stale lock reclaimed incorrectly, or manual `psql` interference), the
  second writer's update/RPC call affects zero rows and is treated as
  "someone else already handled this one," not an error — verified
  directly against a real Postgres instance, not assumed (see "P0 —
  Concurrency guard" in `ai-tagging-todo.md`).

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
- **Revision note (2026-08-27): bumped to `pipeline_version = 2`.** The
  face-api.js → `@vladmandic/face-api` swap (see "Face detection" below)
  shipped with different weight files and was never versioned at the time —
  a real trigger under this section's own rule, closed retroactively. The
  19 rows already tagged in production before this bump predate the swap
  entirely (they were tagged under the original face-api.js), so they're
  unambiguously `pipeline_version = 1` regardless of when this bump landed.
  **Adding a GPU backend for face detection (`FACE_DETECTOR_BACKEND=gpu` on
  aorus) does NOT get its own version bump** — CPU and GPU execute the
  identical `TinyFaceDetector` weights through the identical op graph, a
  compute-backend detail rather than a model change, and `has_face` isn't
  even surfaced in the UI yet (phase 2, not built).
- **What `pipeline_version = 1` meant, confirmed by the P0 spike:**
  - Vision tagging: `llava:latest`, Ollama digest `8dd30f6b0cb1` (~4.7GB).
    Pulled as `:latest` since `llava` doesn't publish a distinct stable
    version tag on Ollama's library beyond size variants (`7b`/`13b`/`34b`,
    of which `latest` resolves to `7b`) — the **digest**, not the tag, is
    what's actually recorded as the pin; if `:latest` moves later the
    digest will differ from this record and that's the detectable signal
    to bump this version, not a false sense of stability from the tag name
    alone.
  - Embedding: `nomic-embed-text:latest`, Ollama digest `0a109f422b47`
    (~274MB, 768-dimension output — confirmed, see "Embedding" below).
  - Face detection: face-api.js `TinyFaceDetector`, weights pinned to
    commit `3c3c83d03338c8de7e3d23999ae29f5634db210c` of
    `justadudewhohacks/face-api.js` (see "Face detection" below for
    checksums).
  - Prompt text: the tightened vision-tagging prompt in "Vision tagging +
    caption" below (the one that eliminated hallucinated
    screenshot/document/food tags on real outdoor photos) — verbatim, not a
    paraphrase; a future prompt edit is a `pipeline_version` bump.
  - `blockhash-core` bit-length: 16 (256-bit / 64-hex-char hash).
- **What changed in `pipeline_version = 2`:** only face detection. Vision
  tagging, embedding, prompt text, and phash bit-length are all unchanged
  from `pipeline_version = 1` above.
  - Face detection: `@vladmandic/face-api`'s `TinyFaceDetector`
    (`@vladmandic/face-api@1.7.15`), replacing the original,
    unmaintained `face-api.js` — see "Face detection" below for why (a
    real crash, not a preference). Weight files also changed: this fork's
    own `tiny_face_detector_model.bin` +
    `tiny_face_detector_model-weights_manifest.json` (different filenames
    than the original `-shard1`/`-weights_manifest.json` pair), committed
    to `scripts/lib/face-models/`.
  - CPU vs. GPU execution (`FACE_DETECTOR_BACKEND`) is explicitly **not**
    part of this definition — see the revision note above.
  - If a future change alters the vision model, embedding model, prompt,
    phash bit-length, or the face-detection weights again, that's
    `pipeline_version = 3`, made as a deliberate decision at that time
    (bump the constant, decide whether to reset existing rows to
    `pending`), not built as machinery now.

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

- **Format support**: JPEG/PNG/WebP/GIF via `sharp`/libvips reliably —
  **confirmed against the real backlog**, not assumed. A full scan of all
  8,039 rows' `storage_path` extensions (via the public REST API, paginated)
  found: `webp` 7,804, `png` 108, `jpg` 81, `gif` 2, `mp4` 44 — no `.heic`
  anywhere, and no `.mov`/`.webm` either. **HEIC support is moot for this
  backlog** (no HEIC-decode fallback needed for v1); the `media_type`
  extension regex (`mp4|mov|webm`) is confirmed correct against real data.
- **WebP decoding is not just a `sharp` concern — it's a pipeline-wide
  requirement.** The spike found `sharp` is the _only_ thing in this stack
  that reliably decodes WebP: neither `node-canvas` (used for face
  detection, below) nor Ollama's own vision-model image ingestion can
  decode WebP directly (`node-canvas.loadImage()` throws "Unsupported image
  type"; Ollama's `/api/generate` with an image returns `400 Failed to load
image or audio file`) — both confirmed by direct reproduction against
  real backlog photos, which are 97% WebP. **Every downstream consumer of
  an image (face detection, vision tagging) must receive bytes already
  decoded/re-encoded by `sharp` (e.g. `.png().toBuffer()`), never the raw
  file bytes.** This is now a hard architectural rule for the whole
  pipeline, not an implementation detail of the phash step alone.
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

Ollama's `/api/generate` with a vision-capable model, against a fixed
prompt asking for JSON: `{"caption": "...", "tags": [...]}`.

**Model choice, decided by the P0 spike against 20 real, hand-labeled
backlog photos — not the plan's original guess.** `moondream` (the
original default) and `llama3.2-vision` (the original documented fallback)
were both tried first and are **not viable**:

- `moondream` (loads fine) produces garbage under Ollama's `format: "json"`
  mode — 14 of 20 responses came back as the literal string `"<tag>"`
  repeated ~200 times instead of real tags (70% invalid-output rate,
  reproduced twice, including on a freshly-restarted, uncontended server).
  Without `format: "json"`, it's worse: 17 of 20 responses were empty, and
  two devolved into raw object-detection bounding-box coordinates
  (`[0.17, 0.17, 0.83, 0.32]`) instead of the requested text — a leak from
  moondream's separate object-detection mode. Neither prompting style
  produces usable output reliably; this is a capability limit of the
  1.8B model on this multi-part instruction, not a prompt-format problem.
- `llama3.2-vision` fails to load entirely — `error loading model: unknown
model architecture: 'mllama'` — reproduced on both the stale Ollama
  server this machine had running (0.32.7, via a separate, non-Homebrew
  `Ollama.app` install that was silently holding port 11434 — see the Ops
  Note below) and the current Homebrew-updated one (0.32.15). This
  specific Ollama build's engine doesn't support the `mllama` architecture
  Llama 3.2 Vision uses; not something to keep debugging mid-pipeline-build.

**Chosen: `llava`** (~4.1GB) — the only one of three local models tried
that reliably produces valid JSON with sensible captions across all 20 real
photos. Two real, measured problems needed fixing before it clears the bar:

1. It didn't respect "`other` may only appear alone" (paired `other` with
   real tags on ~45-60% of responses depending on prompt wording) and
   occasionally invented a word outside the taxonomy (e.g. `"skateboards"`,
   `"cityscape"`, `"forest"`). **Fix: lenient sanitization, not strict
   rejection** — a response is only a failed attempt if, after (a) dropping
   any tag not in the fixed taxonomy and (b) dropping `other` specifically
   when it's combined with another tag, the resulting tag list is empty.
   This is a deliberate change from the plan's first draft (which rejected
   the whole response on any taxonomy/exclusivity violation) — the model's
   own core content judgment (landscape/people/etc.) was consistently
   correct even when it ignored the `other`-exclusivity instruction, so
   discarding the whole caption+tags over one disobeyed formatting rule
   would throw away good data and inflate the retry/failure rate for no
   benefit.
2. An initial pass on a permissive prompt genuinely hallucinated content —
   e.g. tagging a plain outdoor road-cyclist photo `["people", "screenshot",
"document"]`, or a cyclist photo with all seven taxonomy tags at once.
   **Fixed by prompt tightening**, not sanitization: an explicit "look ONLY
   at what is literally visible... a real outdoor photo is virtually never
   'screenshot'/'document'/'food'/'animal' unless unmistakably present"
   instruction eliminated this category of hallucination entirely across
   the same 20-photo sample in the retest — zero occurrences of a
   `screenshot`/`document`/`food` tag on a photo that obviously wasn't one,
   versus several in the untightened prompt.

**Measured result** (20-photo ground truth, `llava` + tightened prompt +
lenient sanitization): 15/20 (75%) clearly match ground truth outright; 3
more are defensible-but-debatable on a genuine edge case (a hand-drawn
cartoon/illustration of a runner, tagged `people`+`landscape` — arguably
correct, arguably not "real" people/landscape content) rather than a clear
model error. That's short of the plan's original 85% bar taken strictly, or
just at 90% (18/20) if the illustration edge case is counted as acceptable.
**Accepted as good enough to proceed**, given: this is a measurable,
specific gap (one ambiguous content category, not scattered random
failures), the alternatives are a non-loading model and two non-loading/
non-viable ones, and — per "Duplicate/similarity comparison" in Edge
Cases — nothing downstream depends on tag _perfection_, only on tags being
a reasonable filter/browse aid. If real-world use of the tagged backlog
later shows the illustration/cartoon case matters, an `illustration` tag
can be added to the taxonomy at that point (a `pipeline_version` bump), not
solved speculatively now.

- **Taxonomy is fixed and closed**: `landscape`, `people`, `screenshot`,
  `document`, `food`, `animal`, `other`. **Zero tags is invalid** — the
  model must always return at least one tag; an empty `tags` array (after
  sanitization, see above) is treated as a parse failure, same as malformed
  JSON.
- A response that fails to parse as JSON, or has an empty tag list _after_
  sanitization, is a **failed attempt**: `tag_attempts` incremented,
  `tag_last_error` recorded, `tag_last_attempted_at` set, `tag_status` left
  `pending` (or flipped to `failed` if this was the last allowed attempt).
- `has_face` (from face detection, below) is an **independent signal** from
  the `people` tag — no consistency is enforced between them.

**Ops note (not part of the pipeline itself, but a real trap hit during the
spike)**: this machine (the MacBook Pro this pipeline was built on) had
_two_ separate Ollama installations — a Homebrew formula and a completely
separate `Ollama.app` (macOS menu-bar app) with its own bundled,
independently-versioned server binary. The `Ollama.app` instance was
silently holding port 11434 with a stale 0.32.7 server while Homebrew's
formula had already updated to 0.32.15, and `brew upgrade`/
`brew services restart` has no effect on the `Ollama.app` instance at all.
Anyone hitting this again needs `Ollama.app` fully quit (not just the
menu-bar icon dismissed — check `ps aux | grep ollama` for
`/Applications/Ollama.app/...` processes) before assuming the Homebrew
binary's version is what's actually serving requests.

**Ops update (2026-08-25): Ollama moved off this machine entirely, to
Mac Studio.** Running multi-GB vision models locally on a laptop that also
needs to do other things was the wrong long-term call once a
better-resourced machine with Ollama already running was available.
`llava` and `nomic-embed-text` are pulled on `JoggerJoels-Mac-Studio`,
reachable directly over Tailscale (no SSH tunnel needed — Ollama's server
there already accepts connections on its Tailscale interface, not just
`127.0.0.1`) at its stable Tailscale IP `100.69.192.40:11434` — confirmed
reachable for both `/api/version` and a real `/api/embeddings` call
(768-dimension response, matching what was measured locally). Configured
via `OLLAMA_BASE_URL` in `pin-map/.env` (already an env-overridable
constant in `tagPhoto.ts`, defaulting to `http://localhost:11434` when
unset — no code change needed, just configuration). The local Ollama
service on the MacBook Pro (`brew services stop ollama`) is stopped; this
pipeline no longer needs Ollama installed locally at all, only network
access to wherever `OLLAMA_BASE_URL` points. If Mac Studio's Tailscale IP
ever changes, `tailscale status` reports the current one (its stable-IP
guarantee is per-node for the life of that node, not permanent across a
full reinstall).

### Embedding

Ollama has no first-class image-embedding model in general use — its
`/api/embeddings` endpoint targets text-embedding models. This pipeline
uses a **two-hop approach**: the caption text (already produced above) is
embedded with **`nomic-embed-text`** (~274MB). The embedding is _of the
caption_, not the raw pixels — two photos only cluster as "similar" if the
model described them similarly. A real, documented trade-off, not a hidden
limitation.

**Confirmed by the P0 spike, not assumed**: `nomic-embed-text`'s actual
output vector length is **768** (matches the plan's original placeholder —
no schema change needed). Sanity check passed: two captions describing
similar mountain-trail scenes scored 0.65 cosine similarity; a mountain
scene against an unrelated screenshot-of-a-text-message caption scored
0.49 — directionally correct (similar > different), confirming the
embedding captures real semantic signal, not noise.

### Face detection

Renamed from the first draft's `has_person` to **`has_face`**, because
that's what it actually measures: the face detector detects visible faces,
not people — it misses a person facing away or otherwise faceless-in-frame,
and can register a false positive on a face in a poster, screenshot, or TV
in the photo. Documented meaning: `has_face = true` means "at least one
face-like region was detected by the pinned TinyFaceDetector"; nothing
stronger should ever be inferred from it downstream.

**Revision note (2026-08-26/27): `face-api.js` replaced with
`@vladmandic/face-api`, and a GPU backend added for aorus.** See "Face
detection library swap" and "GPU acceleration on aorus" in
`macstudio-backfill-spec.md` for the full story (a real crash found and
fixed, not a preference) and `pipeline_version = 2`'s definition above for
what changed. Summary: `scripts/lib/tagPhoto.ts`'s `loadFaceApi()` lazily
picks between `@vladmandic/face-api`'s default Node build (plain CPU, via
`@tensorflow/tfjs-node`) and its separate `dist/face-api.node-gpu.js`
build (via `@tensorflow/tfjs-node-gpu`, an `optionalDependency`) based on
the `FACE_DETECTOR_BACKEND` env var — `"gpu"` on aorus, unset (CPU)
everywhere else. Same API surface either way
(`faceapi.nets.tinyFaceDetector`, `detectAllFaces`,
`TinyFaceDetectorOptions`), so `detectFace()` itself didn't need to change,
only how the module gets loaded.

**Model provisioning, versioned**: the face detector's model weight files
(manifest JSON + a `.bin` shard for `TinyFaceDetector` — the smallest
model, sufficient for a binary presence check, not the larger
`SsdMobilenetv1`) are **not** fetched by `npm`/`bun install` — they're
static files committed directly into this repo
(`scripts/lib/face-models/`).

**Superseded (2026-08-26): these are now `@vladmandic/face-api`'s own
weight files, not the original `justadudewhohacks/face-api.js` ones below.**
File*names* changed too (`.bin` instead of `-shard1`) as part of the
library swap described in "Face detection" above — re-verify and record
fresh checksums for the files actually committed today before relying on
the values below, which describe the pre-swap files only, kept for
historical context:

Original (pre-swap) pin, `justadudewhohacks/face-api.js` commit
`3c3c83d03338c8de7e3d23999ae29f5634db210c`, checksummed:
`tiny_face_detector_model-shard1` sha256
`b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871`;
`tiny_face_detector_model-weights_manifest.json` sha256
`14c60659a31b6b7b1320077171b8f8adcb24ef0e62dde62ce603bcb49a1b49b5`.

**Real risk, tested — and a real fix needed, not a clean pass.**
`face-api.js` + `canvas` (for the `Canvas`/`Image`/`ImageData` polyfills it
needs) **do work under Bun**, but not without two fixes found by the spike:

1. `@tensorflow/tfjs-node`'s native **"node" backend is incompatible with
   `face-api.js@0.22.2`** — importing it makes `detectAllFaces()` throw
   `TypeError: forwardFunc_1 is not a function` inside face-api.js's
   `normalize` op (reproduced directly). face-api.js hasn't been updated in
   years and its bundled op registration doesn't match tfjs-core 4.22's
   kernel API under that backend. **Resolution: don't depend on
   `@tensorflow/tfjs-node` at all.** face-api.js's own bundled
   `@tensorflow/tfjs` (pure JS, zero native compilation) provides the plain
   `cpu` backend by default, and that backend works correctly — confirmed
   against 25 real backlog photos, ~0.4s/photo after model-load warmup
   (11.2s total for 25 images including warmup), acceptable for a secondary
   signal at 8,037-photo scale. Dropping `@tensorflow/tfjs-node` also
   removes its own separate native-build risk (it needed a manual
   `node-pre-gyp install --fallback-to-build` invocation to compile at all
   in this environment — see below) for zero functional loss.
2. **`node-canvas` cannot decode WebP** (confirmed: `loadImage()` throws
   `Unsupported image type` on a real WebP backlog photo) — the same
   limitation documented under "Perceptual hash" above. **Resolution: never
   call `canvas.loadImage()` on raw file bytes.** Decode via `sharp` first
   (`.rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true})` —
   the exact same call already used for the phash step, reusable as-is),
   then construct the `canvas` `ImageData` from that raw pixel buffer via
   `ctx.createImageData()` + `imageData.data.set(rawBytes)` +
   `ctx.putImageData()`. `sharp` becomes the pipeline's single image
   decoder; `canvas` is only ever used as an in-memory polyfill target, never
   to open a file.

**Native-addon build risk, real but resolvable**: `canvas`'s own
`node-gyp` compile step failed on the first `bun add` attempt in this
environment — a transient network timeout fetching Node headers from
`nodejs.org` (not a fundamental incompatibility; confirmed by success on
a plain retry moments later, once the same URL became reachable again).
Whoever provisions this pipeline on a fresh machine should expect to retry
`bun install` at least once if `canvas`'s compile step fails, rather than
assume a hard blocker on the first failure.

### Backfill script

`scripts/backfill-photo-tags.ts`. Unlike the first draft's assumption, this
is **not** exempt from the project's TDD convention once its logic is
shared with an ongoing-import path (see "Future-insert coverage" and
"Automated tests" below) — the "one-off scripts have no tests" precedent
(`import-mitm-photos.ts` et al.) applies to scripts that are genuinely
one-shot; this one is re-run repeatedly and its core logic is imported
elsewhere.

Built as designed, with two corrections found during the build (both
already reflected in "Concurrency and ownership" above and the schema
migration):

- Takes the local file lock (not a Postgres advisory lock — see
  "Concurrency and ownership"); exits immediately if already held.
- Selects `tag_status = 'pending'` rows, ordered `(created_at, id)`, in
  batches of 50, not all ~8,037 candidates at once.
- Per row: download from Storage, then `tagPhoto()` (decode + hash, call
  Ollama for caption/tags with one immediate retry on a transient
  network/timeout error, run face detection, embed the caption), then
  `applyTagResult()` — a function shared with `import-mitm-photos.ts`, not
  duplicated logic — which does either:
  - **success**: one conditional `update ... where id = :id and tag_status
= 'pending' set caption=..., tags=..., has_face=..., phash=...,
embedding=..., tagged_at=now(), tag_status='complete',
pipeline_version=:version`, via plain PostgREST (no arithmetic needed).
  - **failure**: the `record_photo_tag_failure(photo_id, error,
max_attempts)` RPC (added to the schema migration during the build —
    `tag_attempts = tag_attempts + 1` isn't expressible as a plain
    PostgREST update, and a client-side read-then-increment-then-write
    would reintroduce exactly the race the conditional-update design
    exists to prevent). Restricted to `service_role` only.
- Named constants (not environment-variable-configurable — hardcoded in
  one place, which is sufficient for a manually-run single-operator
  script): `BATCH_SIZE` (50), `MAX_ATTEMPTS` (3, exported from
  `tagPhoto.ts` as `DEFAULT_MAX_ATTEMPTS` so both scripts share the same
  default), `OLLAMA_TIMEOUT_MS` (60s), `MAX_IMAGE_BYTES` (50MB).
  `CONCURRENCY` has no constant at all — the script is straightforwardly
  sequential, satisfying "default 1" without an unused knob controlling a
  parallel code path that doesn't exist.
- Handles `SIGINT` by logging a clean stop message and not starting a new
  row — no special partial-write cleanup needed, because every write is
  already a single atomic per-row operation; a row interrupted
  mid-processing (before its update/RPC call) simply stays `pending`. A
  **second** `SIGINT` exits immediately (`process.exit(130)`) rather than
  waiting for the current row — revision note (2026-08-27): previously a
  second Ctrl+C was a silent no-op, contradicting its own code comment
  ("let the default handler kill it"), because registering a `SIGINT`
  listener suppresses Node's default terminate-on-signal behavior for
  every subsequent signal, not just the first.
- Logs progress after every row (`N processed (M complete, K failed)`).
- **Revision note (2026-08-27): multi-machine sharding, `--limit`, and a
  Storage-download timeout, all shipped.** `--index=N` (paired with a
  hardcoded `SHARD_OF = 2` source constant, not a `--of` flag — see
  macstudio-backfill-spec.md, "Preventing double-processing") splits the
  pending queue with no overlap across aorus and Mac Studio.
  `--limit=N` stops the run after N rows, for testing a shard against a
  handful of real photos before an unattended full run.
  `supabase.storage.from(BUCKET).download(...)` is now wrapped in the same
  timeout pattern already used for Ollama calls — previously unbounded,
  unlike every other network call in this pipeline.

### Automated tests

Reversed from the first draft. Once `tagPhoto.ts`'s logic is shared with an
ongoing insertion path, it needs the coverage this project's TDD convention
already expects elsewhere. **Built**: `scripts/lib/tagPhoto.test.ts` (22
tests) and `scripts/lib/fileLock.test.ts` (6 tests), 28 total, all passing.

- Response parsing: valid JSON accepted; malformed JSON, an out-of-taxonomy
  tag, `other` alongside another tag, and an empty tag array are all
  rejected as failed attempts. **Covered.**
- Deterministic hashing: the same image bytes produce the same phash
  twice. **Covered**, plus a real EXIF-orientation test (dynamically
  generated fixtures — an image hashed unrotated, physically rotated 90°,
  and EXIF-tagged-but-not-physically-rotated — confirming the last two
  match and the first differs), which is stronger than what this section
  originally asked for.
- Attempt/status transitions and the conditional-update guarantee: verified
  directly against a real Postgres instance via
  `record_photo_tag_failure`, not as a mocked-client unit test — see "P0 —
  Schema" and "P0 — Concurrency guard" in `ai-tagging-todo.md` for the
  exact sequence run and its output. A genuine scope trade-off, not an
  oversight: this exercises the actual constraint/RPC rather than a mock
  standing in for it, but isn't part of the repeatable `bun run test`
  suite the way the other items are.
- `media_type` inference against the real extension set found during the
  spike. **Covered**, including the `.mov`/`.webm` cases that don't
  actually appear in the real backlog but are kept as a safe superset.

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
run, MITM-imported or uploaded through the app. **Built**:
`import-mitm-photos.ts` records `media_type` directly at insert time (from
its already-known `subdir`, setting `tag_status = 'skipped'` immediately
for videos rather than leaving them `pending`) and calls the shared
`tagPhoto()` + `applyTagResult()` functions per newly inserted **image**
row as a latency optimization for that specific path — but it is no longer
the sole mechanism the design depends on for correctness. Its insert also
gained `.select("id").single()` since the per-row tagging call needs the
new row's id.

## Data flow

```
scripts/backfill-photo-tags.ts
  → acquire local file lock (exit if already held by a live process)
  → select id, storage_path where tag_status = 'pending'
      order by created_at, id limit :batch_size
  → for each row:
      download image bytes from Storage
      → tagPhoto():
          sharp: decode + EXIF-normalize + raw pixel buffer     -- the ONE decoder
          → blockhash-core: compute phash from pixel buffer          (no AI)
          → canvas ImageData from the same pixel buffer (putImageData, not loadImage)
          → @vladmandic/face-api, cpu or gpu backend (FACE_DETECTOR_BACKEND): has_face
          → sharp: re-encode the same pixel buffer as PNG (for Ollama, which also can't read WebP)
          → Ollama /api/generate (llava, tightened prompt): caption + tags   (1 retry on transient error)
          → sanitize tags: drop non-taxonomy words, drop 'other' if combined with real tags
          → Ollama /api/embeddings (nomic-embed-text): embed caption
      → applyTagResult():
          success: plain conditional UPDATE (all outputs + tag_status='complete' + pipeline_version)
          failure: record_photo_tag_failure(id, error, max_attempts) RPC
                   (atomic tag_attempts += 1, tag_status maybe -> 'failed')
  → log progress; loop until no pending rows remain in this run
```

## Error handling

- **Ollama unreachable / model not pulled**: fails the whole run
  immediately with a clear message — an environment problem, not a
  per-photo one. **Revision note (2026-08-27): this is now actually true,
  not just documented intent.** `fetchWithTimeout()` (shared by
  `ollamaGenerate`/`embedCaption`) throws a distinguishable
  `OllamaUnavailableError` on a genuine connectivity failure (connection
  refused, DNS failure, our own abort-on-timeout — not a non-2xx HTTP
  response, which stays a per-photo failure); `tagPhoto()`'s catch
  re-throws it instead of swallowing it into `{ok: false}`, and
  `backfill-photo-tags.ts`'s existing `main().catch(...) → process.exit(1)`
  aborts the run. Previously a total outage was caught by `tagPhoto()`'s
  blanket catch and recorded as an ordinary per-photo failure, burning
  `tag_attempts` across every row it touched instead of aborting.
- **A single photo's Ollama call times out or returns unparseable/invalid
  JSON**: one immediate retry with backoff; if that also fails, counted as
  a failed attempt (see "Processing status"). **Revision note
  (2026-08-27):** previously only a network/timeout throw got this retry —
  a response that parsed as invalid/empty JSON was never retried, despite
  this section's own documented contract. Fixed: `generateCaptionAndTags`
  now shares one retry budget across both failure modes (network error OR
  invalid JSON), not two stacked retries.
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

### Resolved by the P0 spike (2026-08-25)

- **Embedding dimension**: 768, confirmed directly. No schema change from
  the plan's original placeholder.
- **face-api.js under Bun**: works directly (plain `cpu` backend) — but
  needed two real fixes, not zero: dropping `@tensorflow/tfjs-node`
  entirely (incompatible with face-api.js@0.22.2) and never calling
  `canvas.loadImage()` on raw bytes (can't decode WebP) — see "Face
  detection" above. The Node-subprocess fallback described in the first
  draft was **not needed**.
- **Vision model choice**: neither original candidate worked (`moondream`:
  unreliable structured output in both JSON and free-text modes;
  `llama3.2-vision`: won't load, `mllama` architecture unsupported by this
  Ollama build). `llava` + a tightened prompt + lenient tag sanitization is
  the accepted choice — see "Vision tagging + caption" above for the full
  measured result (75-90% match against the 20-photo ground truth,
  depending on how one illustration/cartoon edge case is scored).
- **Real file-extension set**: confirmed via a full scan of all 8,039
  backlog rows — `webp` 7804, `png` 108, `jpg` 81, `gif` 2, `mp4` 44. No
  `.heic`, `.mov`, or `.webm`.
- **HEIC support**: moot — zero HEIC files in the real backlog. No decode
  fallback needed for v1.
- **phash bit-length**: 16 (256-bit / 64-hex-char).
- **Exact Ollama model digests, face-api.js weight-file commit/checksum,
  and prompt text**: recorded in the `pipeline_version = 1` definition
  above.
- **Throughput (partial)**: face detection alone is ~0.4s/photo after
  warmup. Full per-photo, end-to-end (download + decode + hash + `llava`
  caption/tag call + embedding + face detection) timing across the whole
  8,037-photo backlog was **not** separately measured — see below.

### Resolved once production access was restored (2026-08-25)

- **pgvector version**: `0.8.0` — confirmed directly against the live
  instance. New enough for `hnsw`.
- **Migration applied to production**: `UPDATE 8039` (exact real row
  count). Post-migration: `image/pending` 7995, `video/skipped` 44 —
  exactly matching the spike's extension scan.
- **The full pipeline ran against real data**: `backfill-photo-tags.ts`
  tagged 19 real photos successfully (spot-checked output — real
  captions, correct taxonomy tags, correct `has_face`, 64-char `phash`)
  and correctly logged one real transient failure (`tag_attempts=1`,
  still `pending`, will retry next run) before being interrupted with
  `SIGINT`, which behaved exactly as designed.

### Still open — not yet resolved

- **Full end-to-end per-photo throughput at the complete-backlog scale**:
  the short supervised run above gives real per-photo timing, but running
  the entire ~7,995-image backlog to completion is a multi-hour
  unattended operation — deliberately not started without an explicit
  go-ahead (see `ai-tagging-todo.md`, "P1 — Backfill script").
- **Together.ai as a vision-tagging alternative**: investigated at the
  user's suggestion as a fallback "for when we don't have Ollama." The
  account's `TOGETHER_API_KEY` works for serverless text models (confirmed
  against `meta-llama/Llama-3.3-70B-Instruct-Turbo`) but **no vision model
  is enabled for serverless inference on this account** — every vision
  model tried (`meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo`,
  `Qwen/Qwen2.5-VL-72B-Instruct`, `Qwen/Qwen3-VL-8B-Instruct`) returned
  `model_not_available`, requiring a paid dedicated endpoint deployment
  instead. Not pursued further without an explicit cost decision from the
  user. Given `llava` locally already clears a workable bar, this is now a
  **future upgrade path** (better tag quality, no local compute/Ollama
  dependency) rather than a blocker — worth revisiting if a dedicated
  endpoint's cost is acceptable, or if a future Together account tier adds
  serverless vision access.

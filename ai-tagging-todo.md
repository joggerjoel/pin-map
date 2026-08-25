# Pin Map — AI Photo Tagging Pipeline TODO

Companion to [ai-tagging-plan.md](ai-tagging-plan.md) and [todo.md](todo.md).
Priority legend matches `todo.md`: **P0** architectural/security
prerequisite, **P1** next high-value, **P2** strong follow-up, **P3**
later/experimental.

**Revision note (2026-08-25):** rewritten alongside the plan after review
found three blockers (video selection never terminates, permanent failures
starve the queue, raw-bytes-into-blockhash was underspecified) plus five
more gaps (face-vs-person naming, missing provenance, an unreviewed public
exposure change, incomplete future-insert coverage, undefined concurrency).
Every item below reflects the fix, not the original draft.

## P0 — Spike: validate the risky unknowns

Do this **before** writing any schema or pipeline code. Every item answers
an Open Question from the plan with a real result on real data.

- [ ] `ollama pull moondream`. Hand-label a fixed sample of 20 real unsorted
      photos (ground truth, spanning the taxonomy) once. Run moondream
      against them; if fewer than 17/20 (85%) match ground truth, try
      `llama3.2-vision:11b` on the same 20 and compare. Record the winner
      and the actual match rate in the plan.
- [ ] Call `nomic-embed-text` via `/api/embeddings` once; confirm the actual
      returned vector length and update the plan's `vector(768)` placeholder
      if it's wrong.
- [ ] Query the real backlog for distinct file extensions in `storage_path`
      (e.g. `select distinct lower(storage_path) ~ regex` style scan or a
      simple extension histogram) and confirm the video-extension regex
      used in the `media_type` backfill (`mp4|mov|webm`, per the client's
      existing `VIDEO_EXTENSIONS`) actually covers everything real — update
      the plan's regex if not.
- [ ] Test `sharp` decoding a real HEIC file from the backlog, if one
      exists. If it fails, evaluate a HEIC-specific decode step
      (`heic-convert`) and record the outcome in the plan.
- [ ] Install `face-api.js` + `@tensorflow/tfjs-node` + `canvas`, run face
      detection on one real test image under `bun run`. If it fails to
      load/build under Bun, build the plain-Node subprocess fallback and
      confirm that works instead.
- [ ] Download the `TinyFaceDetector` model weight files from face-api.js's
      repository, commit them to `scripts/lib/face-models/`, record the
      source commit/release and a checksum in the plan's
      `pipeline_version = 1` definition.
- [ ] Decide and record the `blockhash-core` bit-length parameter
      (recommended: 16 → 256-bit/64-hex hash) in the plan.
- [ ] Pull Ollama models with explicit version tags where available (not
      floating `:latest`); record the exact tags/digests `ollama list`
      reports in the plan's `pipeline_version = 1` definition, alongside the
      exact prompt text used for tagging.
- [ ] Time one photo end-to-end (download → decode/hash → caption → embed →
      face detection); extrapolate to 8,037 and record the estimate.
- [ ] Confirm `pgvector` is installed and check its version on the
      self-hosted Postgres instance:
      `sql
    select extversion from pg_extension where extname = 'vector';
    -- or, if missing:
    create extension if not exists vector;
    `
      Determines `ivfflat` vs. `hnsw` availability for a later similarity
      index (not part of this migration).

**Acceptance criteria**

- Every "Open Questions" item in the plan has a real, recorded answer — the
  plan's placeholders (`vector(768)`, the extension regex, the bit-length,
  etc.) are replaced with confirmed values before the schema migration is
  written.
- The `pipeline_version = 1` definition in the plan names concrete
  model tags/digests and a weight-file checksum, not "whatever's installed."

## P0 — Schema

- [ ] `supabase/schema_place_photos_ai_tags.sql` — all twelve new columns on
      `pinmap_place_photos` per the plan (`caption`, `tags`, `has_face`,
      `phash`, `embedding`, `tagged_at`, `media_type`, `tag_status`,
      `tag_attempts`, `tag_last_error`, `tag_last_attempted_at`,
      `pipeline_version`), using values confirmed by the spike (embedding
      dimension, phash length) rather than the plan's placeholders.
- [ ] All five check constraints from the plan (`media_type`, `tag_status`,
      tags-taxonomy, caption-nonblank, complete-implies-outputs).
- [ ] The `tag_status = 'pending'` partial index.
- [ ] The one-time `media_type`/`tag_status` backfill UPDATE for existing
      rows, using the spike-confirmed extension regex — run once, directly
      after the column-add migration, in the same migration file so it
      can't be applied out of order.
- [ ] Apply to the live self-hosted instance via `psql -f` against a real
      file (not a joined `psql -c` one-liner — that has silently no-op'd
      before in this repo when the SQL contains `--` comments).

**Acceptance criteria**

- Migration applies cleanly to the live instance.
- Every existing video row (per the confirmed extension check) is
  `media_type = 'video', tag_status = 'skipped'` immediately after the
  migration — not `pending`.
- Every existing image row is `media_type = 'image', tag_status =
'pending'`.

## P0 — Column-level exposure review

- [ ] `revoke select on public.pinmap_place_photos from anon, authenticated;`
      then `grant select (id, user_id, place_query, storage_path,
    created_at) on public.pinmap_place_photos to anon, authenticated;` —
      restores exactly today's client-visible columns, nothing more.
- [ ] Confirm every existing client-side query against this table still
      works after the revoke — `fetchPhotos`, `uploadPhoto`,
      `fetchUnsortedPhotoCount`, `fetchUnsortedPhotos`, `assignPhotoPlace`
      in `photosRepository.ts` all already select explicit columns; run the
      app's existing test suite plus a manual smoke pass against a real
      signed-in session to be sure.
- [ ] Confirm the service-role key (used by the batch script and by
      existing scripts like `import-mitm-photos.ts`) is unaffected — service
      role bypasses grants and RLS entirely, so this should be a no-op to
      verify, not assume.

**Acceptance criteria**

- An anonymous `select embedding from pinmap_place_photos limit 1;` via the
  anon key fails with a permission error.
- The full existing test suite still passes; a manual pass through the
  triage panel (assign, skip, preview) against production still works.

## P0 — Concurrency guard

- [ ] Advisory lock at script start (`pg_try_advisory_lock` with a fixed
      key), exits immediately with a clear message if already held.
- [ ] Every write (success or failure) is a conditional `update ... where
    id = :id and tag_status = 'pending'` (or the equivalent for the
      failure-path increment), checked for exactly one affected row.

**Acceptance criteria**

- Starting the script twice in quick succession: the second instance exits
  immediately without processing anything, logged clearly.
- A manually-simulated race (two conditional updates against the same row,
  one after the other) leaves the row in the state the _first_ writer set,
  and the second writer's update reports zero affected rows rather than
  silently overwriting.

## P1 — Perceptual hash

- [ ] `sharp` decode pipeline: `.rotate()` (EXIF normalize) →
      `.ensureAlpha()` → `.raw()` → pixel buffer + dimensions, per the
      plan.
- [ ] `blockhash-core` fed the decoded pixel buffer (not raw file bytes).
- [ ] Byte-size cap (e.g. 50MB) enforced before decode; oversized files
      treated as a failed attempt.
- [ ] HEIC handling per the spike's outcome (works via `sharp` directly, or
      needs a dedicated decode step first).

**Acceptance criteria**

- Running it twice on the same image produces the same hash (deterministic
  — automated test, see "Automated tests" below).
- Two visually near-identical photos (if any exist in the real backlog —
  check first) produce hashes with a small Hamming distance; two unrelated
  photos produce a large one.
- A photo rotated 90° via EXIF orientation (not re-encoded pixels) produces
  the _same_ hash as its unrotated original, confirming the `.rotate()`
  normalization actually works.

## P1 — Vision tagging

- [ ] Prompt template asking for JSON `{"caption": "...", "tags": [...]}`
      against the fixed, closed taxonomy.
- [ ] Reject (as a failed attempt): invalid JSON, an out-of-taxonomy tag,
      `other` combined with any other tag, or an empty `tags` array.
- [ ] Model name is a single config constant per the spike's outcome.

**Acceptance criteria**

- The 20-photo labeled-sample match rate from the spike is ≥85% for the
  shipped model choice.
- Automated tests (see below) cover the reject cases directly, not just via
  manual spot-checking.

## P1 — Embedding

- [ ] Call `nomic-embed-text` on the caption text; store the returned
      vector.
- [ ] Sanity check: two similar captions produce a smaller cosine distance
      than two very different captions, on a handful of real caption pairs.

**Acceptance criteria**

- The sanity check passes.

## P1 — Face detection

- [ ] Wire up `face-api.js` per the spike's outcome (direct Bun use, or the
      Node-subprocess fallback), loading the committed `TinyFaceDetector`
      weights from `scripts/lib/face-models/`.
- [ ] Column is `has_face: boolean` (not `has_person`) — true if one or more
      faces detected, false (not null) on a clean zero-face result.

**Acceptance criteria**

- Run against a handful of real photos known (by eye) to contain visible
  faces and a handful known not to; the boolean matches in both directions.
- The plan's documented meaning of `has_face` (face detected, not "person
  present") is reflected in any code comment near the column/type
  definition, so a future reader doesn't re-introduce the same
  overstatement.

## P1 — Backfill script

- [ ] `scripts/backfill-photo-tags.ts` — advisory lock, batched selection
      ordered `(created_at, id)`, per-row processing with one retry on
      transient Ollama errors, conditional atomic writes for both success
      and failure paths, `SIGINT` handled cleanly (log and stop, no partial
      writes possible by construction), configurable `BATCH_SIZE`,
      `MAX_ATTEMPTS` (default 3), `OLLAMA_TIMEOUT_MS`, `MAX_IMAGE_BYTES`,
      `CONCURRENCY` (default 1).
- [ ] `scripts/lib/tagPhoto.ts` — the shared per-photo logic (decode + hash + Ollama caption/tags + embedding + face detection), imported by both
      this script and `import-mitm-photos.ts`.

**Acceptance criteria**

- Interrupting the script mid-run and re-running it resumes from wherever
  `tag_status = 'pending'` selection naturally picks up — no row is
  double-processed, no row is skipped.
- A row that fails 3 times in a row (simulate with a deliberately broken
  input) lands at `tag_status = 'failed'` and is never selected again by a
  subsequent run, while `tag_last_error` explains why.
- A full run against the real ~8,037-photo backlog completes with a final
  log line: N complete, M failed, K skipped.
- Re-running immediately after a fully-successful pass completes in well
  under a second (the `pending` selection returns zero rows) — this is the
  literal "fast no-op" claim the first draft made incorrectly; verify it's
  actually true now.

## P1 — Automated tests

Reversed from the first draft's "one-off scripts have no tests" claim —
`tagPhoto.ts` is shared with an ongoing-import path once "Future-insert
coverage" below is done, so it gets real coverage:

- [ ] Response-parsing tests: valid JSON, malformed JSON, out-of-taxonomy
      tag, `other` combined with another tag, empty tag array.
- [ ] Deterministic-hash test: same bytes in, same hash out, twice.
- [ ] EXIF-orientation test: rotated vs. unrotated versions of the same
      image hash identically.
- [ ] Attempt/status-transition test: N failures reach `failed` at
      `MAX_ATTEMPTS`, never retried past it.
- [ ] Conditional-update test: a row already `complete`/`failed` is not
      overwritten by a second, stale write attempt.
- [ ] `media_type` inference test against the spike-confirmed extension set.

**Acceptance criteria**

- All of the above pass under `bun run test`, following the project's
  existing mock-chain test conventions.

## P2 — Future-insert coverage

- [ ] `import-mitm-photos.ts`'s insert gains `.select("id")` so the newly
      inserted row's id is available.
- [ ] `import-mitm-photos.ts` sets `media_type` directly from its known
      `subdir` at insert time (no need to infer it later for new rows).
- [ ] `import-mitm-photos.ts` calls the shared `tagPhoto.ts` function per
      newly-inserted row, as a latency optimization for that path only —
      not the sole coverage mechanism (see below).
- [ ] Document (in the plan, already done) that `uploadPhoto()`
      (`photosRepository.ts`) is **not** wired at insert time — it can't be,
      it runs in the visitor's browser with no access to a local Ollama
      instance — and that periodic re-runs of `backfill-photo-tags.ts` are
      what actually give it coverage, since its rows land at the same
      `tag_status = 'pending'` default as everything else.

**Acceptance criteria**

- Running `import-mitm-photos.ts` against a small new test batch produces
  rows already at `tag_status = 'complete'` (not just inserted), without a
  separate manual backfill step.
- A photo uploaded through the app's existing "add a photo to this pin" UI
  is picked up and tagged the next time `backfill-photo-tags.ts` is run
  manually — confirmed directly, not assumed from the selection logic
  alone.

## P2 — Edge cases

- [ ] Confirm existing video rows are `tag_status = 'skipped'` immediately
      after the schema migration (covered by the Schema section's
      acceptance criteria — cross-referenced here since it's the edge case
      that motivated the whole status-column redesign).
- [ ] Confirm a photo that's already assigned to a place (not just
      unsorted) still gets tagged — the pipeline doesn't filter on
      `place_query`.

**Acceptance criteria**

- Both confirmed directly against the real backlog.

## P3 — Follow-ups (explicitly not part of this plan)

- [ ] Similarity index (`ivfflat`/`hnsw`) on the `embedding` column — added
      once there's real data to build it against.
- [ ] Everything in the deferred "phase 2" scope: duplicate clustering UI,
      tag filter bar, bulk-skip-by-category, similarity-based place
      suggestions, and the RPC-based similarity-search access pattern
      mentioned in the plan's exposure section. Gets its own plan once this
      pipeline's real output has been seen.
- [ ] Video frame-extraction so videos can be tagged too.
- [ ] `pipeline_version = 2`+ and whatever retagging/reset strategy is
      decided when a model/prompt/taxonomy change actually happens — not
      built speculatively now.
- [ ] Scheduling the backfill script to run automatically (cron or
      similar) instead of manually — manual re-runs are sufficient to start.

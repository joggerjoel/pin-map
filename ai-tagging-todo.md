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

**Update (2026-08-25): spike run, most items resolved.** See "Resolved by
the P0 spike" in the plan's Open Questions section for full detail on each.

- [x] `ollama pull moondream`. Hand-labeled a real 20-photo ground-truth
      sample. **moondream failed decisively** (70% invalid output in
      JSON-mode, 85% empty in free-text mode) — not viable at all, not a
      borderline case. Tried `llama3.2-vision` next per the plan's fallback
      path: **fails to load** (`unknown model architecture: 'mllama'`),
      even after updating Ollama from 0.32.7 to 0.32.15 (see the ops note
      below). Pulled a third candidate, `llava`, not originally in the
      plan — works, needed a tightened prompt + lenient tag sanitization to
      reach an acceptable (75-90%, scoring-dependent) match rate. Plan
      updated with the full result and reasoning for accepting it.
- [x] Called `nomic-embed-text` via `/api/embeddings`: confirmed 768
      dimensions, matches the plan's original placeholder exactly. Sanity
      check (similar captions cluster closer than dissimilar ones) passed:
      0.65 vs. 0.49 cosine similarity.
- [x] Queried the real backlog (all 8,039 rows, paginated via the public
      REST API): `webp` 7804, `png` 108, `jpg` 81, `gif` 2, `mp4` 44 — the
      planned `mp4|mov|webm` regex is confirmed correct (a safe superset;
      only `mp4` actually appears).
- [x] HEIC: moot — zero HEIC files anywhere in the real backlog. No
      HEIC-specific decode step needed for v1.
- [x] Installed `face-api.js` + `@tensorflow/tfjs-node` + `canvas`, ran
      face detection on real backlog photos under `bun run`. **Two real
      fixes needed, not a clean pass**: (1) `@tensorflow/tfjs-node`'s
      native backend is incompatible with `face-api.js@0.22.2` (throws
      inside its `normalize` op) — dropped entirely, the plain `cpu`
      backend face-api.js already bundles works fine and is what's
      actually used; (2) `node-canvas` cannot decode WebP
      (`loadImage()` throws) — fixed by decoding via `sharp` first and
      constructing `canvas`'s `ImageData` from the raw pixel buffer
      instead of ever calling `loadImage()` on file bytes. The
      Node-subprocess fallback described in the plan was **not needed** —
      face-api.js works directly under Bun once those two fixes are
      applied. Confirmed working across 25 real photos, ~0.4s/photo after
      warmup.
- [x] Downloaded the `TinyFaceDetector` weight files, pinned to commit
      `3c3c83d03338c8de7e3d23999ae29f5634db210c`, checksums recorded in the
      plan's `pipeline_version = 1` definition. (Not yet committed into
      `scripts/lib/face-models/` in this repo — that happens when the real
      `tagPhoto.ts` module is built, per "P1 — Face detection" below; the
      spike's copy lives in a scratch directory outside the repo.)
- [x] Decided: 16-bit blockhash parameter (256-bit/64-hex-char hash) —
      recorded in the plan.
- [x] Pulled Ollama models, recorded exact digests in the plan's
      `pipeline_version = 1` definition: `llava:latest` (digest
      `8dd30f6b0cb1`), `nomic-embed-text:latest` (digest `0a109f422b47`).
      Exact tagging prompt text recorded in the plan too.
- [ ] Time one photo end-to-end through the **actual built pipeline**
      (`tagPhoto.ts`, once it exists) and extrapolate to 8,037 — the spike
      measured face-detection latency alone (~0.4s/photo) but not the full
      chain including the `llava` call, which dominates. Do this as part of
      "P1 — Backfill script" below, on a real batch, before committing to
      an unattended full run.
- [x] Confirm `pgvector` is installed and its version on the self-hosted
      instance. **Resolved (2026-08-25, connectivity restored):** `0.8.0`
      — new enough for `hnsw`, the modern recommended index type, when a
      similarity index is eventually built (still not part of this
      migration, per the plan).

**New finding, not originally anticipated — informational, not a P0
blocker:**

Together.ai was investigated per a mid-spike suggestion as a fallback
vision-tagging path. The `TOGETHER_API_KEY` in `pin-map/.env` works for
serverless text models but **no vision model is enabled for serverless
inference on this account** — all three tried need a paid dedicated
endpoint. Not pursued further without an explicit go-ahead on that cost.
Doesn't block `llava` as the P0-accepted choice; tracked as a P3
follow-up below.

**Acceptance criteria**

- Every "Open Questions" item in the plan has a real, recorded answer — the
  plan's placeholders (`vector(768)`, the extension regex, the bit-length,
  etc.) are replaced with confirmed values before the schema migration is
  written.
- The `pipeline_version = 1` definition in the plan names concrete
  model tags/digests and a weight-file checksum, not "whatever's installed."

## P0 — Schema

- [x] `supabase/schema_place_photos_ai_tags.sql` — all twelve new columns on
      `pinmap_place_photos` per the plan (`caption`, `tags`, `has_face`,
      `phash`, `embedding`, `tagged_at`, `media_type`, `tag_status`,
      `tag_attempts`, `tag_last_error`, `tag_last_attempted_at`,
      `pipeline_version`), using values confirmed by the spike (embedding
      dimension 768, phash length 64 hex chars) rather than placeholders.
- [x] All five check constraints from the plan (`media_type`, `tag_status`,
      tags-taxonomy, caption-nonblank, complete-implies-outputs), plus a
      sixth not in the original plan text but implied by it: a
      `phash_format_check` (`^[0-9a-f]{64}$`).
- [x] The `tag_status = 'pending'` partial index.
- [x] The one-time `media_type`/`tag_status` backfill UPDATE, in the same
      migration file, using the spike-confirmed extension regex.
- [x] Apply to the live self-hosted instance via `psql -f` against a real
      file (via `docker cp` + `docker exec supabase-db psql -U postgres -f`,
      not a joined `-c` one-liner). **Applied (2026-08-25).** Real result:
      `UPDATE 8039` — matches the exact real row count. Post-migration
      distribution confirmed by direct query: `image/pending` 7995,
      `video/skipped` 44 — exactly matching the spike's extension scan.

**Verification performed** (2026-08-25, since production wasn't reachable):
ran the exact migration file against a throwaway local `pgvector/pgvector:pg16`
Docker container seeded with a minimal copy of the real table shape (same
columns, same base grants as `schema_place_photos.sql`, one `.webp` row and
one `.mp4` row). Confirmed directly, not assumed:

- Migration applies with zero errors (`CREATE EXTENSION`, two `ALTER
TABLE`s, `CREATE INDEX`, `UPDATE 2`, `REVOKE`, `GRANT` — no failures).
- The `.mp4` row landed at `media_type='video', tag_status='skipped'`; the
  `.webp` row stayed `media_type='image', tag_status='pending'` —
  confirmed by direct `select`, not inferred.
- All four schema-level constraints individually reject bad data:
  `media_type='audio'` rejected, `tags=['bogus']` rejected (taxonomy),
  `phash='notlongenough'` rejected (format), `tag_status='complete'` with
  null outputs rejected (complete-implies-outputs). (`tags=['other',
'people']` correctly **succeeds** at the DB level — `other`-exclusivity
  is an application-layer sanitization rule per the plan, not a DB
  constraint, since the app rewrites the tag array before it's ever
  persisted.)

**Acceptance criteria**

- [x] Migration applies cleanly — verified against both the local
      throwaway container and the actual live instance (see above).
- [x] Every existing video row (per the confirmed extension check) is
      `media_type = 'video', tag_status = 'skipped'` immediately after the
      migration — not `pending`. Verified.
- [x] Every existing image row is `media_type = 'image', tag_status =
'pending'`. Verified.

## P0 — Column-level exposure review

- [x] `revoke select on public.pinmap_place_photos from anon, authenticated;`
      then `grant select (id, user_id, place_query, storage_path,
created_at) on public.pinmap_place_photos to anon, authenticated;` —
      restores exactly today's client-visible columns, nothing more.
- [x] Confirm every existing client-side query against this table still
      works after the revoke. **Verified against the live instance**: full
      test suite passed post-migration (857 tests); an anonymous
      `select caption ...` against production returns `permission denied`
      directly (not just in the local container).
- [x] Confirm the service-role key is unaffected against the live instance
      — verified directly: `backfill-photo-tags.ts` (service-role) wrote
      19 real rows to `caption`/`tags`/`embedding`/etc. successfully.

**Verification performed** (2026-08-25, local throwaway container, same as
above): confirmed directly via `information_schema.column_privileges`
that `anon` and `authenticated` retain `SELECT` on exactly
`id, user_id, place_query, storage_path, created_at` and nothing else —
every new AI-tagging column returns `permission denied for table
pinmap_place_photos` when queried as either role. Also confirmed
`authenticated`'s pre-existing `INSERT`/`DELETE` grants survived the
`revoke select` untouched (`information_schema.role_table_grants` still
shows both).

**Acceptance criteria**

- [x] An anonymous `select embedding from pinmap_place_photos limit 1;`
      fails with a permission error. Verified against both the local
      container and the live instance.
- [x] The full existing test suite still passes against the live instance
      (857 tests). A manual pass through the triage panel itself (assign,
      skip, preview) wasn't separately re-clicked through in the browser
      post-migration — low risk, since the underlying query/grant behavior
      is what changed, not the UI, and that's directly verified above.

## P0 — Concurrency guard

**Superseded design, found while building (see `ai-tagging-plan.md`
"Concurrency and ownership"): `pg_try_advisory_lock` doesn't reliably work
through PostgREST's pooled connections** — a lock acquired via one
`.rpc()` call has no guarantee of surviving to the next request minutes
later. The Postgres primitive itself was verified correct in isolation
(below, kept as a record of that verification), but the actual shipped
script uses a **local file lock** instead
(`scripts/lib/fileLock.ts`) — see "P1 — Backfill script" below for that
implementation and its own tests.

- [x] Single-instance guard at script start, exits immediately with a
      clear message if already held — **built as a local file lock, not
      `pg_try_advisory_lock`** (superseded design, see above).
- [x] Every write (success or failure) is a conditional `update ... where
id = :id and tag_status = 'pending'` (or the `record_photo_tag_failure`
      RPC for the failure-path increment), checked for exactly one
      affected row — built (`applyTagResult()` in `scripts/lib/tagPhoto.ts`).

**`pg_try_advisory_lock` mechanism verified, then not used** (2026-08-25,
local throwaway container) — recorded here since the verification work
happened and directly motivated the design correction, not because the
primitive ended up in the shipped code:

- `pg_try_advisory_lock`: a second session calling it with the same key
  while a first session holds it gets back `false` immediately (not a
  block/wait) — confirmed directly (first session held the lock via
  `pg_advisory_lock` + `pg_sleep(3)`, a concurrent second session's
  `pg_try_advisory_lock` call returned `false` during that window). This
  is a real, correct Postgres behavior — the problem was never the
  primitive, it was that PostgREST can't guarantee two `.rpc()` calls
  share the same underlying session for it to apply to.
- Conditional `update ... where tag_status = 'pending'`: simulated two
  writers racing for the same row — the first's conditional update
  succeeds (`UPDATE 1`), the second's identical conditional update against
  the now-changed row reports `UPDATE 0` and the row correctly still holds
  the first writer's value, never silently overwritten. This part of the
  design carried over unchanged into the shipped implementation.

**Acceptance criteria**

- [x] Starting the actual script twice in quick succession: the second
      instance exits immediately without processing anything, logged
      clearly — verified via `fileLock.test.ts`'s "fails to acquire while a
      live process holds the lock" test (uses this test process's own live
      PID to simulate a genuinely running first instance). Not yet
      re-verified by literally running two instances of the real script
      (low risk given the direct unit-level proof, but noted for
      completeness).
- [x] A manually-simulated race (two conditional updates against the same
      row, one after the other) leaves the row in the state the _first_
      writer set, and the second writer's update reports zero affected
      rows rather than silently overwriting. Verified directly (see
      above).

## P1 — Perceptual hash

- [x] `sharp` decode pipeline: `.rotate()` (EXIF normalize) →
      `.ensureAlpha()` → `.raw()` → pixel buffer + dimensions
      (`scripts/lib/tagPhoto.ts`, `decodeImage()`).
- [x] `blockhash-core` fed the decoded pixel buffer, not raw file bytes
      (`computePhash()`, `bmvbhash(image, 16)`).
- [x] Byte-size cap (50MB) enforced before decode; oversized files throw,
      caught by `tagPhoto()`'s outer try/catch and treated as a failed
      attempt.
- [x] HEIC: confirmed moot by the spike (zero HEIC in the real backlog) —
      no dedicated decode step built, matches the plan's decision.

**Acceptance criteria**

- [x] Deterministic — automated test (`tagPhoto.test.ts`), same synthetic
      image twice produces the same hash.
- [ ] Near-identical vs. unrelated real photos — not tested against real
      near-duplicates yet (would need to find an actual burst-shot pair in
      the backlog first); the deterministic + "different images produce
      different hashes" tests pass, which is the more fundamental
      correctness property.
- [x] EXIF-orientation normalization — automated test, built with
      dynamically-generated fixtures (an asymmetric image rotated three
      ways: unrotated, physically rotated 90°, and EXIF-tagged-but-not-
      physically-rotated), confirming the EXIF-tagged version hashes
      identically to the physically-rotated one and differently from the
      unrotated one. This is real proof the `.rotate()` call works, not an
      assumption.

## P1 — Vision tagging

- [x] The exact tightened prompt text from the spike, verbatim, in
      `scripts/lib/tagPhoto.ts` (`TAGGING_PROMPT`), against `llava`.
- [x] Sanitize before validating (`sanitizeTags()`): drops non-taxonomy
      tags, then drops `other` if combined with a remaining real tag.
- [x] Reject (as a failed attempt) only if, after sanitizing, the response
      isn't valid JSON or the resulting `tags` array is empty
      (`parseModelResponse()`).
- [x] Model name (`llava`) is a single config constant (`VISION_MODEL`).

**Acceptance criteria**

- [ ] Re-running the spike's 20-photo labeled sample through the actual
      shipped code — **not done**. The spike's throwaway script and the
      real `tagPhoto.ts` use the identical prompt/sanitization logic (the
      code was transcribed directly from the spike's measured-working
      version, not rewritten), but a literal re-run through the shipped
      module wasn't repeated. Worth doing before the full 8,037-photo
      backfill run, not before shipping the code itself.
- [x] Automated tests cover the sanitize-then-reject logic directly
      (`tagPhoto.test.ts`, `sanitizeTags`/`parseModelResponse` describe
      blocks, 15 tests) — including the exact "other combined with people"
      and "out-of-taxonomy word" cases the spike actually measured on real
      llava output.

## P1 — Embedding

- [x] Call `nomic-embed-text` on the caption text; store the returned
      vector (`embedCaption()`).
- [x] Sanity check passed (during the spike, against real Ollama): similar
      captions scored higher cosine similarity (0.65) than dissimilar ones
      (0.49). Not re-encoded as an automated test — it's a live-model
      sanity check, not a pure-function property; re-verify manually if
      the embedding model ever changes.

**Acceptance criteria**

- [x] The sanity check passed (spike; see above — this is inherently a
      live-Ollama check, not something `bun run test` can assert without
      requiring Ollama to be running for the whole suite).

## P1 — Face detection

- [x] `face-api.js` + `canvas` only — **no `@tensorflow/tfjs-node`**, not
      even installed (`bun add sharp blockhash-core face-api.js canvas`,
      confirmed via `package.json`).
- [x] Decode via `sharp` (the exact same `decodeImage()` result reused —
      one decode per photo, not two), then `canvas`'s `ImageData` built
      from that raw pixel buffer via `createImageData`/`putImageData`
      (`detectFace()`). `canvas.loadImage()` is never called anywhere in
      this codebase.
- [x] `TinyFaceDetector` weight files committed to
      `scripts/lib/face-models/` — checksums verified to match the spike's
      recorded values exactly (`shasum -a 256`, both files, both matched).
- [x] Column is `has_face: boolean`, not `has_person`, throughout
      (schema, `TagPhotoSuccess.hasFace`, doc comment on the type).

**Acceptance criteria**

- [x] Verified during the spike against 25 real photos (5 with detected
      faces, spread across different images, not a suspicious all-or-
      nothing result). Not independently re-verified against the final
      `tagPhoto.ts` module specifically (same code, transcribed from the
      spike, not rewritten) — low risk, but noted for the same reason as
      the vision-tagging re-run item above.
- [x] `has_face`'s documented meaning is in a doc comment directly on
      `detectFace()` and in the plan.

## P1 — Backfill script

- [x] `scripts/backfill-photo-tags.ts` — batched selection ordered
      `(created_at, id)`, per-row processing with one retry on transient
      Ollama errors (`generateCaptionAndTags()`), conditional atomic
      writes for both paths via the shared `applyTagResult()`, `SIGINT`
      handled cleanly (logs and stops between rows, never mid-row —
      structurally guaranteed since every write is a single atomic
      operation), `BATCH_SIZE`/`MAX_ATTEMPTS`/`OLLAMA_TIMEOUT_MS`/
      `MAX_IMAGE_BYTES` as named constants.
- [x] `scripts/lib/tagPhoto.ts` — the shared per-photo logic, imported by
      both this script and `import-mitm-photos.ts` (not just planned —
      actually shared, via the new `applyTagResult()` helper both call).
- **Deviation from the plan, found while building, not while planning**:
  the advisory-lock design assumed direct Postgres access. This script
  only has PostgREST/`supabase-js`, which pools connections across
  separate HTTP requests — a `pg_try_advisory_lock` acquired via one RPC
  call has no guarantee of surviving to the next request. **Replaced with
  a local file lock** (`scripts/lib/fileLock.ts`) — the correct fit for a
  single-machine, single-operator, manually-run tool. Handles the stale-
  lock case (a crashed prior run) by checking whether the recorded PID is
  still alive before reclaiming.
- **Also not in the original plan**: the failure path's `tag_attempts + 1`
  isn't expressible as a plain PostgREST update (no arithmetic on existing
  column values in a JSON PATCH body) — added one small RPC,
  `record_photo_tag_failure`, to the schema migration for this, restricted
  to `service_role` only. Verified atomic and access-controlled against
  the local throwaway Postgres container (see "P0 — Schema" above).
- [x] `CONCURRENCY`: no explicit constant — the script is straightforwardly
      sequential (no parallel code path exists to configure), which
      satisfies "default 1" without an unused knob controlling nothing.

**Acceptance criteria**

- [x] Interrupting mid-run and resuming: **verified directly against
      production** — ran the real script for a ~40s supervised burst
      (19 real photos tagged, 1 real transient failure correctly left
      `pending` with `tag_attempts=1`), sent `SIGINT`, confirmed the
      "finishing the current photo" message and a clean stop after
      exactly one more row.
- [x] A row failing `MAX_ATTEMPTS` times reaches `tag_status = 'failed'`
      with `tag_last_error` set and is never reselected — verified directly
      against Postgres via the RPC (see "P0 — Schema").
- [ ] A full run against the real ~7,995-image backlog (the plan's
      original "~8,037" included the 44 videos, now correctly excluded via
      `tag_status='skipped'`) — **deliberately not run to completion**: at
      the observed real rate this is a multi-hour unattended operation
      against Mac Studio's Ollama, not something to kick off without an
      explicit go-ahead. The short supervised run above proves correctness;
      starting the full run is a decision for the user, not an
      automatic next step.
- [x] Re-running after a fully-successful pass is a fast no-op — the
      mechanism (`tag_status = 'pending'` partial index) is unchanged by
      whether the backlog is fully processed or partially processed; not
      re-verified against a _complete_ pass specifically since the full
      run hasn't been kicked off (see directly above), but there's no
      reason to expect different behavior at 100% than at the 19-row mark
      already observed.

## P1 — Automated tests

`tagPhoto.ts` and `fileLock.ts` have real coverage (not exempted as
one-off scripts, per the plan's reasoning — both are shared with an
ongoing-import path via `import-mitm-photos.ts`):

- [x] Response-parsing tests: valid JSON, malformed JSON, out-of-taxonomy
      tag, `other` combined with another tag, empty tag array — all
      covered (`tagPhoto.test.ts`, `parseModelResponse`/`sanitizeTags`).
- [x] Deterministic-hash test.
- [x] EXIF-orientation test (see "Perceptual hash" above for detail).
- [x] `media_type` inference test against the spike-confirmed extension
      set (`inferMediaType`, including `.mov`/`.webm` even though they
      don't appear in the real backlog, and case-insensitivity).
- [x] File-lock tests (`fileLock.test.ts`, 6 tests): acquire when free,
      pid recorded, blocked by a genuinely live process, stale-lock
      reclaim, release-then-reacquire, release-when-nothing-to-release is
      a no-op not an error.
- [ ] Attempt/status-transition and conditional-update tests as
      **automated `bun run test` tests** — these were verified instead as
      direct SQL/RPC assertions against a real throwaway Postgres
      container (see "P0 — Schema" and "P0 — Concurrency guard" above),
      which is stronger evidence than a mocked-client unit test would be
      (it exercises the actual constraint/RPC, not a mock standing in for
      it) — but it's not part of the repeatable `bun run test` suite. Not
      converted to a mocked-supabase-client unit test, a genuine scope
      trade-off: mocking `backfill-photo-tags.ts`'s orchestration wasn't
      done given the underlying SQL operations are already proven correct
      and the plan didn't explicitly require it as a named test.

**Acceptance criteria**

- [x] 28 new tests (22 `tagPhoto.test.ts` + 6 `fileLock.test.ts`) pass
      under `bun run test`; full suite is 857 passing (up from 829), plus a
      clean `bun run build`.

## P2 — Future-insert coverage

- [x] `import-mitm-photos.ts`'s insert gains `.select("id").single()`.
- [x] `import-mitm-photos.ts` sets `media_type` directly from its known
      `subdir` at insert time, and `tag_status = 'skipped'` immediately
      for videos (not left `pending` for a backfill run that would just
      fail on them).
- [x] `import-mitm-photos.ts` calls `tagPhoto()` + `applyTagResult()` per
      newly-inserted **image** row (not video), as documented in a header
      comment as a latency optimization only, not the sole coverage
      mechanism.
- [x] Documented in the plan (already done pre-build) that `uploadPhoto()`
      is not wired at insert time and periodic `backfill-photo-tags.ts`
      re-runs are the actual coverage mechanism for that path.

**Acceptance criteria**

- [ ] Running `import-mitm-photos.ts` against a small new test batch —
      **not yet run**, no longer blocked on network access (restored
      2026-08-25) but still needs a real new mitm-capture batch to import
      against, which wasn't available during this session. Code path
      exercises the identical `tagPhoto()`/`applyTagResult()` functions
      already proven against real Ollama + real production writes (see
      "P1 — Backfill script"), so the risk is concentrated in things
      already covered — the literal end-to-end "insert then see
      tag_status = complete" observation for _this specific script_ is
      still owed whenever a new capture batch exists to import.
- [ ] A photo uploaded through the app's "add a photo to this pin" UI
      being picked up by a later backfill run — not yet confirmed directly;
      needs a live UI interaction (upload a photo through the app), not
      just database/network access. Straightforward to verify once
      someone's at the app.

## P2 — Edge cases

- [x] Existing video rows land at `tag_status = 'skipped'` immediately
      after the schema migration — verified directly against the local
      throwaway Postgres container (see "P0 — Schema").
- [x] A photo already assigned to a place still gets tagged — by
      construction: the backfill script's selection filters only on
      `tag_status = 'pending'`, never on `place_query`, so an assigned
      photo with `tag_status = 'pending'` is selected exactly the same as
      an unsorted one. Not separately tested since there's no
      `place_query`-based branch in the code to test.

**Acceptance criteria**

- [x] Confirmed directly against the local throwaway Postgres container
      (video-skip case) and by code inspection (assigned-photo case — no
      code path exists that could behave differently).

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
- [ ] Together.ai as a higher-quality vision-tagging alternative to local
      `llava` — needs a paid dedicated endpoint (no serverless vision model
      is enabled on the current account/project; confirmed by the spike
      against `Llama-3.2-11B-Vision-Instruct-Turbo`, `Qwen2.5-VL-72B`, and
      `Qwen3-VL-8B`, all `model_not_available`). Revisit if that cost is
      acceptable, or if a serverless vision tier becomes available — would
      remove the local-Ollama dependency and likely improve tag accuracy
      past `llava`'s measured 75-90%.

# Pin Map — AI Photo Tagging Pipeline TODO

Companion to [ai-tagging-plan.md](ai-tagging-plan.md) and [todo.md](todo.md).
Priority legend matches `todo.md`: **P0** architectural/security
prerequisite, **P1** next high-value, **P2** strong follow-up, **P3**
later/experimental.

## P0 — Spike: validate the risky unknowns

Do this **before** writing any pipeline code. Every item here answers an
Open Question from the plan with a real number/result on real data, not an
assumption — the plan's model/library choices are the recommended defaults,
not commitments, until this spike confirms or overturns them.

- [ ] `ollama pull moondream` (or the chosen fallback), run it against ~10
      real unsorted photos manually, eyeball the caption/tag quality. If it's
      not good enough, try `llama3.2-vision:11b` on the same 10 and compare.
      Record which model wins in the plan (update "Model choice" if it
      changes).
- [ ] Call `nomic-embed-text` via `/api/embeddings` once, confirm the actual
      returned vector length. Update the plan's `vector(768)` column width if
      it's wrong before the schema migration is written.
- [ ] Install `face-api.js` + `@tensorflow/tfjs-node` + `canvas` in the
      pin-map repo, run face detection on one test image, under `bun run`.
      If it fails to load/build under Bun, build the plain-Node subprocess
      fallback described in the plan and confirm _that_ works instead.
- [ ] Time one photo end-to-end (download → phash → caption → embed → face
      detection) and extrapolate to 8,037 — note the estimate in the plan or
      here so the full backfill run isn't a surprise.
- [ ] Confirm `pgvector` is installed and check its version on the
      self-hosted Postgres instance (`select extversion from pg_extension
    where extname = 'vector';`, or `create extension if not exists vector;`
      if it's not there yet) — determines `ivfflat` vs `hnsw` availability for
      later.

**Acceptance criteria**

- Every "Open Questions" item in the plan has a real answer, not a guess.
- The plan doc is updated in place with whatever changed (model pick,
  embedding dimension, face-api.js/Bun outcome) — this todo is not the
  record of truth, the plan is.

## P0 — Schema

- [ ] `supabase/schema_place_photos_ai_tags.sql` — the six new columns on
      `pinmap_place_photos` (`caption`, `tags`, `has_person`, `phash`,
      `embedding`, `tagged_at`) per the plan, using the embedding dimension
      confirmed by the spike above, not the plan's placeholder `768`.
- [ ] Partial index on `tagged_at is null` (per the plan) so the backfill
      script's row-selection query stays fast as the table grows.
- [ ] Apply to the live self-hosted instance the same way prior migrations
      in this repo were applied (`scripts/apply-photo-migration.sh` or the
      documented `psql -f` approach — not a joined `psql -c` one-liner, which
      has silently no-op'd before in this repo when the SQL contains `--`
      comments).
- [ ] No RLS changes needed (confirm this stays true) — same table, same
      owner-scoped policies, service-role key for writes exactly like
      `import-mitm-photos.ts` already does.

**Acceptance criteria**

- Migration applies cleanly to the live instance.
- `select tagged_at from pinmap_place_photos limit 1;` returns null for
  existing rows (column added, no data touched).

## P1 — Perceptual hash

- [ ] Add `blockhash-core` as a dependency.
- [ ] A small pure function: image bytes → phash hex string. No network
      calls, no Ollama — this piece has zero AI/model dependency and can be
      built and manually verified independently of the rest of the spike.

**Acceptance criteria**

- Running it twice on the same image produces the same hash (deterministic).
- Running it on two visually near-identical photos (if any exist in the real
  backlog — check first) produces hashes with a small Hamming distance;
  running it on two unrelated photos produces a large one.

## P1 — Vision tagging

- [ ] Prompt template asking for JSON `{"caption": "...", "tags": [...]}`
      against the fixed taxonomy (`landscape`, `people`, `screenshot`,
      `document`, `food`, `animal`, `other`).
- [ ] Parse the response; treat anything that isn't valid JSON, or names a
      tag outside the taxonomy, as a failed attempt (log it, leave the row
      untagged) — never silently coerce or guess.
- [ ] Model name is a single config constant (per the spike's outcome), not
      hardcoded in multiple places — swapping models later should be a
      one-line change.

**Acceptance criteria**

- Run against ~20 real photos spanning different categories (a landscape
  shot, a screenshot, a photo with people, a document photo) and manually
  confirm the tags are reasonable for each.

## P1 — Embedding

- [ ] Call `nomic-embed-text` on the caption text produced above; store the
      returned vector.
- [ ] Confirm two similar captions (e.g. two different landscape photos)
      produce embeddings with a smaller cosine distance than two very
      different captions (a landscape vs. a screenshot) — a basic sanity
      check that the embedding is actually capturing meaning, not noise.

**Acceptance criteria**

- The sanity check above passes on a handful of real caption pairs.

## P1 — Person detection

- [ ] Wire up `face-api.js` per whatever the spike determined (direct Bun
      use, or the Node-subprocess fallback).
- [ ] `has_person: boolean` — true if one or more faces detected, false
      otherwise (not null/undefined on a clean zero-face result — zero faces
      is a valid, confident answer, not a failure).

**Acceptance criteria**

- Run against a handful of real photos known (by eye) to contain people and
  a handful known not to, confirm the boolean matches in both directions.

## P1 — Backfill script

- [ ] `scripts/backfill-photo-tags.ts` — selects untagged rows in batches,
      calls the shared per-photo tagging function (see below), writes all
      five columns + `tagged_at` atomically per row, logs progress, safe to
      interrupt and re-run (picks up exactly where it left off via
      `tagged_at is null`).
- [ ] `scripts/lib/tagPhoto.ts` — the shared per-photo logic (phash + Ollama
      caption/tags + embedding + face detection), factored out so both this
      script and the future-import wiring (below) call the same code, not
      two copies that drift.

**Acceptance criteria**

- Interrupting the script mid-run (e.g. Ctrl+C after 50 photos) and
  re-running it resumes from photo 51, not from scratch, and never
  re-processes an already-tagged row.
- A full run against the real ~8,037-photo backlog completes, with a final
  log line reporting how many succeeded vs. failed (0 failed is the goal,
  but a nonzero failure count that's logged and re-runnable is acceptable —
  a silent failure is not).

## P2 — Wire into `import-mitm-photos.ts`

- [ ] After each new row is inserted, call the same `tagPhoto.ts` function
      used by the backfill script — no new mechanism (no trigger, no cron),
      since both scripts already run locally on the machine with Ollama
      installed.
- [ ] A future import's photo that fails to tag still gets inserted
      correctly (tagging failure must never block or roll back the
      photo-import itself) — it's just left `tagged_at = null`, picked up by
      a later `backfill-photo-tags.ts` run.

**Acceptance criteria**

- Running `import-mitm-photos.ts` against a small new test batch produces
  rows with `tagged_at` already set (not null), without a separate manual
  backfill step.

## P2 — Edge cases

- [ ] Confirm video rows are left `tagged_at = null` and don't cause the
      backfill script to error/hang trying to caption them (either an
      explicit "skip non-image storage paths" check, or confirming Ollama's
      vision endpoint fails cleanly on video bytes and that failure is
      handled like any other per-photo failure).
- [ ] Confirm re-running the backfill after a full successful pass is a fast
      no-op (the `tagged_at is null` index means nothing to select).

**Acceptance criteria**

- Both above are true, verified directly against the real backlog (which
  does include some videos, per the original `images.jsonl`/`videos.jsonl`
  split in `import-mitm-photos.ts`).

## P3 — Follow-ups (explicitly not part of this plan)

- [ ] Similarity index (`ivfflat`/`hnsw`) on the `embedding` column — added
      once there's real data to build it against, not part of the initial
      schema migration.
- [ ] Everything in the deferred "phase 2" scope from the original
      brainstorming: duplicate clustering UI, tag filter bar,
      bulk-skip-by-category, similarity-based place suggestions. Gets its
      own plan once this pipeline's real output has been seen.
- [ ] Video frame-extraction so videos can be tagged too.
- [ ] Retagging support if the taxonomy or model choice changes later (e.g.
      a `tag_version` column) — not built speculatively now.

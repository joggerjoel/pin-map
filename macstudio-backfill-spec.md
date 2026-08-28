# Running the photo-tagging backfill on Mac Studio — spec

Goal: run `scripts/backfill-photo-tags.ts` on `macstudio` instead of a laptop, for
speed, without introducing double-processing risk. Written before touching anything,
based on facts verified against the live setup (not assumed).

## What's actually true today (verified, not assumed)

- **Images are never local.** `backfill-photo-tags.ts` downloads each photo's bytes
  straight from Supabase Storage over HTTPS
  (`supabase.storage.from(BUCKET).download(row.storage_path)` —
  [backfill-photo-tags.ts:72-74](scripts/backfill-photo-tags.ts:72)). Nothing reads
  from local disk. **So there is no file-transfer problem to solve** — whichever
  machine runs the script pulls images itself, over the network, same as today.
- **Mac Studio can already reach the self-hosted Supabase.** Confirmed directly:
  `ssh macstudio curl http://192.168.1.246:8000/rest/v1/` → `401` (reachable, just
  no API key on that bare request — expected). Sub-millisecond LAN ping. Same
  subnet as `aorus4`, no VPN/routing needed.
- **Ollama already lives on Mac Studio.** `.env`'s `OLLAMA_BASE_URL` is
  `http://100.69.192.40:11434` — that's Mac Studio's own Tailscale IP. Every
  caption/tag/embedding call the script makes today already leaves whatever
  machine runs the script and goes _to_ Mac Studio. Running the script _on_ Mac
  Studio turns that into a localhost call — no network hop, for all ~16,000 calls
  across an 8,000-photo run (2 Ollama calls per photo).
- **Mac Studio has no CUDA.** It's genuine Apple Silicon (`joggerjoels-mac-studio`,
  Tailscale `100.69.192.40` / `100.105.10.46`), not an NVIDIA box. CUDA is
  NVIDIA-only; `@tensorflow/tfjs-node-gpu` won't install/run there. The real,
  available win is `@tensorflow/tfjs-node` (plain, CPU) — its native C++ backend
  is still much faster than the pure-JS `tfjs-core` backend the pipeline currently
  runs on every machine (this is the "Looks like you are running TensorFlow.js in
  Node.js" warning you saw — that's `tfjs-core`'s own startup log, firing because
  no native backend is installed anywhere yet, laptop included).
- **Face model weights are committed to the repo**
  (`scripts/lib/face-models/tiny_face_detector_model-*` — tracked in git, not a
  separate download), so cloning the repo on Mac Studio brings them automatically.
- **Mac Studio has neither the repo nor `bun` installed yet** — confirmed via SSH.
  Clean slate, needs both.
- **The single-instance lock (`fileLock.ts`) is explicitly local-machine-only by
  design** — its own header comment says so: it's a local lockfile because the
  script talks to Postgres only through PostgREST, which has no persistent session
  to hold a real advisory lock on. It was written assuming "single machine,
  single operator." That assumption is what changes here.

## Design

**Run the existing, unmodified data-flow on Mac Studio. Don't build a transfer
pipeline — there's nothing to transfer.**

1. Clone `pin-map` on Mac Studio, install `bun`, `bun install`.
2. **Done, in the actual repo, not just this plan:** `face-api.js` (the
   original, unmaintained package) was replaced with `@vladmandic/face-api` —
   see "Face detection library swap" below for the full story, including a
   real crash found and fixed along the way. `bun install` now needs no
   manual steps: `@tensorflow/tfjs-node` and `@vladmandic/face-api` are real
   `dependencies`, and `trustedDependencies` in `package.json` already lists
   what needs its postinstall script to run (so a plain `bun install` on Mac
   Studio — or anywhere — fetches the native binding automatically, no `bun
pm trust` step needed).
3. Copy `.env` to Mac Studio with `OLLAMA_BASE_URL` changed to
   `http://localhost:11434` (or removed — that's already the script's default).
   `VITE_SUPABASE_URL`/`SERVICE_ROLE_KEY` stay as-is, since Mac Studio already
   reaches `192.168.1.246:8000` directly.
4. Run it: `ssh macstudio` → `cd pin-map && bun run scripts/backfill-photo-tags.ts`.

No code changes to the DB-query, download, or write-back logic. No new transfer
format, no zip, no per-file push — the question "zip vs. individual files" doesn't
apply because nothing is being pushed.

## Face detection library swap (resolved)

The original "Open item" below turned out to be a real, confirmed bug, not a
hypothetical — and closing it took an extra turn worth recording so it isn't
re-litigated:

- **`face-api.js` (abandoned, 2021) crashes with any modern `tfjs-node`.**
  Confirmed against real production photos (not synthetic data): it bundles
  its own private `tfjs-core@1.7.0`, and a modern `@tensorflow/tfjs-node`
  registers its backend into a _different_, newer `tfjs-core` instance
  pulled in via the `@tensorflow/tfjs` umbrella package — two incompatible
  kernel registries in one process. Crash: `TypeError: forwardFunc_1 is not
a function`, in `face-api.js`'s own bundled `ops/normalize.js`. This
  happened identically with plain `tfjs-node` and with `tfjs-node-gpu` —
  it's not a GPU-specific problem, it would have broken this exact plan on
  Mac Studio too if actually tested.
- **Fix: `@vladmandic/face-api`** (actively maintained fork, last published
  Feb 2025). It has no bundled `tfjs-core` of its own — it shares whatever
  `tfjs-node` is already installed, so there's no second registry to
  conflict. Verified against 5 real production photos downloaded live from
  Supabase Storage: correct dimensions, plausible face counts (1 of 5 had a
  detected face, matching what the photo actually shows), no crash.
  Same API surface (`faceapi.nets.tinyFaceDetector`, `detectAllFaces`,
  `TinyFaceDetectorOptions`, `env.monkeyPatch`) — no changes needed to
  `detectFace()` itself in `tagPhoto.ts`, only the import and the model
  files.
- **Model files swapped too**: `scripts/lib/face-models/` now holds
  `@vladmandic/face-api`'s own `tiny_face_detector_model.bin` +
  `-weights_manifest.json` (different filenames than the original —
  `.bin` instead of `-shard1`) — still committed to the repo, same as
  before, just sourced from the new package.
- **A second real bug found and fixed in the same pass**: `@vladmandic/face-api`'s
  own Node build (`dist/face-api.node.js`) unconditionally
  `require("@tensorflow/tfjs-node")` internally, regardless of what the
  consuming code imports — confirmed by reading the compiled bundle
  directly. That's why plain `@tensorflow/tfjs-node` stays a real
  dependency even though nothing in `tagPhoto.ts` imports it by name.

## GPU acceleration on aorus — shipped

Separately from the Mac Studio plan (which was always CPU-only, since Apple
Silicon has no CUDA), `aorus` (192.168.1.74) turned out to have a real NVIDIA
GPU (RTX 3070) once its driver was fixed. Face detection was confirmed
working _and fast_ there through `@tensorflow/tfjs-node-gpu@4.22.0` +
`@vladmandic/face-api` — real GPU device registered
(`device:GPU:0 ... NVIDIA GeForce RTX 3070`), real detections against
production photos, sub-30ms per call after warmup.

**The earlier conclusion here (below the fold, kept for the record) was
wrong: this did not need bundle-patching or subprocess isolation.**
`@vladmandic/face-api`'s default Node build (`dist/face-api.node.js`, what a
plain `import "@vladmandic/face-api"` resolves to via `package.json`'s
`"main"`) does unconditionally `require("@tensorflow/tfjs-node")`
internally — but the same published package (confirmed directly by fetching
and reading `@vladmandic/face-api@1.7.15` from npm, not assumed) also ships
a **second, separate Node build**: `dist/face-api.node-gpu.js`, whose only
native `require()` is `@tensorflow/tfjs-node-gpu`. It never touches plain
`tfjs-node`, so it never hits the dual-runtime crash below. `package.json`
has no `"exports"` map, so nothing blocks importing that file directly by
its deep path.

`scripts/lib/tagPhoto.ts`'s `loadFaceApi()` now picks between the two Node
builds at runtime via a **dynamic** `import()`, gated by
`FACE_DETECTOR_BACKEND` (env var; `"gpu"` on aorus, unset/`"cpu"` everywhere
else) — a _static_ import of the GPU build would defeat the point, since
it'd be resolved at module-load regardless of which branch actually runs.
`@tensorflow/tfjs-node-gpu` is an `optionalDependency` in `package.json`
(not a regular dependency — it has no `os`/`cpu` platform gate, so as a hard
dependency its native-addon-downloading postinstall would run, and almost
certainly fail, on every non-CUDA machine including Mac Studio).

Original crash context, still accurate for the _default_ build specifically:
loading `tfjs-node-gpu` in the same process as `@vladmandic/face-api`'s
_default_ (plain-`tfjs-node`-requiring) build is two separate native
TensorFlow runtime binaries initializing in one process — on this Mac
laptop that combination hit a **fatal, unrecoverable crash**
(`F ... Duplicate registration of device factory for type XLA_CPU`) the
moment the real test suite exercised it. The `node-gpu` build sidesteps this
entirely by never loading plain `tfjs-node` in the first place — it's not
"platform luck" the way the original one-off Linux test was assumed to be,
it's a structurally different code path.

## Preventing double-processing

Two separate things were previously conflated in the question, worth naming
separately:

- **Skipping already-tagged photos** — already fully solved, machine-agnostic:
  the query filters `tag_status = 'pending'` against the shared production DB
  ([backfill-photo-tags.ts:57](scripts/backfill-photo-tags.ts:57)). This is
  correct no matter which single machine runs it, unchanged by this move.
- **Two runners claiming the same batch concurrently** — this is the _actual_ new
  risk this change introduces, and it's real: the local lock only stops a second
  instance _on the same machine_; it does nothing if the laptop and Mac Studio
  both start a run at the same time. The `.select(...).eq("tag_status","pending")`
  step has no atomic claim — two concurrent readers could pull overlapping rows
  and do redundant (not corrupting, but wasted) work on the same photos.

**Superseded — two runners now run at once, on purpose.** The "operational,
not code" single-runner rule below was the original fix for the Mac Studio
move; it's since been superseded by real sharding, shipped in
`scripts/backfill-photo-tags.ts` in the same commit that introduced this
file (`--index`, paired with a hardcoded `SHARD_OF = 2` constant in source —
not a `--of` flag or a `.env` value, specifically so the two machines can
never disagree on the total the way a copied config value could). aorus
(`--index=0`, GPU) and Mac Studio (`--index=1`, CPU) each own a disjoint,
deterministic half of the pending queue (`isInShard`, hashed on each row's
UUID) — this isn't a `FOR UPDATE SKIP LOCKED`-style DB coordination problem
the way the original "two runners active at once" framing assumed; the
partition is collision-free by construction once both machines agree on
`SHARD_OF`, which they now always do because both run the same checked-out
source. A `--limit=N` flag exists to test a shard against a handful of real
rows before an unattended full run, and each sharded run logs the **total**
remaining `pending` count (unfiltered by shard) every fetch, so a
mis-partitioned run (impossible by construction now, but cheap insurance)
would be visible immediately instead of silently unnoticed.

Original text, kept for context on why the single-runner rule existed in
the first place:

**Chosen fix: operational, not code.** Since you're moving to Mac Studio (not
running both at once — confirmed), the fix is a single rule: **the backfill only
ever runs from Mac Studio going forward.** Don't kick it off from the laptop once
this is set up. That's sufficient given `fileLock.ts`'s own stated design
philosophy (single machine, single operator, manually triggered) — matches the
scope of what you actually asked for.

**Not building now (flagging for later, not doing it — YAGNI):** if you ever do
want two runners active at once, the real fix is turning the `SELECT` into an
atomic claim — e.g. `UPDATE ... SET tag_status = 'processing' WHERE id IN
(SELECT id FROM pinmap_place_photos WHERE tag_status = 'pending' LIMIT 50 FOR
UPDATE SKIP LOCKED) RETURNING id` via an RPC (same pattern already used
elsewhere in this codebase for `pinmap_photo_groups`'s ownership-check locking).
This turned out not to be the fix actually needed — the UUID-hash partition
above solves the real problem (rows being processed more than once) without
needing DB-level coordination at all.

## Status

The `@vladmandic/face-api` swap (CPU path) remains resolved as described above:
verified against real production photos, full local test suite passing,
`tsc -b` clean.

The GPU path on aorus and the two-way `--index` sharding are now implemented
(`FACE_DETECTOR_BACKEND=gpu`, `dist/face-api.node-gpu.js` deep import,
`@tensorflow/tfjs-node-gpu` as an `optionalDependency`, hardcoded
`SHARD_OF = 2`) but **not yet live-verified on real hardware** — `scripts/`
isn't covered by `tsc -b` (only `src/` is; verified separately via a
one-off `tsc --noEmit` invocation) and the automated test suite can't
exercise the real GPU backend or real Ollama connectivity. Before an
unattended production run, still owed, in order: `bun install` with the
optional GPU dependency on Mac Studio first (worse failure mode if bun
doesn't tolerate a failing optional postinstall), then aorus;
`FACE_DETECTOR_BACKEND=gpu` end-to-end against a handful of real photos
(`--limit=10`) to re-confirm the dual-runtime crash doesn't reappear under
the new import shape and to spot-compare `has_face` against the CPU path;
a deliberate Ollama-unreachable test to confirm a real outage aborts the
run instead of burning `tag_attempts`. Only then start both shards
unattended.

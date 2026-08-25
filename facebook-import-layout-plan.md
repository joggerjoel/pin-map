# Pin Map — Facebook Import Layout Plan

Companion to [idea.md](idea.md), [plan.md](plan.md), and [todo.md](todo.md).
Covers importing historical location data from a Facebook data export into
the **Personal Travel Map** — architecture, data flow, and the review/editor
UI needed because the source data is lossy and often ambiguous out of
context.

## Implementation tracking

A devils-advocate review noted this plan named no owning task for any of
its pieces, so wiring couldn't be verified from the plan alone. Every piece
below has a same-named section in
[facebook-import-layout-todo.md](facebook-import-layout-todo.md):

| Plan section                                                                     | Todo section                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `fb-import-upload` (`tusd`)                                                      | "P0 — `fb-import-upload` (`tusd`) resumable upload" |
| `fb-import-relay` (`/parse`, `/geocode`, `/photo`)                               | "P0 — `fb-import-relay` service"                    |
| `pinmap_import_candidates` + `pinmap_import_candidate_photos` / `import-staging` | "P0 — Schema & Storage"                             |
| Candidate lifecycle mechanics (approve RPC)                                      | "P0 — `approve_import_candidate()` RPC"             |
| Editor UX — Grid / year view                                                     | "P1 — Grid / year review view"                      |
| Editor UX — Swipe mode                                                           | "P1 — Swipe mode"                                   |
| Provisioning gaps noted throughout                                               | "P1 — Provisioning"                                 |
| Deployment (both containers)                                                     | "P2 — Deployment"                                   |
| Open questions                                                                   | "P3 — Follow-ups"                                   |

If a future edit adds a piece to either doc without a matching row/section
here, that's the same defect recurring — update this table alongside the
change, not after.

## What's actually in a Facebook export (found by inspection, 2026-08-24)

Before designing the pipeline, a real export
(`facebook-JoggerTech-2026-08-24-qBrGykc2`, HTML format, ~224MB) was
inspected directly:

- **`your_facebook_activity/posts/places_you_have_been_tagged_in.html`** is
  the gold vein — 160 check-in entries going back to 2011 (endurance-racing
  and travel history: Singapore, Hong Kong Disneyland, Busselton Western
  Australia, Oxfam Trailwalker, Moontrekker), of which **157 have an actual
  place name** — 3 have a visit time and nothing else, genuinely empty in
  the export itself (confirmed once the parser was written and tested
  against the real file, not a markup variant it fails to handle). Each
  usable entry is **place name +
  visit timestamp only** — no coordinates.
- **Zero `latitude`/`longitude` anywhere in the entire export**, and **no
  EXIF GPS on any exported photo** — Facebook strips both on upload and on
  export. Confirms the metadata-stripping problem this plan exists to solve.
- Some place names are ambiguous or meaningless without context ("Moontrekker
  Start Line", "圓方" — a Hong Kong mall in Chinese, "Oxfam Trailwalker
  Starting point") — geocoding them automatically and trusting the result
  would silently produce wrong pins. This is the reason a review/editor step
  is required, not optional.
- Recent activity (`your_posts__check_ins__photos_and_videos_1.html`,
  `your_photos.html`) is thin in this particular export (10 photos, 1 text
  post) — the real value is in the older check-in history, not recent posts.
- Other relevant files: `comments_and_reactions/*.html` (post/comment text,
  potentially useful as context for a check-in), `media/your_posts/*.jpg`
  (photos, filename-keyed, no embedded location).

## Decisions made during brainstorming

- **Target surface**: Personal Travel Map (`/`), not a separate surface —
  this is the owner's own travel/racing history, matching what
  [idea.md](idea.md) already describes.
- **Import scope**: check-ins **plus** linked posts/photos — for each
  check-in, posts/photos within a time window are matched in as optional
  context (note text, photos), not just bare name+date.
- **Editor location**: a new owner-only tab in the app ("Imports"), not a
  one-off script — reusable if another export is imported later.
- **Ingestion path**: an **in-app uploader**, not a local CLI script.
- **Parsing location**: a **small backend service** (like `notify-relay`),
  not client-side parsing — keeps the browser bundle light and is more
  robust for large exports.
- **Upload transport** (added after adversarial review flagged it as an
  unaddressed gap): `tusd` + `tus-js-client` for resumable/chunked upload,
  not a hand-rolled chunking protocol and not a plain single-shot multipart
  request — see the new `fb-import-upload` architecture piece below.

## Architecture

Four new pieces plus one Postgres RPC function, following existing pin-map
conventions:

### 0. `fb-import-upload` (`tusd`) — resumable upload front door

The real export is a 51-224MB zip, and the owner's connection is not
assumed reliable — a plain multipart upload has no way to recover from a
drop except restarting from byte zero, which a council review flagged as a
direct contradiction of this plan's own "robust for large exports" claim.
Fix: put a dedicated resumable-upload server in front of `fb-import-relay`
instead of hand-rolling chunking/offset-tracking.

- **`tusd`**, the official Go reference implementation of the
  [TUS resumable upload protocol](https://tus.io) — a standalone binary,
  language-agnostic, run as its own Docker container on `aorus4`. This
  mirrors the existing precedent of `voice-platform` being a standalone Go
  binary on the same host; it is not a new pattern for this box, and it
  keeps pin-map's own services `bun`-only per [idea.md](idea.md).
  **Not** paired with a Python client/server (`tus-py-client`/FastAPI) —
  wrong language for this stack.
- **`tus-js-client`** in the browser — the official JS client. It owns
  chunking, retry-with-backoff, and resume: on reconnect it queries `tusd`
  for the committed byte offset and continues from there, and it persists
  enough state in `localStorage` (keyed by a file fingerprint — size +
  type + last-modified, `tusd`'s default) to resume across a page reload,
  not just a network blip. This is the client-side half of the
  "reconcile local state against authoritative remote state" pattern —
  `tusd` already implements it, so pin-map doesn't need to build or
  persist its own `upload`/`upload_parts` tracking tables.
- **Storage backend**: `tusd`'s local-filesystem store, on a Docker volume
  shared with `fb-import-relay` — sufficient for a single-owner,
  occasional-use feature; no S3-compatible backend needed for v1.
- **Auth**: `tusd`'s single configured HTTP hook endpoint
  (`-hooks-http=http://fb-import-relay:PORT/tusd-hook`) receives every hook
  event (`pre-create`, `post-finish`, etc.) as one request, branching on the
  event type in its body — `tusd` doesn't support a distinct URL per event.
  On `pre-create`, `fb-import-relay`'s handler calls the exact same
  owner-gate logic `/parse` and `/geocode` already need, rejecting a
  non-2xx back to `tusd` for an unauthenticated or non-owner request before
  it can write any bytes to disk. This endpoint is not exposed publicly —
  only reachable from `tusd` on the internal Docker network. **Deployed and
  verified**: since `fb-import-relay` doesn't exist yet, the hook hostname
  is currently unresolvable, and this was confirmed to fail closed — every
  upload attempt gets a `500` and nothing is written to the shared volume,
  not silently accepted.
- **Retention**: the assembled zip on the shared volume is deleted once
  `fb-import-relay`'s `/parse` has successfully read it (or after a fixed
  TTL if `/parse` is never called) — no indefinite retention of a personal
  data export on disk.
- **Handoff to `fb-import-relay`**: no webhook needed. Once `tus-js-client`
  reports the upload complete, the **browser** calls `fb-import-relay`'s
  `POST /parse` with the `tusd` upload ID (not raw file bytes) —
  `fb-import-relay` reads the assembled file directly off the shared
  volume by that ID. This keeps the browser as the single orchestrator of
  the whole import flow, consistent with every other step.

### 1. `fb-import-relay` — new backend service

Bun service, same pattern as `notify-relay` (`Bun.serve`, own Docker
container, deployed to `aorus4`, its own port). **Stateless and
Supabase-agnostic** — it never holds a service-role key and never writes to
Supabase directly.

**Split into two endpoints, not one**, so Mapbox geocoding — the only
metered, billable step — never runs before the browser has had a chance to
say "I already have this one":

#### `POST /parse` — free, no Mapbox calls

1. Accept a **`tusd` upload ID** (JSON body, not raw file bytes — the zip
   already arrived resumably via `fb-import-upload`/`tusd`, see above), read
   the assembled file off the shared volume, gated by the owner's Supabase
   access token (verified server-side against GoTrue, checked against
   `pinmap_owner` — this same check backs the `pre-create` branch of
   `/tusd-hook`, which `tusd` calls before it accepts any bytes, so
   ownership is enforced both at upload time and at parse time).
2. Unzip **only** the relevant files — `places_you_have_been_tagged_in.html`,
   `your_posts__check_ins__photos_and_videos_*.html`, `your_photos.html`,
   `comments_and_reactions/*.html`, and photos under `media/your_posts/` —
   everything else in the zip (ads info, messages, security logs, etc.) is
   ignored and never unpacked.
3. Parse check-ins (name + visit_time) from the tagged-places file.
4. Correlate posts/photos to each check-in by timestamp proximity (default
   window: ±3 days) — best-effort suggestion only, always editable/removable
   in review.
5. Compute `external_key` server-side (`hash(normalized place_name +
visit_time)`) for each check-in — the relay owns this, not the browser,
   so a client can't influence the dedupe key (closes the trust-boundary gap
   a red-team review flagged).
6. Return a JSON array of **candidates** — `external_key`, `place_name`,
   `visit_time`, matched note text, and matched photos as **references**
   (`{filename}`) — **no photo bytes, no `lat`/`lng`, no Mapbox call made**,
   no Supabase writes happen here.
7. Keep the matched photo files (only those — not the rest of the unzipped
   export, not the original zip) in a short-lived per-upload cache
   directory on the shared volume, cleaned up on a fixed TTL (e.g. 24h) by
   a periodic sweep, independent of whether every photo was ever fetched.

Browser inserts these into `pinmap_import_candidates` immediately
(`status=pending`, `suggested_lat`/`suggested_lng` left `null`), deduped on
`external_key` against whatever's already there from a prior run (an
`insert ... on conflict (user_id, external_key) do nothing`, not a plain
insert that could error on a partial-retry's already-inserted rows). This
step alone is idempotent and free to retry as many times as a flaky
connection requires — nothing costs money yet, and no photo bytes have
moved anywhere yet either.

#### `GET /photo/:tusUploadId/:filename` — lazy photo fetch

A candidate's matched photos are only ever fetched **when the browser
actually needs them** — a candidate card being opened for review, not all
150+ candidates' photos eagerly on `/parse` response. Streams raw bytes
(no base64, no JSON envelope), gated by the same owner check. The browser
re-uploads what it receives directly to `import-staging` as raw bytes —
photo bytes are never base64-encoded at any point in this pipeline (a
code-quality review flagged the original all-eager-base64-in-JSON design as
both wasteful — ~33% payload inflation for images most candidates will
never even be opened to view — and a browser-memory risk at scale).

#### `POST /geocode` — the only step that spends money

Browser then computes which of the just-inserted (or previously
un-geocoded) candidates actually still need coordinates — i.e. `lat`/`lng`
still `null` — and sends **only that de-duplicated set** of `{external_key,
place_name}` pairs.

1. Geocode each **unique, normalized** place name via Mapbox (in-batch
   coalescing: three check-ins that all say "Busselton, Western Australia"
   cost one Mapbox call, not three), with a bounded concurrency worker pool
   and a hard per-request cap on how many names one call will process
   (returns a `truncated: true` flag past the cap rather than an unbounded
   request).
2. Return `{external_key, lat, lng, confidence}` per input pair.

Browser writes the results back onto the matching candidate rows. **A
retried upload, a retried parse, or a re-uploaded overlapping export never
re-triggers a Mapbox call for a place name that's already priced in** —
`/parse` is free and idempotent, and `/geocode` is only ever asked about the
subset the browser has confirmed it doesn't already have coordinates for.

### 2. `pinmap_import_candidates` + `pinmap_import_candidate_photos` (new tables)

Owner-scoped staging tables, same RLS shape as `pinmap_pinned_places`
(`auth.uid() = user_id` for select/insert/update/delete).

```
pinmap_import_candidates
id                  uuid primary key default gen_random_uuid()
user_id             uuid not null references auth.users(id)
external_key        text not null       -- server-computed by fb-import-relay's /parse (hash of normalized place_name + visit_time), for re-import dedupe
place_name          text not null       -- editable
suggested_lat       double precision    -- null until /geocode responds, or if geocoding failed
suggested_lng       double precision
geocode_confidence  text                -- null = not yet geocoded; 'high' | 'low' | 'failed' once /geocode has responded
visit_time          timestamptz not null
note                text                -- editable, from matched post/comment text
status              text not null default 'pending'  -- pending | later | approved | rejected | split | merged
related_candidate_id uuid references pinmap_import_candidates(id)  -- split child -> parent, or merge loser -> survivor
approved_pin_id     uuid references pinmap_pinned_places(id)       -- set atomically by approve_import_candidate()
created_at          timestamptz not null default now()
resolved_at         timestamptz
unique (user_id, external_key)

pinmap_import_candidate_photos
id            uuid primary key default gen_random_uuid()
user_id       uuid not null references auth.users(id)
candidate_id  uuid not null references pinmap_import_candidates(id) on delete cascade
storage_path  text not null       -- object path within import-staging
created_at    timestamptz not null default now()
```

`status` has six values, not three — the extra three (`later`, `split`,
`merged`) exist because the Editor UX below promises features (swipe
mode's "later", Split, Merge) a three-value enum couldn't represent; an
architecture/devils-advocate review caught this as an unreachable-feature
defect in an earlier draft. See "Candidate lifecycle mechanics" below for
exactly how each transition works.

### 3. `import-staging` storage bucket (new)

Candidate photos live here, lazily uploaded by the browser only once a
candidate is actually opened for review (fetched via `fb-import-relay`'s
`GET /photo/...`, re-uploaded as raw bytes — no base64 detour anywhere).
Same owner-scoped policies as `pin-photos`, but **not public** — unlike
`pin-photos`, nothing here should be readable before a human has approved
the candidate it belongs to.

The **browser** is what writes to Supabase (staged candidates + staged
photos, using the owner's existing authenticated session) — not the relay
service. This keeps RLS enforcement exactly as strict as it already is for
`pinmap_pinned_places`; the relay is a pure parser/geocoder proxy.

## Data flow

```
Browser (tus-js-client) → tusd, resumable/chunked
  → tusd pre-create event → fb-import-relay POST /tusd-hook (owner check)
  → tusd persists offset/state itself; survives disconnects/reloads
  → on completion, assembled zip sits on the shared volume, keyed by upload ID
Browser → fb-import-relay POST /parse { tusUploadId }   (free — no Mapbox calls)
  → read assembled zip off the shared volume by upload ID
  → unzip target files only
  → parse check-ins (name, visit_time)
  → for each check-in, find posts/photos within ±3 days → attach as note/photos
  → compute external_key server-side per check-in
  → return JSON candidates, lat/lng omitted (photos as filename references)
  → keep matched photo files in a short-lived per-upload cache (TTL cleanup)
Browser
  → insert into pinmap_import_candidates (status=pending, lat/lng=null),
    deduped on external_key (on conflict do nothing) — safe to retry for free
  → collect external_key+place_name for every row still missing lat/lng
  → fb-import-relay POST /geocode with just that de-duplicated set
    (in-batch coalesced by normalized name, capped per request)
  → write {lat, lng, confidence} back onto the matching candidate rows
"Imports" tab (owner-only)
  → triage: split into "high-confidence" (bulk-approvable) vs "needs review"
    (only rows with a non-null geocode_confidence are triaged; still-ungeocoded
    rows show as "geocoding…")
  → opening a candidate card lazily fetches its photos via
    fb-import-relay GET /photo/... and stages them into import-staging
  → work the "needs review" pile via grid view or swipe mode (see below)
  → Approve → approve_import_candidate() RPC (atomic: pin row + status),
    then a separate retriable step attaches staged photos (see below)
  → Reject → marks candidate rejected, deletes staged photos (candidate
    row itself kept, not hard-deleted, for undo/audit)
```

## Candidate lifecycle mechanics

Postgres and Supabase Storage can't share a transaction, so approve is
deliberately two steps rather than one — a reliability review flagged the
original single-step "writes a pin row + copies photos + inserts photo rows

- marks approved" description as a 4-part write with no transaction or
  idempotency guard, able to leave a candidate stuck half-approved on a
  dropped connection.

### Approve

1. **`approve_import_candidate(candidate_id)`**, a Postgres RPC (runs under
   the caller's own RLS, not a service role). In one transaction: validates
   the candidate is `pending` or `later` **and** has non-null
   `suggested_lat`/`suggested_lng` (server-side enforcement that a
   candidate can never become a pin without coordinates — a security
   review found the earlier draft only enforced this in the UI, not at the
   write path), upserts `pinmap_pinned_places`
   (`on conflict (user_id, query) do nothing returning id`, falling back to
   a plain `select id` on conflict so a retried call is idempotent — never
   creates a duplicate pin), and sets the candidate's `status = 'approved'`
   plus `approved_pin_id` to the resulting pin's id. No storage writes
   happen in this step — it alone is what makes "approved" durable, and it
   can never leave a candidate half-approved.
2. **Photo attachment** — a separate, safely-retriable client step run
   right after: for each of the candidate's
   `pinmap_import_candidate_photos` rows, copy the staged object into
   `pin-photos`, insert a `pinmap_place_photos` row referencing
   `approved_pin_id`'s `query`, then delete the staged object. Retriable
   per-photo: if interrupted after 2 of 3, the pin already exists correctly
   (step 1 already committed), and the UI shows "2 of 3 photos attached,
   retry" rather than the whole approval being in doubt.

### Reject

Marks `status = 'rejected'`, deletes any staged photos for that candidate.
The candidate row itself is kept (not hard-deleted) for the "show
rejected" audit toggle.

### Later (swipe mode)

Marks `status = 'later'` — a real, queryable state distinct from an
untouched `pending` row, so the revisit pile and the "N reviewed" progress
count in the Order picker (below) are both accurate instead of conflating
"never looked at" with "looked at, deferred."

### Split into separate pins

The original candidate's `place_name`/`visit_time` are untouched — it's
kept at `status = 'split'` (not deleted), which is what keeps
`unique(user_id, external_key)` satisfied on re-import: a re-parsed export
produces the same `external_key` again, the dedupe insert finds it already
exists as a resolved `split` row, and skips it — exactly like an approved
or rejected row would.

N new child candidates are inserted, each with:

- `external_key` = `{parent_external_key}::split-{n}` — deterministic,
  collision-free, computed client-side (this is a self-service editing
  action on data already in Supabase, not part of the Mapbox-spend-sensitive
  `/parse`/`/geocode` path, so there's no trust-boundary concern in
  computing it in the browser here).
- `related_candidate_id` = the parent's id.
- Independently editable `place_name`, independently searchable/pinnable —
  any child still missing `lat`/`lng` goes through the exact same
  dedupe-before-spend `/geocode` path as any other new candidate.
- All of the parent's `pinmap_import_candidate_photos` rows duplicated
  (same `storage_path`, new `candidate_id` per child — the underlying
  storage object isn't copied, just re-referenced, so removing a photo from
  one child's thumbnail strip doesn't affect the others).

### Merge (inverse of split)

Selected candidates are consolidated: one survivor keeps its row and
absorbs the others' photos (its `pinmap_import_candidate_photos` rows get
copied onto the survivor's `candidate_id`, same re-reference-not-copy
approach as split); the losers are marked `status = 'merged'` with
`related_candidate_id` pointing at the survivor (kept, not deleted, for the
same re-import-dedupe reason as split). Note text isn't auto-merged — a
human is looking at both cards already, and can edit the survivor's note
directly.

## Editor UX

Two complementary ways to work the same underlying queue — not an either/or:

### Grid / year view

- Landing view shows a triage split on what's actually computed:
  high-confidence (`geocode_confidence = 'high'`, one-click bulk-approve)
  vs. needs-review (`geocode_confidence` is `'low'`/`'failed'`, or still
  `null` — shown as "geocoding…", not lumped into needs-review). Earlier
  drafts described this split as "no conflicts" vs. "grouped," implying an
  automatic classification — there isn't one; a human decides via
  Split/Merge, not a pre-detection step.
- The "needs review" pile is grouped by year, collapsed by default, so a
  multi-year export never renders as one endless flat wall.
- Each candidate card: editable place name, a small map with a draggable pin
  (or a manual search box if geocoding failed or looks wrong), the visit
  date, the matched note as editable text, a thumbnail strip of matched
  photos (individually removable), Approve/Reject.
- **Manual placement**: typing in the search box shows live Mapbox
  search-as-you-type results (same experience as the app's existing "paste
  places" flow) to pick from; clicking directly on the map drops an exact
  pin regardless of search.
- **Split into separate pins**: when one Facebook entry actually covers
  multiple real locations (e.g. a race weekend with a start line, a
  checkpoint, and a finish line all in one grouped note), a "Split into
  separate pins" action turns it into N independent cards, each with its own
  search/pin/approve flow. Mechanics: see "Candidate lifecycle mechanics"
  above.
- A checkbox lets several cards be selected and merged into one pin (inverse
  of split — e.g. three "Busselton" entries within days of each other).
  Mechanics: see "Candidate lifecycle mechanics" above.

### Swipe mode (Tinder-style)

- One card at a time from the "needs review" pile. Drag or use buttons/arrow
  keys: **reject** (`status='rejected'`, removed from queue, kept for
  undo), **later** (`status='later'`, pushed back or filtered into a
  separate revisit pile — never forces a decision), **approve**
  (`approve_import_candidate()` RPC, becomes a real pin immediately).
- Good for quick 5-minute passes; grid view is better for a focused sitting
  working through a whole year.

### Order picker (shared by both modes)

- **Newest first (default)** — recent trips are freshest in memory and
  easiest to place/correct confidently; patterns fixed on recent entries
  (e.g. "all my Hong Kong race check-ins need this treatment") make older
  ones faster too.
- **Oldest first** — chronological, for working through the origin story in
  order.
- **Random** — shuffled draw from whatever's left, for chipping away without
  the commitment of finishing a whole year.
- Progress ("54 of 157 reviewed") counts every candidate whose `status` is
  no longer `'pending'` — `later`/`approved`/`rejected`/`split`/`merged` all
  count as reviewed, so a deferred ("later") card correctly counts as
  looked-at even though it's still awaiting a final decision. Persists
  across order changes. An untouched `pending` row stays saved indefinitely
  — no session/expiry pressure; review 5 a day or all at once.

## Edge cases

- **Geocode fails or is ambiguous** (foreign-script names, generic race
  terminology): candidate ships with no lat/lng pre-filled, forcing manual
  search/placement — never silently guesses.
- **No post/photo match found**: candidate still shows, just with no
  note/photos attached.
- **Re-running the import against the same (or overlapping) export**: deduped
  on `external_key` (server-computed hash of normalized place_name +
  visit_time), so re-upload never creates duplicate candidate rows.
- **Retried upload/parse after a dropped connection** (the scenario this
  design exists to survive): `/parse` never calls Mapbox, so retrying it is
  free. `/geocode` is only ever asked about candidates still missing
  `lat`/`lng`, so a retry never re-pays for a place name already priced in
  — this holds whether the retry is a fresh `/parse` call or the browser
  simply re-submitting the same un-geocoded rows.
- **Rejected candidates**: kept, not hard-deleted, so what got excluded is
  reviewable later (a "show rejected" toggle, off by default). Staged
  photos are deleted immediately on reject — resolved, not left open (see
  former Open Question below).
- **Split/merged candidates on re-import**: the original row stays at
  `status = 'split'`/`'merged'` (never deleted), so its `external_key`
  re-appearing in a later `/parse` response is caught by the normal dedupe
  insert and never resurrects it as a fresh `pending` row.
- **Approve retried after a dropped connection**: the RPC's
  `on conflict (user_id, query) do nothing` makes re-running
  `approve_import_candidate()` for an already-approved candidate a no-op
  that returns the existing pin id, not a duplicate pin.

## Testing

Matches the project's TDD convention:

- Parser unit tests using the real export's HTML as fixtures (already
  present locally at `facebook-export/`).
- Correlation-window test (posts/photos within the timestamp window get
  matched; outside it, they don't).
- Zip-slip test: a crafted entry path that would resolve outside the
  extraction root is rejected regardless of matching the filename allow-list.
- RLS tests for `pinmap_import_candidates`, `pinmap_import_candidate_photos`,
  and the `import-staging` bucket — owner-only, mirroring the existing
  `pinmap_pinned_places` RLS tests. Confirms `import-staging` is genuinely
  non-public (unlike `pin-photos`).
- `approve_import_candidate()` idempotency test: calling it twice for the
  same candidate produces exactly one `pinmap_pinned_places` row.
- `approve_import_candidate()` validation test: rejects a candidate with
  null `suggested_lat`/`suggested_lng`, regardless of what the UI would
  normally prevent.
- Photo-attachment retry test: interrupting after N of M photos, then
  retrying, results in exactly M photos attached, no duplicates.
- Split test: splitting a candidate produces N children with distinct,
  deterministic `external_key`s, the parent lands at `status='split'`, and
  re-parsing the same export afterward produces zero new rows for that
  `external_key`.
- Merge test: merging N candidates leaves one survivor and N-1 rows at
  `status='merged'`, each with `related_candidate_id` pointing at the
  survivor.
- Dedupe test: re-importing the same export produces zero new candidates for
  already-seen `external_key`s.

## Open questions

- Whether `geocode_confidence` is a simple three-value enum (as sketched
  above) or a numeric Mapbox relevance score exposed directly to the UI for
  finer triage thresholds.
- Correlation window default (±3 days) is a starting guess — may need tuning
  once real matching is tried against the fixture export.
- Exact TTL for the `fb-import-relay` photo cache and the `tusd` shared-volume
  assembled-zip retention (both sketched as "e.g. 24h" — needs a concrete
  number picked at implementation time).

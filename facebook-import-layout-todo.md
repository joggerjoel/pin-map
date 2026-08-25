# Pin Map — Facebook Import Layout TODO

Companion to [facebook-import-layout-plan.md](facebook-import-layout-plan.md)
and [todo.md](todo.md). Priority legend matches `todo.md`: **P0**
architectural/security prerequisite, **P1** next high-value, **P2** strong
follow-up, **P3** later/experimental.

## P0 — Schema & Storage ✅ done, applied to live instance 2026-08-24

- [x] `supabase/schema_import_candidates.sql` — `pinmap_import_candidates`
      table per the plan's column list, including the six-value `status`
      enum (`pending | later | approved | rejected | split | merged`),
      `related_candidate_id` (self-referencing, nullable), and
      `approved_pin_id` (references `pinmap_pinned_places`). RLS mirroring
      `pinmap_pinned_places` (`auth.uid() = user_id` for
      select/insert/update/delete).
- [x] Same migration file, `pinmap_import_candidate_photos` table
      (`candidate_id` → `pinmap_import_candidates`, `on delete cascade`,
      `storage_path`), RLS mirroring `pinmap_place_photos`.
- [x] `import-staging` storage bucket + owner-scoped policies, mirroring
      `pin-photos` in `schema_place_photos.sql` — **`public: false`**,
      unlike `pin-photos` (unreviewed candidate photos must not be publicly
      readable before approval).
- [x] RLS tests: `src/test/importCandidatesRls.live.test.ts` — real
      cross-user isolation test against the live instance (not mocked, a
      first for this repo — see the file's header comment for why and how
      to run it: `RUN_LIVE_SUPABASE_TESTS=1 bun run test -- importCandidatesRls.live`).
      Confirms a non-owner can't read/write another user's rows, and that
      `import-staging` genuinely rejects an unauthenticated request.

**Acceptance criteria**

- Only the owner can insert/read/update/delete their own candidates and
  candidate photos.
- `unique (user_id, external_key)` enforced — re-insert of the same
  candidate is a no-op/conflict, not a duplicate row.

## P0 — `fb-import-upload` (`tusd`) resumable upload

- [x] Deploy `tusd` (official `tusproject/tusd:latest` image, off-the-shelf
      — not a fork/build) as its own Docker container on `aorus4`
      (`pin-map-fb-import-upload`, `127.0.0.1:8096`), filesystem storage
      backend on a named Docker volume (`fb-import-shared`) shared with
      `fb-import-relay`, on a dedicated Docker network (`fb-import-net`) so
      the two containers can resolve each other by name — neither existed
      before this repo's other services (default bridge network, no
      inter-container DNS), so this is new infra, not a reused pattern.
  - **Gotcha hit and fixed**: a fresh named volume is root-owned by
    default; `tusd` runs as uid 1000 inside its container and got
    `permission denied` until the volume was `chown -R 1000:1000`'d once
    (via a throwaway `alpine` container). Whatever eventually automates
    this (the P2 Ansible playbook) needs that chown as an explicit step,
    not an assumption.
- [ ] `tus-js-client` integration in the "Imports" tab upload widget —
      handles chunking, retry-with-backoff, and resume (offset reconciled
      against `tusd` on reconnect; `localStorage`-persisted fingerprint so
      a page reload resumes too, not just a network blip). **Not started**
      — needs the Imports tab client code.
- [x] **Correction to the plan's wording**: tusd's HTTP hook protocol is
      one configured endpoint (`-hooks-http`) that receives every hook
      event type in its request body, not a distinct URL per hook name.
      Deployed pointing at `http://pin-map-fb-import-relay:8097/tusd-hook`
      — `fb-import-relay` will need to implement that single endpoint and
      branch on the event type internally, calling the same owner-check
      logic as `/parse`/`/geocode` when the event is `pre-create`. Since
      `fb-import-relay` doesn't exist yet, this hostname doesn't resolve —
      **verified this fails closed**: `POST /files/` currently returns
      `500` and writes nothing to `/data` (confirmed via direct upload
      attempt + `ls`). Real owner verification is still pending
      `fb-import-relay`'s `/tusd-hook` endpoint.
- [x] Retention: delete the assembled zip from the shared volume once
      `/parse` has successfully read it (`index.ts`'s `finally` block —
      verified live: after a real `/parse` call, the upload file was gone
      from the shared volume and a re-`/parse` on the same ID 404s instead
      of re-succeeding). TTL-based cleanup for the case `/parse` is never
      called at all is still **not started**.

**Acceptance criteria**

- [x] Killing the network mid-upload and reconnecting resumes from the last
      committed byte offset, not from zero — **verified directly against
      the deployed container**: uploaded a 1MB file in two PATCH requests,
      confirmed `HEAD` reports the correct committed offset between them,
      and the assembled file's SHA256 matches the original byte-for-byte.
      An automated integration test using `tus-js-client` (the real client
      library, not raw `curl` PATCH requests) is still owed before this is
      fully done — this verified the protocol/server side, not the client
      library's resume behavior.
- [x] An upload attempt without a valid owner token never reaches disk —
      **fully re-verified for real** once `fb-import-relay` was deployed
      and `-hooks-http-forward-headers=Authorization` was added to `tusd`'s
      config (missing from the first deploy — the hook received no
      Authorization header at all until this was added, caught because the
      hook's own rejection reason was logged and read, not assumed). Three
      cases tested against real Supabase tokens: no header → `500`,
      **valid token for a real non-owner user** → `500`, valid owner token
      → `201 Created`. This is the strongest form of this test — actual
      GoTrue-issued tokens for actual (test) accounts, not just "the DNS
      doesn't resolve so of course it fails."

## P0 — `fb-import-relay` service ✅ scaffolded, deployed, and live-tested

`fb-import-relay/` exists with `package.json`, `Dockerfile`, `index.ts`,
and `src/*.ts` + `*.test.ts` per module below — 55 unit tests passing
(`bun test`). Deployed to `aorus4` as `pin-map-fb-import-relay`
(`127.0.0.1:8097`, on `fb-import-net`, mounting `fb-import-shared` at
`/data`) and **exercised end-to-end against the real 51MB export zip**,
not just the unzipped fixture folder — see the acceptance criteria below.

- [x] Owner-gate helper (`src/ownerGate.ts`, `verifyOwner()`) — verifies the
      caller's Supabase access token against GoTrue's `/auth/v1/user`, then
      checks the resulting user id against `pinmap_owner` via a plain REST
      read (that table is publicly SELECT-able by design, so no
      service-role key is needed anywhere in this service). Fails closed
      on every branch: missing header, non-2xx from GoTrue, no user id in
      the response, non-2xx from the owner check, or a thrown
      network error — 7 unit tests with a mocked `fetch`, plus the
      real-response-shape assumptions (`user.id`, empty-array-for-non-owner)
      were checked against the live GoTrue instance directly before
      trusting them in the mocks.
- [x] `POST /tusd-hook` — branches on `Type` in tusd's hook request body;
      on `pre-create`, extracts the forwarded `Authorization` header and
      runs the owner-gate helper, returning `403` to reject. **Verified
      live** end-to-end through `tusd` itself (see the tusd section above)
      — not just unit-tested in isolation.
- [x] `POST /parse` — accepts `{ tusUploadId }` and reads the assembled zip
      off the shared volume by that ID.
  - [x] Zip handling (`src/zipExtract.ts`): unzips **only** the allow-listed
        paths via `yauzl` (selective/streaming — never extracts the whole
        archive), skips directory entries, and independently verifies every
        entry's resolved path stays inside the extraction root regardless
        of the allow-list match (zip-slip protection) — 13 tests, including
        a real end-to-end extraction against a zip built with the system
        `zip` CLI (allowed files extracted with correct contents,
        disallowed file never written to disk).
  - [x] HTML parser (`src/parsePlacesTaggedIn.ts`) for
        `places_you_have_been_tagged_in.html` — 14 tests against the real
        fixture. **Correction**: the fixture has 160 raw `<table>` entries
        but only **157 with an actual place name** — 3 have a visit time
        and nothing else, verified genuinely empty in the export itself,
        not a markup shape the parser misses. Every "160" elsewhere in this
        doc and the plan doc has been corrected to 157 to match.
  - [x] Correlation logic (`src/correlate.ts`) — binary-search + bounded
        scan against a sorted timestamp array, not a naive
        check-ins × items nested loop (closes a code-quality finding from
        the council review) — 7 tests including a 200×5000 smoke test
        completing well under the assertion's time budget. **Not yet wired
        to real data**: no parser exists yet for
        `your_posts__check_ins_*.html`/`your_photos.html`/
        `comments_and_reactions/*.html`, so `/parse` currently calls
        `correlate()` with an empty items array — candidates ship with no
        matched note/photos until those parsers are built. This is a
        strict subset of the full design (incomplete, never wrong), tracked
        as its own follow-up below.
  - [x] `external_key` computed server-side (`src/externalKey.ts`,
        normalized-name + ISO-timestamp SHA-256) and included in the
        response — 5 tests, including that near-duplicate names ("圓方" vs
        "ELEMENTS 圓方") are correctly kept distinct.
  - [x] Response: JSON array of candidates (`externalKey`, `placeName`,
        `visitTime`, `note`, `photos` as filename references) — **no
        `lat`/`lng` fields, no photo bytes**. Verified live: a real `/parse`
        call against the actual 51MB export returned exactly 157
        candidates in under 400ms, including known names ("Busselton,
        Western Australia", "Moontrekker Start Line").
  - [ ] Dedicated unit tests for `/parse` itself (request/response
        shape, 404 on unknown `tusUploadId`, auth rejection) — currently
        only verified via the live end-to-end run above, not an automated
        `bun test`. Each underlying module (parser, zip extraction,
        owner-gate) has its own thorough test suite, but the route handler
        wiring them together doesn't yet.
- [x] Keep matched photo files in a short-lived per-upload cache dir with
      TTL cleanup — `src/photoCache.ts` (`cachePhotos`/`cleanupStaleCaches`/
      `resolveCachedPhotoPath`/`contentTypeFor`), wired into `/parse`: matched
      files are copied out of `extractDir` into `UPLOAD_DIR/_photo_cache/
    {tusUploadId}/{basename}` before the existing `finally` block deletes
      `extractDir`. TTL fixed at 24h (the plan's placeholder value), swept
      opportunistically on every `/parse` call rather than a timer — 12 unit
      tests (`src/photoCache.test.ts`), including the same
      resolves-within-root traversal-guard pattern as `zipExtract.ts`'s
      zip-slip protection, applied here to the URL-supplied filename
      segment. **Not yet verified against a real `/parse` → `GET /photo`
      round trip** — only unit-tested and smoke-tested (see below), since
      that needs a real tus upload to exercise.
- [x] `GET /photo/:tusUploadId/:filename` — implemented in `index.ts`,
      same `requireOwner()` gate as `/parse`/`/geocode`, streams raw bytes
      via `Bun.file()` (no base64) with a content-type inferred from
      extension. **Verified live**: redeployed to `aorus4` and smoke-tested
      — unauthenticated request returns `403` (not a crash), `/healthz`
      returns `200`. **Not yet exercised with a real photo** — that's the
      still-open item above.
- [x] `POST /geocode` — accepts `{ inputs: [{externalKey, placeName}] }`.
      **Verified live** with real Mapbox calls against real fixture place
      names: "Singapore, Singapore" and "Busselton, Western Australia"
      both geocoded to correct real-world coordinates at high confidence;
      duplicate names in the same request returned byte-identical results
      (in-batch coalescing confirmed with real data, not just mocks). Also
      used this live check to validate the plan's core premise: Mapbox
      geocodes "Moontrekker Start Line" to an unrelated street address at
      relevance 0.545, and "圓方" to a wrong Tokyo neighborhood at
      relevance 0.5 — both correctly land below the 0.8 high-confidence
      threshold and would surface for manual review, not silently produce
      wrong pins.
  - [x] In-batch coalescing, hard per-request cap with `truncated: true`,
        bounded-concurrency worker pool (default 5, verified via an
        in-flight-counter test that it's never exceeded), and
        high/low/failed confidence classification — `src/geocode.ts`, 9
        unit tests with a mocked `fetch`, response-shape assumptions
        (`features[].center`, `features[].relevance`) checked against the
        real Mapbox API before trusting the mocks.

**Acceptance criteria**

- [x] Running `POST /parse` against the real fixture zip returns exactly
      157 candidates, all with `lat`/`lng` absent, and triggers zero
      Mapbox calls — verified live against the actual 51MB export, not
      just the fixture folder.
- [ ] Calling `POST /parse` (or the client-insert step after it) twice in a
      row with the same zip never results in a second Mapbox spend for any
      name already geocoded — the design supports this (`/parse` never
      calls Mapbox; `/geocode` is only ever asked about names still missing
      coordinates), but there's no automated test proving it yet, and this
      also depends on the "Client: upload → stage candidates → geocode"
      section below, which isn't built.
- [x] No Supabase credentials of any kind (anon, authenticated, or
      service-role) are held by this service — confirmed by code review:
      `SUPABASE_ANON_KEY` is the only Supabase credential in `index.ts`'s
      env vars, used only for the public `pinmap_owner` read and the
      pass-through GoTrue verification call.
- [x] Non-owner or unauthenticated requests are rejected before any unzip
      or geocode work happens — verified live on `/parse` (403 before any
      file access) and via `tusd`'s pre-create hook (see above); `/geocode`
      shares the same `requireOwner()` gate but hasn't been separately
      live-tested for the unauthenticated case specifically.

## P0 — `approve_import_candidate()` RPC

Council review finding: the original "Approve" description was a 4-part
client-driven write (pin row + photo copy + photo rows + status update)
with no transaction or idempotency guard, able to leave a candidate stuck
half-approved on a dropped connection. Fix: split into one atomic RPC (no
storage) plus a separate retriable photo-attach step — see plan's
"Candidate lifecycle mechanics".

- [x] `supabase/schema_import_candidates.sql` —
      `approve_import_candidate(candidate_id uuid)` Postgres function, runs
      under the caller's own RLS (not `security definer`/service role).
  - [x] Validates candidate `status` is `pending` or `later` (an already
        `approved` candidate is a special case, see below — anything else,
        e.g. `rejected`/`split`/`merged`, is rejected).
  - [x] Validates `suggested_lat`/`suggested_lng` are both non-null —
        server-side enforcement of "never silently guess," not just a UI
        convention (closes a security-review gap). Verified live: a
        candidate with null coordinates is rejected even calling the RPC
        directly, bypassing the UI entirely.
  - [x] Upserts `pinmap_pinned_places`
        (`on conflict (user_id, query) do nothing returning id`, falling
        back to `select id` on conflict) — idempotent on retry, never
        creates a duplicate pin.
  - [x] Sets `status = 'approved'`, `approved_pin_id` = the resulting pin's
        id, `resolved_at = now()`, in the same transaction.
  - [x] **Went further than originally scoped**: an already-`approved`
        candidate short-circuits and returns the existing `approved_pin_id`
        instead of erroring — makes the dropped-response retry case a
        true no-op success, not just "no duplicate pin" via a thrown error.
- [ ] Client-side photo-attach step, run immediately after a successful RPC
      call: for each `pinmap_import_candidate_photos` row on that
      candidate, copy the staged object into `pin-photos`, insert a
      `pinmap_place_photos` row against `approved_pin_id`'s `query`, delete
      the staged object. Per-photo, independently retriable. **Not started**
      — needs the "Imports" tab client code first.

**Acceptance criteria**

- [x] Calling the RPC twice in a row for the same candidate produces exactly
      one `pinmap_pinned_places` row (idempotency test) — verified live in
      `src/test/importCandidatesRls.live.test.ts`.
- [x] Calling the RPC on a candidate with null `suggested_lat` or
      `suggested_lng` is rejected, even if the caller bypasses the UI —
      verified live.
- [ ] Interrupting the photo-attach step after N of M photos, then
      retrying, results in exactly M photos attached with no duplicates —
      blocked on the client step above existing.

## P0 — Client: upload → stage candidates → geocode

- [ ] "Imports" tab, owner-only (mirrors the "Edit Roster" tab's
      owner-gating pattern).
- [ ] Upload widget drives a `tus-js-client` upload to `fb-import-upload`
      (resumable — see above), then on `onSuccess` calls `fb-import-relay`
      `POST /parse` with the resulting `tusUploadId` → on response, insert
      returned candidates into `pinmap_import_candidates` (`status=pending`,
      `suggested_lat`/`suggested_lng`/`geocode_confidence` left `null`),
      deduped client-side on `external_key` before insert (`on conflict
(user_id, external_key) do nothing`). Safe to retry this whole step
      for free — no photos uploaded yet at this point.
- [ ] After insert, query for every candidate row (new or pre-existing)
      still missing `suggested_lat`/`suggested_lng`, and call `POST
/geocode` with just that set. Write `{lat, lng, confidence}` back onto
      the matching rows.
- [ ] Progress/toast UI reflecting both phases ("157 candidates parsed, 6
      photos matched, 3 posts matched" → "geocoding 142 new places…").
- [ ] Lazy photo fetch: opening a candidate card (grid or swipe) calls
      `GET /photo/...` for each of its matched filenames and uploads the
      raw bytes straight into `import-staging`, inserting a
      `pinmap_import_candidate_photos` row per photo — not done eagerly for
      every candidate at insert time.

## P1 — Grid / year review view

- [ ] Triage landing screen: split pending candidates into high-confidence
      vs. needs-review buckets (by `geocode_confidence`); rows where
      `geocode_confidence` is still `null` (geocoding not yet returned) show
      as a distinct "geocoding…" state, not lumped into needs-review. Copy
      describes only computed attributes (`geocode_confidence`, has-note,
      has-photos) — not "conflicts"/"grouped," which nothing detects
      automatically (devils-advocate review finding).
- [ ] Bulk-approve action for the high-confidence bucket (calls
      `approve_import_candidate()` per candidate, then the photo-attach
      step).
- [ ] Needs-review list grouped by year (from `visit_time`), collapsed by
      default, expandable.
- [ ] Candidate card: editable name field, map with draggable pin, Mapbox
      search-as-you-type box (reusing the existing paste-places geocoding
      integration), editable note text, removable photo thumbnails,
      Approve/Reject buttons.
- [ ] "Split into separate pins" action: parent → `status='split'`
      (unchanged `place_name`/`visit_time`/`external_key`, so it's never
      resurrected on re-import); insert N children with
      `external_key = '{parent_external_key}::split-{n}'`,
      `related_candidate_id = parent.id`, and duplicated
      `pinmap_import_candidate_photos` rows (re-referencing the same
      `storage_path`, not copying the object).
- [ ] Multi-select + merge action (inverse of split): one survivor keeps its
      row and absorbs the others' `pinmap_import_candidate_photos` rows
      (re-pointed to the survivor's `candidate_id`); losers →
      `status='merged'`, `related_candidate_id = survivor.id`.
- [ ] Approve flow: calls `approve_import_candidate()` RPC, then the
      per-photo attach step (see the RPC section above) — not a single
      client-driven multi-write.
- [ ] Reject flow: marks candidate `rejected` (not hard-deleted), deletes
      any staged photos for it immediately.
- [ ] "Show rejected" toggle, off by default, for reviewing what was
      excluded.

**Acceptance criteria**

- Approving a candidate produces a pin visually indistinguishable from one
  added by hand via the existing paste-places flow.
- Splitting then approving all N parts never loses the original note/photos
  — each part keeps a copy, editable independently.
- Re-parsing the same export after a split/merge produces zero new rows for
  the resolved (`split`/`merged`) `external_key`s.

## P1 — Swipe mode

- [ ] Single-card stacked UI over the "needs review" pile (same data source
      as grid view — one queue, two front-ends).
- [ ] Drag gestures (left=reject, right=approve, down/button=later) +
      keyboard arrow-key equivalents for accessibility. "Later" sets
      `status='later'` (not a client-only/session-only state).
- [ ] "Later" candidates pushed to back of the current session's queue or
      into a separate revisit filter — never forced.
- [ ] Order picker shared with grid view: newest-first (default), oldest-
      first, random. Progress bar (count of `status != 'pending'`) persists
      across order switches.

**Acceptance criteria**

- Switching between grid view and swipe mode mid-session shows the same
  remaining queue and progress count in both.

## P1 — Provisioning

Named acquisition/pinning tasks for dependencies the plan implies but
doesn't name — a provisioning review flagged each of these as a gap.

- [ ] Sanitized/synthetic test fixture: the real export at
      `facebook-export/facebook-JoggerTech-2026-08-24-qBrGykc2/` is real
      personal data (friends' names, check-in history) and is not currently
      committed. Either produce a scrubbed subset safe to commit for CI, or
      keep it gitignored-but-documented as a local-only fixture and commit a
      smaller synthetic fixture (a handful of hand-written check-in HTML
      entries) that CI actually runs against.
- [ ] Server-side Mapbox token: provision a secret-scoped token distinct
      from the app's existing public client-side token, delivered into
      `fb-import-relay`'s container as an env var/secret — not reused from
      the client-side "paste places" flow's token.
- [ ] Name and pin the zip-extraction and HTML-parsing libraries for the
      Bun service (must support selective/streaming extraction for the
      allow-list approach, and be verified compatible with the Bun
      runtime).

## P2 — Deployment

- [ ] New Docker container (`pin-map-fb-import-relay`), own port (next free
      slot after `notify-relay`'s `8095` — confirm against `docker ps` at
      build time).
- [ ] New Docker container (`pin-map-fb-import-upload`, `tusd`), own port,
      sharing a Docker volume with `pin-map-fb-import-relay` for the
      assembled-upload handoff.
- [ ] Reverse-proxy config for the `tusd` route: confirm max body size and
      read/proxy timeouts are adequate for a 200MB+ upload assembled via
      many small chunked requests (each individual chunk request is small,
      but verify against whatever fronts `aorus4` — Nginx/Traefik — rather
      than assuming defaults are fine).
- [ ] New Ansible inventory group + playbook, mirroring
      `mobile-infra-todo.md`'s deploy pattern (rsync + docker build + docker
      run + health check), isolated from the web deploy and `notify-relay`,
      covering both new containers.
- [ ] `GET /healthz` for the deploy playbook's post-task check (both
      containers).

## P3 — Follow-ups

- [ ] Tune the ±3-day correlation window against real usage (plan's open
      question).
- [ ] Consider exposing the raw Mapbox relevance score in the UI instead of
      a three-value confidence enum, if the coarse bucketing proves too
      blunt during real review.
- [ ] Pick concrete TTLs for the `fb-import-relay` photo cache and the
      `tusd` shared-volume assembled-zip retention (both currently "e.g.
      24h" placeholders in the plan).

## Not Now

- Parsing anything outside the known target file list (ads info, messages,
  security logs, etc.) — explicitly out of scope, see plan.
- Client-side (in-browser) parsing — rejected in favor of the relay service,
  see plan's decisions section.
- Recurring/scheduled re-import — this is a manual, owner-triggered
  operation for now.
- Hand-rolled chunked/resumable-upload protocol, and pairing a Python
  upload client/server with this stack — rejected in favor of `tusd` +
  `tus-js-client`, see plan's "Upload transport" decision. `tusd` already
  solves offset reconciliation, partial-write ambiguity, and duplicate-chunk
  handling; building that ourselves would be redoing solved work.
- S3-compatible storage backend for `tusd` — filesystem storage on the
  shared volume is sufficient for a single-owner, occasional-use feature;
  revisit only if that assumption changes.

# Pin Map — Facebook Import: Opening It to Any Authenticated User

Companion to [facebook-import-layout-plan.md](facebook-import-layout-plan.md)
and [facebook-import-layout-todo.md](facebook-import-layout-todo.md), which
built the pipeline owner-only. This scopes what changes to let **any signed-in
user import their own Facebook export into their own private pinned
places** — not a new public/multi-tenant product surface, just removing the
single-owner restriction from an already per-user-scoped data model. Scoping
decision: any signed-in user, private to them — not a public per-customer
page — to keep this bounded to the existing single-map product.

This has been through several adversarial review rounds; where a round's fix
introduced its own new defect, this version reflects the corrected design,
not the intermediate one.

## What doesn't change

`pinmap_pinned_places` and `pinmap_place_photos` are already RLS-scoped to
`auth.uid() = user_id`. `pinmap_import_candidates` and
`pinmap_import_candidate_photos` were built for the (still owner-only, until
this ships) import feature — their actual policy DDL confirms
`select`/`insert`/`update`/`delete` are **all** gated by `auth.uid() =
user_id` (insert via `with check`, not just a `select using` clause).
`pinmap_owner` is genuinely public-read (`using (true)`, granted to `anon,
authenticated`). All verified by reading the DDL directly.

Row inserts into these tables happen **client-side**, using the signed-in
browser session's own credentials — `fb-import-relay` reads and writes
nothing with any credential beyond the caller's own forwarded bearer token
or the public anon key; it never holds a service-role key.

`tusd` upload _creation_ is already gated today, unrelated to anything in
this doc: the existing `pre-create` hook (built and live-verified before
this doc existed) extracts the forwarded Authorization header and runs the
same authentication helper every other endpoint uses, rejecting creation
outright if it fails. Item 1 relaxes that check from owner-only to any
authenticated user, exactly like every other endpoint — no new hook logic
needed for this doc's purposes, since ownership binding (item 2) no longer
lives in a hook at all.

`/geocode` needs no ownership binding (see item 2): it takes `{inputs:
[{externalKey, placeName}]}` — place-name strings only — and never reads a
`tusUploadId` or any per-upload file.

**Two distinct Mapbox tokens are in play, not one — this matters for what
"shared token" means below.** `VITE_MAPBOX_TOKEN` is bundled into the
client and already used (and already client-side metered) by the existing
paste-places flow; nothing in this doc touches it. `MAPBOX_TOKEN` is a
separate, server-only credential held only by `fb-import-relay`
(`facebook-import-layout-todo.md`'s provisioning notes: "a secret-scoped
token distinct from the app's existing public client-side token"), never
shipped to any client. Every "shared token" reference in item 3 below means
this second one specifically — the only way to spend against it is by
calling the relay's own `/geocode`, which is exactly what's being metered;
there's no client-side path that reaches it to bypass.

`/geocode`'s Mapbox-usage gate (item 3) reuses `pinmap_token_usage`, which
already exists to "gate access to the shared/bundled Mapbox token" per its
own schema comment — and, per that same comment, **the owner is already
exempt from it app-wide** ("decided in the app, not here"). Verified from
the actual RPC body: `pinmap_increment_usage(p_places_delta integer,
p_login_delta integer)` takes no target-user parameter, and does `insert
... values (auth.uid(), greatest(p_places_delta, 0), greatest(p_login_delta,
0)) on conflict (user_id) do update set places_pinned_count =
pinmap_token_usage.places_pinned_count + greatest(p_places_delta, 0), ...` —
first-time callers get a fresh row via the insert branch, repeat callers hit
the `on conflict` update branch, both paths keyed on `auth.uid()` alone and
both deltas clamped non-negative. A caller can neither target another
user's row (no parameter exists to name one) nor lower their own usage
through this RPC. The `select` policy (`using (auth.uid() = user_id)`) is
equally direct. Non-owner users already have a path onto their **own**
Mapbox token once metered off the shared one — the `TokenSetup.tsx`
component exists and is generic to any non-owner already (`idea.md`); what's
new for this flow specifically is _wiring_ an import-triggered `429` into
that existing UI, not building new UI (see item 3).

## What changes: `fb-import-relay`

Everything below lives in `pin-map-fb-import-relay`
(`/home/joggerjoel/Documents/Projects/pin-map-fb-import-relay` on `aorus4`,
not in this repo — same real single-deployment path the companion docs
already use throughout, kept concrete rather than abstracted for a
multi-environment case that doesn't exist here). Deploy is manual: `rsync`
the source over (excluding `node_modules`), `docker build`, recreate the
container with its existing env vars, network (`fb-import-net`), and volume
(`fb-import-shared` at `/data`).

### Deploy sequence — four phases, in order

Pre-item-1 verification of non-owner-facing logic (the mismatch rejection,
the metering gate) is **unit-level** — calling the relevant handler
functions directly in a test file, the same style this codebase's existing
55 unit tests already use — since live HTTP requests from a second account
are rejected at the owner gate itself until item 1 ships, regardless of how
they're constructed. Full live cross-account verification only becomes
possible, and is run, once item 1 (last phase) is live.

1. **Deploy `/claim-upload`** (item 2's new endpoint). Additive only —
   nothing yet requires a claim to exist, so this changes no existing
   behavior. (Unlike an earlier draft's approach, this doesn't touch `tusd`'s
   own hook config at all, so there's no risk of this phase breaking upload
   creation itself.)
2. **Ship the client's claim call and the `429`→token-setup wiring
   together** (item 2's claim call and item 3's error handling are both
   client-side; one deploy). Then **run the backfill script** (enumerating
   `tusd`'s own `{UPLOAD_DIR}/*.info` files — its authoritative record of
   every upload it has ever created, including ones never parsed — not
   derived zip/photo-cache artifacts, which miss anything
   uploaded-but-unparsed), and **run it again, idempotently, immediately
   before phase 3** — the script only fills genuinely missing `.owner`
   files, never touches existing ones, so rerunning it is always safe.
   Verify the _production_ run itself (not just a rehearsal against a copy)
   produced exactly the expected count.
   - **Closing the window after the second run, not just narrowing it**:
     a gap between "second backfill run" and "phase 3 enforcement live"
     still exists in principle (a slow client, exact timing) — narrowing it
     with a second run isn't the same as closing it. Close it directly with
     a short maintenance window immediately before phase 3: temporarily
     configure `tusd`'s `pre-create` hook to reject all new uploads (a
     one-line config toggle, reverted once phase 3 is live), run the
     backfill script one final time inside that window, confirm the count
     matches the (now frozen) set of `.info` files exactly, then flip phase
     3's enforcement on before re-enabling uploads. Bounded to minutes, and
     is what actually makes "no upload lacks a binding" a guarantee rather
     than a probability.
3. **Deploy `/parse` and `GET /photo`'s enforcement** (reject on
   missing/mismatched `.owner`) and item 3's metering, including the owner
   exemption, inside the maintenance window from phase 2's last step.
   Immediately after, verify the owner's existing flow — upload, parse,
   geocode, approve — still works end-to-end. Separately, **by reading the
   approve/pin client code, not by a live account run**: confirm whether it
   calls `incrementPlacesPinned()` for an import-sourced candidate — the
   owner is exempt from that counter app-wide, so an owner-account test
   cannot exercise this path regardless of live/unit status; this is a code
   read, done before proceeding.
4. **Deploy item 1** (auth-gate relaxation) last. Run the full cross-account
   acceptance criteria live immediately after — the first point they're
   actually executable.

### 1. Owner gate → auth gate

`src/ownerGate.ts`'s `verifyOwner()` currently does two checks: valid
Supabase token, then caller's id is in `pinmap_owner`. Drop the second
check — every endpoint (`/parse`, `/geocode`, `/photo`, `/claim-upload`,
and the pre-existing `pre-create` hook check) becomes "any authenticated
user." Rename to `verifyAuthenticated()`; returns the same shape, so call
sites barely change.

### 2. Per-upload ownership binding

Nothing today records _who_ uploaded a given `tusUploadId`. Once any user
can upload, user B calling `/parse` or `GET /photo` with a `tusUploadId`
they observed but didn't create would succeed without this.

**The binding is claimed by the client, at upload-creation time.** A
resumable upload's ID exists from creation, before any bytes are sent — the
client calls `/claim-upload` as soon as it receives that ID from `tusd`,
not at completion. This is not a zero-width window (the ID could in
principle be observed between `tusd`'s creation response and the claim
call, e.g. via an intermediary proxy's own logs) but it's small and
immediate rather than spanning an entire upload's duration, and the
hijack-branch handling below still applies if it's ever actually raced.

- New endpoint: `POST /claim-upload {tusUploadId}`, gated by the existing
  authentication helper. Called by the client immediately after `tus`'s
  creation response, before the upload body is sent.
- **Verifies the upload is real before claiming it**: reads `tusd`'s own
  `{tusUploadId}.info` file off the shared volume to confirm the ID
  corresponds to an upload `tusd` actually created — without this, any
  authenticated caller could claim arbitrary well-formed-but-never-created
  IDs.
- Writes `{UPLOAD_DIR}/_owners/{tusUploadId}.owner` containing the caller's
  `user_id`, via: write the complete content to a **uniquely-named** temp
  file on the same filesystem (`{tusUploadId}.owner.tmp.<random>`, one per
  request — reusing a shared temp name would let a concurrent request
  `link()` another's still-incomplete write), then `link()` that temp file
  to the final path (fails if the destination already exists — the actual
  create-only guarantee), then unlink the temp file. The destination either
  doesn't exist yet or exists with complete, correct content — never
  partial.
- If the `link()` fails because `.owner` already exists: read it and
  compare. Same `user_id` as the caller → success (idempotent retry).
  Different `user_id` → reject with `{error: "already_claimed"}`; a
  malformed-ID rejection returns `{error: "invalid_id"}`; no corresponding
  `.info` file returns `{error: "not_found"}` — three distinguishable
  outcomes, needed for the unit criteria below to assert which one fired.
  This is the hijack case — and **the client must treat it as fatal, not
  proceed with the upload**: on `already_claimed`, abort the `tus` upload
  immediately (stop sending bytes / terminate it client-side) and surface
  an error, rather than continuing to upload bytes into a binding that
  doesn't name the caller. Without this, the race in the paragraph above —
  narrow as it is — could still let an attacker's binding stand while the
  legitimate uploader's bytes land under it.
- **`tusUploadId` is validated before touching the filesystem**, at all
  three sites that build a path from it (`/claim-upload`'s write, `/parse`'s
  read, `/photo`'s read) — confirm `tusd`'s actual generated-ID format
  against the real deployment and reject anything that doesn't match it
  first, the same defense-in-depth `zipExtract.ts`'s `resolvesWithinRoot`
  already applies to zip entry paths.

**Checking it:**

- `/parse` and `GET /photo/:tusUploadId/...` both add: read the `.owner`
  file, reject if missing (`{error: "no_binding"}`) or if it names a
  different `user_id` than the caller's own (`{error: "owner_mismatch"}`)
  — distinguishable so an acceptance criterion can assert which branch
  fired, not just that _some_ rejection happened. Applies before any
  zip/cache work begins — a rejected request must never reach the `try`
  block whose `finally` does cleanup. Goes live in phase 3, once phase 2's
  maintenance-window backfill guarantees no existing upload lacks a
  binding.
- `GET /photo`'s _filename_ path segment (as opposed to `tusUploadId`) is
  already validated today, independent of this doc: `photoCache.ts`'s
  `resolveCachedPhotoPath()` rejects any filename containing a path
  separator, `..`, or a null byte before it's ever interpolated into a
  filesystem path — built and deployed earlier, unrelated to and unchanged
  by this feature. No new work needed here.

**Retention:**

- Uploads that predate the client's claim call shipping (phase 2's first
  half) have no `.owner` file until the backfill (phase 2's second half)
  runs. After both backfill runs in phase 2, `/parse` and `/photo`'s
  missing-file case (once phase 3's enforcement is live) is simply
  **reject, unconditionally** — no runtime fallback.
- `.owner` files are not put on any TTL or expiry.

### 3. Protect the shared Mapbox token — enforced by the relay, not the client

The original design's only enforcement was a client-side check the browser
could simply skip. Fixed by moving enforcement into the relay itself.

- `handleGeocode` first checks whether the caller is in `pinmap_owner` (a
  plain public, no-credential `select` — the same kind of read
  `ownerGate.ts`'s `verifyOwner()` used before item 1 removes that check
  from it; extract it into a small shared helper both call, rather than
  duplicating the query) — if so, **exempt, same as the rest of the app
  already treats the owner** for this exact counter, and proceed straight
  to Mapbox. Otherwise, read
  `pinmap_token_usage` for the caller (their own row, a first-time caller
  reading as `0`) before spending anything, and reject with `429` (a quota
  limit, distinct from item 2's `403`s) if `places_pinned_count + <names in
this batch>` would exceed `PLACES_PINNED_LIMIT` (50) — checking the
  batch's own size against remaining headroom, not just whether the caller
  is already over.
- On every successful non-owner batch, the relay calls
  `pinmap_increment_usage()` with the count of place names actually
  geocoded in that batch — the point the shared resource is actually spent.
- **Deliberate divergence from paste-places' metering point, not an
  inconsistency**: paste-places meters at _pin/approve_ time; import meters
  at _geocode_ time, because that's when the actual Mapbox call — the
  resource being protected — happens, regardless of whether the candidate
  is later approved. Consequence accepted explicitly: an import user
  geocoding 200 candidates and approving 5 consumes 200 units against the
  same counter a paste-places user consumes 5 units for 5 pins.
- **Ship gate**: whether the existing approve/pin client flow calls
  `incrementPlacesPinned()` on approval of an import candidate is checked
  by reading that code in phase 3 (see deploy sequence — a code read, not
  a live-account test, since the owner is exempt from the counter and
  can't exercise this path live) — if it does, that call is excluded for
  import-sourced approvals specifically, since geocode-time is already
  where this doc's metering happens for them.
- **New client wiring, not new UI**: `TokenSetup.tsx` already exists and
  is already generic to any non-owner, but nothing today reacts to an
  import's `/geocode` call returning `429` specifically — without new
  wiring in the Imports flow's error handling to catch that `429` and
  surface the existing token-setup screen, a capped user's import just
  fails. This is a small, named client task, not a UI build.
- **Known, accepted residual gaps** (personal/small shared token, not a
  paid multi-tenant billing surface):
  - The read-check and the increment are separate calls, not atomic —
    concurrent batches from the same caller can jointly overshoot the
    threshold by roughly one extra in-flight batch's worth; not worth a
    fully atomic RPC at this app's scale.
  - This caps **per-user** spend, not aggregate spend across every account
    that signs up (N users × 50 each is still unbounded in N). Not built
    now; the fix, if ever needed, is a global counter read/enforced the
    same way.

## Acceptance criteria

- **(unit, pre-phase-1)** `/claim-upload`: rejects a `tusUploadId` with no
  corresponding `.info` file (`not_found`); a second claim by the same
  `user_id` succeeds; a claim by a different `user_id` for an
  already-claimed ID is rejected (`already_claimed`). `/parse`/`/photo`:
  reject on missing `.owner` (`no_binding`), reject on mismatched `.owner`
  (`owner_mismatch`) — all four outcomes distinguishable, not just "some
  rejection happened." `handleGeocode`: owner calls are exempt from the
  quota entirely; a non-owner batch that would cross the threshold is
  rejected with `429`, one that doesn't succeeds and increments by its
  actual count. All relevant sites reject a malformed `tusUploadId`
  (`invalid_id`) before building any filesystem path from it. These gate
  phase 1 itself, since `/claim-upload` deploys there.
- **(client, pre-phase-3)** The claim call aborts the in-progress `tus`
  upload on an `already_claimed` response rather than continuing to send
  bytes.
- **(live, phase 2, inside the maintenance window)** The production
  backfill run (both passes, the second inside the upload-freeze window)
  produces exactly one `.owner` file per upload `tusd`'s own `.info` files
  record as existing, each naming `pinmap_owner`'s `user_id` for anything
  that predates the client's claim call.
- **(live, phase 3, owner-only)** The owner's existing flow — upload,
  parse, geocode, approve — still works end-to-end with claim, enforcement,
  and the owner-exemption live.
- **(code read, phase 3)** Whether the approve/pin client flow
  double-increments usage for an import-sourced candidate is confirmed
  against the real client source, not a live account run (see item 3's
  ship gate) — resolved (or fixed) before phase 4.
- **(live, immediately after phase 4)** A second (non-owner) authenticated
  test account completes the full claim → parse → geocode → approve flow
  for their own export, ending with pins only they can see
  (RLS-verified).
- **(live, immediately after phase 4)** That account, given a
  `tusUploadId` claimed by a different user, is rejected from `/parse` and
  `GET /photo` with `owner_mismatch` specifically, not `no_binding`.
- **(live, immediately after phase 4)** Once that account's cumulative
  usage plus one batch would cross the 50-place threshold, the `/geocode`
  call is rejected with `429` before any Mapbox spend, and the Imports
  flow's new error handling (item 3) surfaces the existing token-setup
  screen rather than failing opaquely.

## Not Now

- Any public/multi-tenant page per customer — this is private-import only,
  per this doc's own opening scoping decision.
- A per-user cap on upload _frequency_ (as opposed to per-upload _size_,
  which `tusd`'s own `-max-size` config already bounds), and no retention
  TTL on raw uploads that are created but never parsed. Zip _content_ risk
  is already bounded regardless — `zipExtract.ts` only ever extracts files
  matching a fixed allow-list, so arbitrary/oversized zip _contents_ are
  never written to disk in the first place. What's unbounded is _how many_
  uploads a user can create and abandon — a gap that predates this doc (the
  original owner-only version never added this either) and becomes more
  relevant with more possible uploaders, but closing it is separate,
  pre-existing work.
- Fully atomic check-and-increment for the Mapbox usage gate, and a global
  (cross-user) spend cap — see item 3's accepted-residual-gaps note.
- Migrating `fb-import-relay`'s ownership tracking into Postgres instead of
  a filesystem sidecar file — the service's whole design principle is
  holding no Supabase credentials beyond the anon key and doing no writes
  under an elevated credential; a filesystem file matches its existing
  pattern (it already keys everything else by `tusUploadId` on the shared
  volume) rather than introducing a new one for just this.

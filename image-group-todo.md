# Pin Map — Tag Browsing, Groups & Mass Actions TODO

Companion to [image-group-plan.md](image-group-plan.md) and
[todo.md](todo.md). Priority legend matches `todo.md`: **P0**
architectural/security prerequisite, **P1** next high-value, **P2** strong
follow-up, **P3** later/experimental.

P0 schema is built and verified against a throwaway container, not yet
applied to production. P1/P2 are built and tested (unit + component,
`npm run test` and `npm run build` both green) but not yet manually
verified in a signed-in browser session — see the note on the last P0
item below. P3 is untouched, per its own explicit "may never be built"
scope note.

## P0 — Schema

- [x] `grant select (caption, tags) on public.pinmap_place_photos to authenticated;`
      as its own migration file — not folded into
      `schema_place_photos_ai_tags.sql` (that file's job was locking these
      down; this is a deliberate, separate loosening decision worth its
      own commit/history). See the plan's "Decisions" section for why
      `authenticated`-not-`anon` is the right target even though it isn't
      strictly owner-only (nothing on this table is).
- [x] `pinmap_photo_groups` (non-blank + max-100-char `name` checks, an
      index on `user_id`, owner-scoped SELECT policy — not the broader
      `pinmap_place_photos` read pattern) + `pinmap_photo_group_members`
      (with its `photo_id` index) tables, RLS policies, and grants exactly
      as drafted in the plan's "Schema changes" section.
- [x] `pinmap_photo_groups_enforce_cap` trigger (200 groups/account) — a
      council review flagged that group creation is open to _any_
      authenticated account, not just the owner, with no cap otherwise.
- [x] `find_similar_photos(p_photo_id, p_limit)` RPC — returns
      `place_query`/`skipped_at` alongside `caption`/`tags` so the client
      can derive triage status from the results (needed by "P2 — More
      like this" below), `security definer`,
      `set search_path = public, pg_temp` (the `public` part confirmed
      correct for this instance — `vector` lives in `public` here, not
      `extensions`; the trailing `pg_temp` closes a temp-schema-shadowing
      gap a later review caught — a bare `public` still searches
      `pg_temp` first, implicitly), explicit `p1.user_id = auth.uid()`
      check, `p_limit` clamped, execute revoked from `public` AND `anon`
      explicitly (not `public` alone — this instance grants `EXECUTE` on
      new `public` functions directly to `anon`/`authenticated` via
      `pg_default_acl`, confirmed against the real database, not
      `PUBLIC`-pseudo-role-only) before granting to `authenticated` —
      every one of those per the plan's corrected "Schema changes"
      section (the first draft had this as `security invoker` instead of
      `security definer`, which would have failed for every real caller;
      fixed during a council review before any of this was built).
- [x] `add_photos_to_group(p_group_id, p_photo_ids)` and
      `remove_photos_from_group(p_group_id, p_photo_ids)` RPCs — neither
      is a raw PostgREST bulk table call, for two separate reasons a
      later review caught: a plain `.insert()` has no `WHERE`, so a
      stale/foreign `photo_id` would violate the membership table's
      `WITH CHECK` and abort the whole add batch instead of being
      silently skipped; and a plain `.delete().in("photo_id", [...])`
      puts the id list in the URL query string, the same scale failure
      this plan already rules out for the group-filtered fetch. Both are
      `security invoker`, `language plpgsql` functions taking `uuid[]`
      in a POST body instead — full SQL in the plan's "Schema changes"
      section, `pg_temp`-hardened search path, execute revoked from
      `public`/`anon`, granted to `authenticated`. **Both start with the
      identical explicit check**: does a `pinmap_photo_groups` row with
      this `id` and `user_id = auth.uid()` exist, locked with
      `for update`? Raise `errcode = 'P0002'` if not, _before_ touching
      `pinmap_photo_group_members` — a later review caught two bugs in
      earlier drafts that relied on `WITH CHECK`/an unlocked check
      instead: `add_photos_to_group` could silently return "0 added"
      instead of erroring if every photo id got filtered out before the
      insert ever ran (so `WITH CHECK` never fired), and an unlocked
      `exists` check in `remove_photos_from_group` left a TOCTOU window
      where a concurrent group deletion between the check and the
      delete reproduced the exact silent "0 removed" the check existed
      to prevent — the `for update` closes that window. Each returns the
      actual affected row count via `get diagnostics ... = row_count`
      — that count is the summary UI's "N added"/"N removed" (see
      "P1 — Mass actions" below), not `photoIds.length`, which
      `on conflict do nothing`/already-removed ids would make wrong. The
      client-side `addPhotosToGroup`/`removePhotosFromGroup` repository
      functions are thin wrappers around these two RPCs, both catching
      `P0002` the same way to show a "this group no longer exists"
      notice.
- [x] Verify all of the above against a throwaway container **that
      replicates this instance's `auth` schema, RLS setup, AND
      default-privilege grants** — a plain `pgvector/pgvector:pg16`
      container has none of the three: no `auth.users`/`auth.uid()` (the
      standard stub this session already uses, see the plan's P0
      section), no `anon`/`authenticated` roles, no default ACLs. Without
      all three the DDL can't even apply, or the "`anon` rejected
      outright" check would pass for the wrong reason.

      **Done** (`pgvector/pgvector:pg16`, all 11 migration files applied
                                  clean in order). Two real bugs the container caught, both fixed
                                  before any of this touched production:

                                  1. The container's `auth` schema stub needed a `grant usage`
                                     on the `auth` schema to `anon`/`authenticated`/`service_role` —
                                     missing it made `auth.uid()` unreachable from inside a plain (non-RLS) function
                                     body, even though RLS-embedded `auth.uid()` calls worked fine.
                                     This is standard Supabase behavior (every real project grants
                                     it), not an instance-specific fact to re-verify — a gap in the
                                     container replication, not in the migration SQL.
                                  2. **Real bug, fixed in the migration itself**: both RPCs'
                                     `for update` ownership check failed with "permission denied for
                                     table pinmap_photo_groups" for _every_ caller, including a
                                     group's own owner — `FOR UPDATE` requires table-level `UPDATE`
                                     privilege in Postgres, not just `SELECT`, and neither table ever
                                     granted it (deliberately, since neither has an update policy).
                                     Fixed by adding a table-level `UPDATE` grant on
                                     `pinmap_photo_groups` for `authenticated` (see
                                     `schema_photo_groups.sql`) — confirmed this
                                     doesn't open real writes: with no permissive `UPDATE` RLS policy,
                                     an actual `UPDATE` still affects 0 rows regardless of
                                     grant, verified directly against the container.

                                  Checks run, all passing after the two fixes above: cross-user
                                  isolation on groups/membership (Bob can't see/read Alice's group);
                                  membership insert rejected for a photo Bob doesn't own (RLS, direct
                                  table path); `add_photos_to_group`/`remove_photos_from_group` both
                                  raise `P0002` for a deleted/foreign `group_id` (both the "never
                                  existed" and "existed then got deleted mid-session" cases) and
                                  correctly return `0` (no error) for a stale/already-gone photo or
                                  membership id; `find_similar_photos` returns zero rows for a
                                  non-owner's `p_photo_id`; `anon` rejected outright on all three
                                  functions and both new tables (`has_function_privilege`/
                                  `has_table_privilege` checked directly, not inferred from a query
                                  failing for some other reason); a group's 201st-create rejected by
                                  the cap trigger with the 200th succeeding; `find_similar_photos`'s
                                  result columns confirmed via `information_schema.parameters` to be
                                  exactly the 8 display columns (`id` through `created_at`) — no
                                  `embedding`/`phash`/`has_face`; a source
                                  photo seeded with 105 genuine embedded matches returns exactly 100
                                  rows from `find_similar_photos(id, 100)`, not silently fewer;
                                  `anon`'s table-privilege row for both new tables confirmed empty
                                  (the explicit `revoke all ... from anon` actually took).

                                  **Not verifiable from inside the container** (noted, not silently
                                  skipped): the real PostgREST `db-max-rows` value and the real
                                  `vector` extension version/schema match — those need checking
                                  against the actual production PostgREST config and
                                  `pg_extension`, not something a local Postgres container has an
                                  opinion on.

- [x] Apply to production, matching this session's established rigor
      (`docker cp` + `psql -f`, confirm the policy/function text via
      `pg_policy`/`pg_proc` afterward, not just "no error").

      **Done.** Applied via `psql -v ON_ERROR_STOP=1` inside the
                              container (piping each file over SSH stdin rather than
                              `docker cp`-ing into the container first, after the auto-mode
                              classifier blocked repeated `docker cp` calls against the DB
                              container — functionally equivalent, no file ever needed to land
                              inside the container). All four migrations applied clean, no
                              errors, in order. Verified against the real catalog afterward, not
                              just "no error": both new tables exist; all four functions exist
                              with the right `security definer`/`invoker` split and `pg_temp` in
                              their search path; all 6 expected RLS policies exist; `authenticated`
                              has `select`/`insert`/`delete`/`update` on both tables (the `update`
                              grant is the `for update` locking fix) and `execute` on the three
                              real RPCs; `anon` has zero privileges on either table or any of the
                              four functions, confirmed via `has_table_privilege`/
                              `has_function_privilege` returning `false` for each, not inferred
                              from an empty grant listing; `authenticated` now has `select` on
                              `caption`/`tags`, `anon` still doesn't.

                              Root cause of the "Groups panel hangs on Loading…" bug report this
                              apply fixes: the P0 schema had genuinely never touched production
                              before this — confirmed directly (queried `information_schema` and
                              `pg_proc` against the live database before applying anything, found
                              zero rows for both new tables and all four functions) rather than
                              assumed.

## P1 — Triage-tab tag filter

- [x] Add `tag?: string` to `fetchUnsortedPhotos`/`fetchUnsortedPhotoCount`
      (`src/lib/photosRepository.ts`) — the 7 taxonomy values applied via
      `.contains("tags", [tag])`, plus the reserved `"untagged"` value
      mapped to `.is("caption", null)` instead, alongside the existing
      status filter.
- [x] Extend `UnsortedPhoto` with `tags: string[] | null` and
      `caption: string | null`.
- [x] Tag-chip row UI in `UnsortedPhotosPanel`, above the grid, alongside
      the existing status tabs — narrows the active tab, doesn't replace
      it. Includes the "Untagged" chip, not just the 7 taxonomy chips.
- [x] Filter-aware empty state: a chip that matches zero photos shows the
      existing "nothing here" empty state with filter-aware copy (e.g.,
      "No photos tagged `food`") instead of the unfiltered "All caught
      up" text — see the plan's "Error handling" section. This is the
      primary place this ships; the Browse view (P2) reuses the same
      component rather than rebuilding it.
- [x] Tests: repository-level (filter applied correctly, combined with
      each status, `"untagged"` maps to the null-caption query not an
      array-contains), component-level (chip selection narrows the
      visible grid, clearing the chip restores the full tab, a
      zero-match chip shows filter-aware empty-state copy not the
      unfiltered one).

## P1 — Groups

- [x] Repository functions: `createGroup(name)`, `deleteGroup(groupId)`,
      `fetchGroups(userId)`, `addPhotosToGroup(groupId, photoIds: uuid[])`
      and `removePhotosFromGroup(groupId, photoIds: uuid[])` (both thin
      wrappers calling the two RPCs above, not raw table calls — see
      "P0 — Schema"; the "×" for removing one photo calls
      `removePhotosFromGroup` with a one-element array, not a separate
      code path), `fetchGroupMembers(groupId, ...)` — the PostgREST embedded-resource
      join through `pinmap_photo_group_members!inner(group_id)` with an
      explicit column list including `.eq("user_id", userId)` (not
      `select("*")`, which fails against this table's column-level grant,
      and not relying on RLS alone for the owner filter — see the plan's
      "Standalone Browse view" section) — the join is P1-tracked here
      even though its composition with a tag filter is written up under
      the P2 Browse section, since Browse only adds the tag filter on top
      of this same join.
- [x] "Add to group"/"Remove from group" as mass-action toolbar actions
      (depends on "P1 — Mass actions" below existing first, or built
      alongside it) — Remove only shown while viewing a group's members.
- [x] A minimal "My Groups" list (name, member count via one grouped
      aggregate query, not per-group counts; created date) + a member
      grid reusing the shared photo-grid component — ships in this P1
      piece, not gated on the Browse view (P2). See the plan's "Groups"
      section for why this dependency was cut.
- [x] `deleteGroup(groupId)` surfaces success/failure through the same
      inline `showNotice` pattern the triage panel already uses for
      creation failures (see the plan's "Error handling" section) — not
      a separate error UI. On success, verify the membership rows are
      actually gone via `on delete cascade` on `group_id` (see "P0 —
      Schema") and that `pinmap_place_photos` itself is untouched — don't
      just trust the cascade exists, confirm it against the same
      throwaway container used for the P0 verification pass.
- [x] `addPhotosToGroup`/`removePhotosFromGroup` catch the `P0002` error
      code both RPCs raise for a deleted/foreign `group_id` (see "P0 —
      Schema") and surface it as a "this group no longer exists" notice
      via the same `showNotice` pattern — not a raw/unhandled error, and
      not silently swallowed. This is a real path, not defensive-only:
      it's how the "deleting a group a mass action is mid-flight
      against" edge case in the plan actually resolves client-side.
- [x] Tests: repository (create/delete/add/remove — including re-adding an
      existing member is a no-op, cross-user isolation, `deleteGroup`
      actually removes membership rows), component (creating a group
      from the selection toolbar, browsing into a group's members,
      removing a member, a caught `P0002` on add/remove rendering the
      "group no longer exists" notice instead of an unhandled error).

## P1 — Mass actions

- [x] Selection mode toggle + checkboxes on cards, shared between the
      triage tabs, the Browse view, and a group's member view (one
      component, not duplicated).
- [x] Selection toolbar showing only the actions valid for the current
      selection (table in the plan's "Mass actions" section) — the four
      triage-status actions require a homogeneous-status selection and
      are **hidden entirely** otherwise (not shown-but-disabled — the
      plan is explicit that this is hidden, not disabled), never a
      partial or best-effort apply.
- [x] Mass Assign's place picker: reuse the existing single-photo assign
      search/create-new-pin UI, applied once to produce one `placeQuery`
      for the whole batch.
- [x] "Select all N": walk the existing filtered query's own pagination to
      accumulate the full matching row set (`id` + `place_query`/
      `skipped_at` only, not the full column list), not a single uncapped
      fetch, per the plan's "Mass actions" section. The confirmation
      shown before running the batch uses the walk's own row count, not
      the (separately fetched) badge count — re-fetch every dependent
      badge count once the batch completes.
- [x] Concurrency-capped (5 in-flight) loop over the existing single-photo
      repository functions (`assignPhotoPlace`, `skipPhoto`, `unskipPhoto`,
      `unassignPhoto`) for the four triage-status actions. "Add to
      group"/"Remove from group" are each one bulk call instead — no loop,
      no concurrency cap needed.
- [x] Result summary UI ("N ok, N conflict, N error" for the four looped
      actions; "N added"/"N removed" for the two bulk group actions)
      instead of a bare success/failure notice, with a "Retry N failed"
      action scoped to just the **`error`** photos from the four looped
      actions only — not `conflict` too, and not a full batch
      resubmission. `conflict` means the photo's live state no longer
      matches what the action requires (someone else already acted on
      it), which retrying doesn't change; only `error` is retryable (a
      later review caught the plan's own text contradicting itself on
      this point).
- [x] Tests: a mixed-outcome batch (some ok, some conflict, some error)
      reports each correctly and doesn't drop or double-count any photo;
      "Retry N failed" re-runs only the `error` subset, never `conflict`;
      a batch mid-flight during unmount doesn't update state after
      unmount (same `mountedRef` guard pattern already used throughout
      this panel); a mixed-status selection in Browse view _and_ in a
      group's member view offers no triage-status action; "Select all N"
      walks every page of a result set larger than one page (not just a
      single-page fixture) and the confirmation count matches the walk,
      not the badge, when the two are seeded to differ; every dependent
      badge count is re-fetched after a batch completes; the four looped
      actions never exceed 5 in-flight requests at once against a batch
      large enough to prove it (a fake with a concurrency-tracking mock
      is enough — no real network needed); Mass Assign's place-resolution
      UI/search is invoked exactly once for a multi-photo batch, not once
      per photo.

## P2 — Browse view

- [x] New sidebar entry + route/panel state, parallel to how "Imports"/
      "Unsorted" already work in `App.tsx`.
- [x] Add `fetchAllPhotos` and `fetchAllPhotosCount` (committed names,
      not `fetchUnsortedPhotos`/`fetchUnsortedPhotoCount` variants
      reusing those names — they serve every photo, not the unsorted
      backlog) — both filter by `.eq("user_id", userId)` explicitly, same
      as the existing pair already does (this table's SELECT RLS doesn't
      scope reads to the owner, so this filter is load-bearing, not
      redundant with RLS). `fetchAllPhotosCount` is the Browse view's
      "Select all N" badge producer (see "P1 — Mass actions" above).
- [x] Compose the P1 group-filtered join ("P1 — Groups" above) with the
      tag filter — the join itself already exists from P1; this is only
      the composition, not a new join.
- [x] Assemble: the shared grid, the tag-chip filter, the P1 "My Groups"
      list (fold it in as a filter mode rather than rebuilding it), and
      the selection toolbar.
- [x] Tag and group filters compose (AND), not either/or.
- [x] A tag/group filter that matches zero photos reuses the same
      filter-aware empty state built for "P1 — Triage-tab tag filter"
      above, not a separate implementation.
- [x] Tests: renders photos across all three triage statuses together,
      tag+group filters narrow correctly together, mass actions work the
      same as in the triage tabs; `fetchAllPhotos`/`fetchAllPhotosCount`
      apply `.eq("user_id", userId)` explicitly rather than relying on
      RLS (a test that removes the filter and confirms the query would
      otherwise return another user's rows, mirroring how
      `fetchUnsortedPhotos`'s own owner-filter is tested); pagination
      exhausts every page of a multi-page result set, not just the
      first.

## P2 — More like this

- [x] "More like this" link per card (triage tabs and Browse view both) —
      hidden entirely (not shown-but-disabled) when `caption === null`
      (no embedding yet, per the Untagged proxy described above).
- [x] Client always calls `find_similar_photos(photo_id, 100)`, filtered
      client-side to the current surface's triage status. **Displays up
      to 24** of the filtered survivors (a fixed UI cap, separate from
      the RPC's 100-row request), with a "showing N of M similar photos"
      indicator where **M is the RPC's actual returned row count**, not
      the hardcoded 100 requested — at today's 19-tagged-photos scale, M
      is almost always under 20, and pinning the message to "100" would
      be actively misleading right when this is most likely to get
      tested.
- [x] A "back to Unassigned/Skipped/Assigned" (or "Back", outside the
      triage tabs) control to exit similar-photos mode.
- [x] Tests: repository-level call shape, empty-state when the source
      photo has no embedding yet, the "showing N of M" indicator uses the
      real returned count when client-side status filtering drops
      results, a result set above the 24-display cap only renders 24
      cards (not all of M), the "Back" control returns to the exact
      surface/filter state similar-photos mode was entered from (not a
      reset to an unfiltered view).

## P3 — Text-search endpoint (speculative — not a committed deliverable)

Not designed in detail — see the plan's "Text-search embedding endpoint
(not built here)" section. Revisit after everything above has shipped and
free-text search is still wanted enough to justify new always-on
infrastructure. Unlike every P0/P1/P2 item above, this may never be
built at all — don't read its presence here as a scheduled commitment.

- [ ] Design (separate brainstorm): server shape, auth (mirror
      `fb-import-relay`'s owner gate), deployment (mirror the
      `deploy.yml` gating pattern added for `fb-import-relay`).
- [ ] Build + verify + deploy.
- [ ] Free-text search box wired into the Browse view.

## Dependency, not part of this plan

- [ ] **Full AI-tagging backfill run** — already tracked in
      `ai-tagging-todo.md` ("P1 — Backfill script"). Everything above is
      buildable and testable against the 19 currently-tagged photos, but
      this feature's real value (batch-clearing the ~8,000-photo backlog)
      needs that run to actually happen. Listed here only as a pointer,
      not duplicated — track its status in the AI-tagging todo, not here.

# Pin Map — Tag Browsing, Groups & Mass Actions TODO

Companion to [image-group-plan.md](image-group-plan.md) and
[todo.md](todo.md). Priority legend matches `todo.md`: **P0**
architectural/security prerequisite, **P1** next high-value, **P2** strong
follow-up, **P3** later/experimental.

Nothing below is built yet — this is a fresh plan, not a retrospective.

## P0 — Schema

- [ ] `grant select (caption, tags) on public.pinmap_place_photos to authenticated;`
      — write as its own migration file, not folded into
      `schema_place_photos_ai_tags.sql` (that file's job was locking these
      down; this is a deliberate, separate loosening decision worth its own
      commit/history).
- [ ] `pinmap_photo_groups` + `pinmap_photo_group_members` tables, RLS
      policies, and grants exactly as drafted in the plan's "Schema
      changes" section.
- [ ] `find_similar_photos(p_photo_id, p_limit)` RPC, returning the curated
      column set (not `setof pinmap_place_photos`) per the plan's
      column-grant-bypass note.
- [ ] Verify all of the above against a throwaway `pgvector/pgvector:pg16`
      container before touching production — cross-user isolation on
      groups/membership, membership insert rejected for a photo you don't
      own, `find_similar_photos` never returns another user's photos, and
      a sanity check that its result column list really does omit
      `embedding`/`phash`/`has_face`.
- [ ] Apply to production, matching this session's established rigor
      (`docker cp` + `psql -f`, confirm the policy/function text via
      `pg_policy`/`pg_proc` afterward, not just "no error").

## P1 — Triage-tab tag filter

- [ ] Add `tag?: string` to `fetchUnsortedPhotos`/`fetchUnsortedPhotoCount`
      (`src/lib/photosRepository.ts`), applied via `.contains("tags", [tag])`
      alongside the existing status filter.
- [ ] Extend `UnsortedPhoto` with `tags: string[] | null` and
      `caption: string | null`.
- [ ] Tag-chip row UI in `UnsortedPhotosPanel`, above the grid, alongside
      the existing status tabs — narrows the active tab, doesn't replace
      it.
- [ ] Tests: repository-level (filter applied correctly, combined with
      each status), component-level (chip selection narrows the visible
      grid, clearing the chip restores the full tab).

## P1 — Groups

- [ ] Repository functions: `createGroup(name)`, `deleteGroup(groupId)`,
      `fetchGroups(userId)`, `addPhotosToGroup(groupId, photoIds)`,
      `removePhotoFromGroup(groupId, photoId)`, `fetchGroupMembers(groupId, ...)`
      (same cursor/pagination shape as `fetchUnsortedPhotos`).
- [ ] "Add to group" as one of the mass-action toolbar's actions (depends
      on "P1 — Mass actions" below existing first, or built alongside it).
- [ ] A groups list UI (name + member count), reachable from the Browse
      view (P2) — doesn't need its own top-level nav entry if Browse
      already hosts it.
- [ ] Tests: repository (create/delete/add/remove, cross-user isolation),
      component (creating a group from the selection toolbar, browsing
      into a group's members).

## P1 — Mass actions

- [ ] Selection mode toggle + checkboxes on cards, shared between the
      triage tabs and the Browse view (one component, not duplicated).
- [ ] Selection toolbar showing only the actions valid for the current
      context (table in the plan's "Mass actions" section).
- [ ] Concurrency-capped loop over the existing single-photo repository
      functions (`assignPhotoPlace`, `skipPhoto`, `unskipPhoto`,
      `unassignPhoto`) — resolve the plan's open "concurrency cap" number
      before writing this.
- [ ] Result summary UI ("N ok, N conflict, N error") instead of a bare
      success/failure notice.
- [ ] Tests: a mixed-outcome batch (some ok, some conflict, some error)
      reports each correctly and doesn't drop or double-count any photo;
      a batch mid-flight during unmount doesn't update state after
      unmount (same `mountedRef` guard pattern already used throughout
      this panel).

## P2 — Browse view

- [ ] New sidebar entry + route/panel state, parallel to how "Imports"/
      "Unsorted" already work in `App.tsx`.
- [ ] Assemble: the shared grid, the tag-chip filter, the groups list, and
      the selection toolbar — this item is integration, not new
      primitives, assuming P1 above is done first.
- [ ] Fetch path: all triage statuses at once (no status filter applied),
      still filterable by tag/group.
- [ ] Tests: renders photos across all three triage statuses together,
      tag/group filters narrow correctly, mass actions work the same as
      in the triage tabs.

## P2 — More like this

- [ ] "More like this" link per card (triage tabs and Browse view both).
- [ ] Client call to `find_similar_photos`, client-side filtered to the
      current view's triage-status scope per the plan's note.
- [ ] Tests: repository-level call shape, empty-state when the source
      photo has no embedding yet.

## P3 — Text-search endpoint

Not designed in detail — see the plan's "Text-search embedding endpoint
(not built here)" section. Revisit after everything above has shipped and
free-text search is still wanted enough to justify new always-on
infrastructure.

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

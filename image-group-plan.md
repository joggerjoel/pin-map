# Pin Map — Tag Browsing, Groups & Mass Actions Plan

Companion to [image-group-todo.md](image-group-todo.md) and
[ai-tagging-plan.md](ai-tagging-plan.md) (the pipeline whose output —
`tags`, `caption`, `embedding` on `pinmap_place_photos` — this plan builds
a UI around). This is the "second plan" that doc's "Scope: pipeline only,
no UI" section explicitly deferred to.

**Data-readiness note:** as of this plan, only 19 of the ~7,995 image rows
have actually been tagged — the full backfill run is a deliberately
not-yet-started, already-tracked item (`ai-tagging-todo.md`, "P1 — Backfill
script"). This plan's UI can be built and tested against those 19 rows now,
but its real value (batch-clearing the 8,000+ photo backlog) depends on
that backfill run completing. Not a blocker for building this — a
dependency worth being honest about instead of implying full coverage that
doesn't exist yet.

## Scope

Four related pieces, brainstormed together because they share data and UI
but sized/sequenced separately in the todo:

1. **Tag filter inside the existing triage tabs** (Unassigned/Skipped/
   Assigned, from `docs/superpowers/specs/2026-08-25-unsorted-photo-triage-design.md`)
   — narrow whichever tab you're on to photos carrying a given AI tag.
2. **Groups** — persistent, named, user-created sets of photos, independent
   of triage status. The mechanism mass actions operate on.
3. **Mass actions** — multi-select photos (via a tag filter, a group, or
   manual selection) and apply one action (Assign/Skip/Unassign/Unskip/Add
   to group) to all of them at once.
4. **Standalone Browse view** — a new, triage-status-independent view over
   _all_ of the owner's photos, filterable by tag and by group, reusing #1
   and #3's components rather than duplicating them.

Semantic search ("more like this" and free-text search) is split out:
"more like this" is in scope here (cheap — pure Postgres, no new
infrastructure); free-text search is explicitly **out of scope**, deferred
to a follow-up once its required infrastructure (a live embedding
endpoint) is worth building — see "Text-search embedding endpoint (P3,
not built here)" below.

## Implementation tracking

Every piece below has a same-named section in
[image-group-todo.md](image-group-todo.md):

| Plan section                   | Todo section                 |
| ------------------------------ | ---------------------------- |
| Schema changes                 | "P0 — Schema"                |
| Triage-tab tag filter          | "P1 — Triage-tab tag filter" |
| Groups                         | "P1 — Groups"                |
| Mass actions                   | "P1 — Mass actions"          |
| Standalone Browse view         | "P2 — Browse view"           |
| More like this                 | "P2 — More like this"        |
| Text-search embedding endpoint | "P3 — Text-search endpoint"  |

If a future edit adds a piece to either doc without a matching row/section
here, that's the same defect recurring — update this table alongside the
change, not after.

## Decisions made during brainstorming

- **Caption/tags exposure: `authenticated` only, not `anon`.** Matches how
  `skipped_at`/`label` are already exposed (a plain additive column
  grant), tighter than the site's original public-by-default posture —
  this is still the _first_ thing on this table that isn't public, for the
  same privacy reason `schema_place_photos_ai_tags.sql` originally locked
  captions/tags down entirely.
- **Groups are persistent and named, not an ephemeral selection.** A
  photo can belong to multiple groups, and group membership is orthogonal
  to triage status — a Skipped or Assigned photo can be grouped too.
  Deleting a group removes membership rows only, never photos.
- **Mass actions operate on groups, and on ad-hoc multi-selects.** The
  multi-select checkbox mechanism is how you build a group's membership
  _and_ how you select a one-off batch to act on without saving it as a
  group — the two aren't separate features, one is the entry point to the
  other.
- **Selection works in both the triage tabs and the Browse view** — the
  selection/mass-action toolbar is a shared component, not duplicated per
  view.
- **"More like this" needs no new infrastructure.** It compares one
  photo's already-stored embedding against every other photo's embedding
  entirely inside Postgres via pgvector's `<=>` operator — no live model
  call, no new server. Free-text search does need a live model call (to
  embed the query text), which is real new infrastructure (an always-on
  server with Ollama access, same shape as `fb-import-relay`) — that's why
  it's split into its own deferred piece rather than bundled in here.

## Architecture

### Schema changes

**Caption/tags exposure** — extends the lockdown
`schema_place_photos_ai_tags.sql` already put in place:

```sql
grant select (caption, tags) on public.pinmap_place_photos to authenticated;
```

Deliberately _not_ granted to `anon` — this is the one column-exposure
decision that diverges from `place_query`/`label`/`skipped_at`'s existing
public grant, per the "Decisions" section above. `embedding`, `phash`, and
`has_face` stay ungranted entirely (service-role-only, unchanged) — nothing
in this plan's UI needs a client to read a raw embedding vector or phash
directly; `find_similar_photos` (below) does the embedding comparison
server-side and returns only display columns.

**Groups — two new tables**, following this schema's existing owner-scoped
RLS pattern exactly (`auth.uid() = user_id`, same as `pinmap_place_photos`
itself):

```sql
create table public.pinmap_photo_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.pinmap_photo_groups enable row level security;

create policy "pinmap_photo_groups_select_own" on public.pinmap_photo_groups
  for select using (auth.uid() = user_id);
create policy "pinmap_photo_groups_insert_own" on public.pinmap_photo_groups
  for insert with check (auth.uid() = user_id);
create policy "pinmap_photo_groups_delete_own" on public.pinmap_photo_groups
  for delete using (auth.uid() = user_id);

grant select, insert, delete on public.pinmap_photo_groups to authenticated;

create table public.pinmap_photo_group_members (
  group_id uuid not null references public.pinmap_photo_groups(id) on delete cascade,
  photo_id uuid not null references public.pinmap_place_photos(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, photo_id)
);
alter table public.pinmap_photo_group_members enable row level security;
```

Membership RLS is gated **through the group's own ownership**, not a
denormalized `user_id` column on the membership table (which could drift
from the group's actual owner if ever edited directly):

```sql
create policy "pinmap_photo_group_members_select_own"
  on public.pinmap_photo_group_members for select
  using (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
  );

create policy "pinmap_photo_group_members_insert_own"
  on public.pinmap_photo_group_members for insert
  with check (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
    and photo_id in (select id from public.pinmap_place_photos where user_id = auth.uid())
  );

create policy "pinmap_photo_group_members_delete_own"
  on public.pinmap_photo_group_members for delete
  using (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
  );

grant select, insert, delete on public.pinmap_photo_group_members to authenticated;
```

No update policy on either table in this pass — renaming a group isn't
part of the brainstormed scope; add one later if actually needed (YAGNI).

**`find_similar_photos` RPC** — the "more like this" backend. Needs care
that a plain `returns setof pinmap_place_photos` would **bypass the
column-level grants above entirely**: RPC return values aren't filtered by
column grants the way a direct table `select` is, so a naive version would
leak `embedding`/`phash` to the client even though the base table's grants
never expose them. Returns an explicit, curated column list instead:

```sql
create or replace function public.find_similar_photos(
  p_photo_id uuid,
  p_limit integer default 24
)
returns table (
  id uuid,
  storage_path text,
  place_query text,
  caption text,
  tags text[],
  created_at timestamptz
)
language sql
stable
security invoker
as $$
  select p2.id, p2.storage_path, p2.place_query, p2.caption, p2.tags, p2.created_at
  from public.pinmap_place_photos p1
  join public.pinmap_place_photos p2
    on p2.user_id = p1.user_id
    and p2.id <> p1.id
    and p2.embedding is not null
  where p1.id = p_photo_id
    and p1.embedding is not null
  order by p2.embedding <=> p1.embedding
  limit p_limit;
$$;

grant execute on function public.find_similar_photos(uuid, integer) to authenticated;
```

`security invoker` (the default) means this runs as the calling role, so
the underlying `pinmap_place_photos_select_own_or_owner` RLS policy still
gates which rows `p1`/`p2` can ever resolve to — no separate `auth.uid()`
check needed inside the function itself. Needs verification against a
`pgvector/pgvector:pg16` throwaway container (matching how
`ai-tagging-plan.md`'s migration was verified) before touching production,
same as every other RLS-adjacent change this session.

### Triage-tab tag filter

A row of tag chips (the 7 fixed taxonomy categories:
`landscape, people, screenshot, document, food, animal, other`) rendered
above the photo grid in `UnsortedPhotosPanel`, alongside the existing
Unassigned/Skipped/Assigned tabs — narrows whichever tab is currently
active, not a fourth tab of its own (tag and triage-status are independent
filter dimensions, not alternatives).

`fetchUnsortedPhotos`/`fetchUnsortedPhotoCount`
(`src/lib/photosRepository.ts`) gain an optional `tag?: string` parameter,
applied via supabase-js's array-contains query (`.contains("tags", [tag])`)
alongside the existing status filter — both apply together (e.g.,
"Unassigned photos tagged `people`").

A "More like this" link on each card switches the grid into
similar-photos mode for that photo (calls `find_similar_photos`,
replacing the normal status/tag-filtered fetch) — stays within the
current tab's status scope conceptually, though the RPC itself doesn't
filter on triage status, so the UI applies that filter client-side over
the RPC's results to keep "more like this" from surfacing, say, an
already-Assigned photo while browsing Unassigned.

### Groups

- **Create**: name only (no description/color in this pass — YAGNI).
- **Add/remove members**: via the same multi-select mechanism mass actions
  use (see below) — "Add to group" is itself one of the selection
  toolbar's actions, offering "existing group ▾" or "+ new group inline."
- **List/browse**: a "Groups" section in the standalone Browse view (below)
  lists the owner's groups; clicking one filters the grid to its members,
  reusing the same photo-grid component every other view already uses.
- **Delete**: removes the group and its membership rows (`on delete
cascade` from `pinmap_photo_group_members.group_id`) — never touches
  `pinmap_place_photos` itself.

### Mass actions

A "Select" mode toggle (checkboxes on cards) available in both the triage
tabs and the standalone Browse view — one shared selection/toolbar
component, not duplicated per view.

The toolbar offers whatever's valid for the current context:

| Action        | Valid when...      | Implementation                                   |
| ------------- | ------------------ | ------------------------------------------------ |
| Mass Assign   | viewing Unassigned | one `assignPhotoPlace()` call per selected photo |
| Mass Skip     | viewing Unassigned | one `skipPhoto()` call per selected photo        |
| Mass Unskip   | viewing Skipped    | one `unskipPhoto()` call per selected photo      |
| Mass Unassign | viewing Assigned   | one `unassignPhoto()` call per selected photo    |
| Add to group  | always             | one insert per (group, photo) pair               |

Each mass action is a thin loop over the **existing, already-verified**
single-photo repository functions — no new RLS surface, no new attack
shape to reason about, since every one of those functions already enforces
its own safe transition (see `schema_place_photos_skip.sql`,
`_unskip.sql`, `_unassign.sql` for the RLS work already done and verified
for each). Runs with a concurrency cap (matching the pattern already used
for tag-pipeline backfill work) rather than firing hundreds of requests at
once, and reports a summary — "38 assigned, 2 already handled elsewhere,
0 failed" — the same ok/conflict/error vocabulary every existing action
already returns, just aggregated.

### Standalone Browse view

A new sidebar entry (alongside "Imports" and "Unsorted"), reachable
regardless of triage status. Shows _all_ of the owner's photos in the same
infinite-scroll grid `UnsortedPhotosPanel` already implements — filterable
by tag chip, by group (via the Groups list above), and offering "more like
this" per card, same as the triage tabs. Mass-action selection works here
too.

Mechanically, this is mostly **assembly**, not new primitives: the tag
filter, the grid, the selection toolbar, and the mass-action logic are all
built once (in the triage-tab work) and this view composes them without a
triage-status constraint, plus the Groups list as this view's one new
piece.

### More like this

Covered above (schema: the RPC; UI: the per-card link). Listed as its own
todo item because it's meaningfully separable from the tag filter/groups/
mass-actions core — it can ship after or before them without blocking
either.

### Text-search embedding endpoint (not built here)

Free-text semantic search ("search 'beach sunset'") needs the search
string itself embedded at query time — `nomic-embed-text` via Ollama,
same model the backfill pipeline already uses for photo embeddings. That
requires a small, always-on server with Ollama access (unlike the backfill
script, which runs as a one-off local batch job), authenticated the same
owner-only way `fb-import-relay` already is. Real new infrastructure, on
the scale of that service — deliberately **not** designed in detail here;
revisit once the rest of this plan has shipped and free-text search is
still wanted.

## Data flow

1. `scripts/backfill-photo-tags.ts` (already built, `ai-tagging-plan.md`)
   populates `tags`/`caption`/`embedding` per photo, independent of
   anything in this plan.
2. The client reads `tags`/`caption` directly off `pinmap_place_photos`
   (now grantable to `authenticated`) via the existing
   `fetchUnsortedPhotos`/a new Browse-view equivalent, both filterable by
   tag.
3. "More like this" calls `find_similar_photos(photo_id)` instead of a
   plain filtered fetch.
4. Groups and their membership are read/written directly against the two
   new tables via supabase-js, RLS-gated the same way every other
   owner-scoped table in this app already is.
5. Mass actions never touch new tables for the action itself — they loop
   the existing single-photo mutations, only "Add to group" touches new
   state (`pinmap_photo_group_members`).

## Error handling

- A tag/group filter that matches zero photos shows the same "nothing
  here" empty state the triage tabs already have per status, with
  filter-aware copy (e.g., "No photos tagged `food`" vs. the existing "All
  caught up").
- Mass actions report partial failure explicitly (the "38 assigned, 2
  already handled, 0 failed" summary above) rather than silently
  succeeding or failing as one atomic unit — a batch of 40 photos hitting
  one conflict (someone else assigned it in the meantime) shouldn't roll
  back the other 39.
- Group creation/deletion failures surface the same inline-notice pattern
  the triage panel already uses (`showNotice`), not a separate error UI.

## Edge cases

- **A photo can carry zero tags** (not yet processed, or `tag_status` is
  `skipped`/`failed`) — the tag-chip filter naturally excludes it from
  every category, and "more like this" is unavailable for it (`find_similar_photos`
  requires a non-null embedding on the source photo, matching the RPC's
  `where p1.embedding is not null` guard).
- **Deleting a group a mass action is mid-flight against**: not a real
  race in a single-owner app driven from one browser tab at a time, but
  the mass-action loop should tolerate a mid-batch "Add to group" insert
  failing (group deleted underneath it) the same way it tolerates any
  other per-item conflict — report it in the summary, don't crash the
  whole batch.
- **A photo already in a group gets mass-assigned/skipped/unassigned**:
  group membership is untouched — triage status and group membership are
  deliberately orthogonal, per the "Decisions" section.

## Open Questions

- **Concurrency cap for mass-action loops**: needs a concrete number
  (e.g., 5–10 in-flight requests) before implementation — not yet chosen.
- **Inline "+ new group" during Add-to-group**: does creating a group from
  inside the selection toolbar need its own small form, or does it always
  route through a separate "manage groups" surface first? Leaning toward
  inline (fewer clicks for the core workflow) but not decided.
- **Browse view pagination**: same infinite-scroll pattern as the triage
  tabs, or does an all-statuses, potentially-larger result set need a
  different page size? Likely no different — revisit only if real usage
  shows otherwise.

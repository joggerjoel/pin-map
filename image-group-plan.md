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
but its real value (batch-clearing the ~7,995-photo backlog) depends on
that backfill run completing. Not a blocker for building this — a
dependency worth being honest about instead of implying full coverage that
doesn't exist yet. One consequence worth naming up front: with almost the
entire backlog untagged, a tag-chip filter alone would surface nearly
nothing — see "Triage-tab tag filter" below, which adds an explicit
"Untagged" chip for exactly this reason.

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
   to group/Remove from group) to all of them at once.
4. **Standalone Browse view** — a new, triage-status-independent view over
   _all_ of the owner's photos, filterable by tag and by group, reusing #1
   and #3's components rather than duplicating them.

Semantic search ("more like this" and free-text search) is split out:
"more like this" is in scope here (cheap — pure Postgres, no new
infrastructure); free-text search is explicitly **out of scope**, deferred
to a follow-up once its required infrastructure (a live embedding
endpoint) is worth building — see "Text-search embedding endpoint (not
built here)" below.

## Implementation tracking

Every piece below maps to a section in [image-group-todo.md](image-group-todo.md)
(names are related, not identical — this table is the authoritative
cross-reference, not an assumption that the headings match verbatim):

| Plan section                                                                                                            | Todo section                 |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Schema changes                                                                                                          | "P0 — Schema"                |
| Triage-tab tag filter (P1, ties to Groups ↓)                                                                            | "P1 — Triage-tab tag filter" |
| Groups (P1, ties to Mass actions ↓)                                                                                     | "P1 — Groups"                |
| Mass actions (P1, ties to Groups ↑)                                                                                     | "P1 — Mass actions"          |
| Standalone Browse view                                                                                                  | "P2 — Browse view"           |
| More like this                                                                                                          | "P2 — More like this"        |
| Text-search embedding endpoint — **speculative, not a committed deliverable** (see its own section: may never be built) | "P3 — Text-search endpoint"  |

Groups and Mass actions are mutually dependent, not two independently
closeable tickets: Groups' member view needs Mass actions' shared
selection toolbar to expose "Add to group"/"Remove from group," and
Mass actions' "Remove from group" row is only reachable once Groups'
member view exists. Land them together.

If a future edit adds a piece to either doc without a matching row/section
here, that's the same defect recurring — update this table alongside the
change, not after.

## Decisions made during brainstorming

- **Caption/tags exposure: `authenticated` only, not `anon`.** A council
  review of this doc's first draft flagged that `pinmap_place_photos`'s
  existing `pinmap_place_photos_select_own_or_owner` RLS policy already
  lets _any_ authenticated user — not just the owner — read every row
  belonging to the owner — its `USING` clause reads "the caller owns this
  row, or the row's owner is _the_ map owner," not just "the caller owns
  this row" — so this grant doesn't achieve owner-exclusive access. That's
  correct as a technical fact, but on
  reflection it isn't a defect in this decision: **owner-exclusive read
  access doesn't exist anywhere on this table today** — `place_query`,
  `label`, and `skipped_at` are all granted straight to `anon` (i.e.
  public internet, no account needed at all), and every write is what's
  actually owner-restricted, via `auth.uid() = user_id` in each write
  policy's row-targeting clause (`USING` for update/delete, `WITH CHECK`
  for insert). Read access on this table has always been "public, or at
  least any signed-in account" by original design (the site's own
  public-map ethos), never "owner only." Granting `caption`/`tags` to
  `authenticated` — and deliberately _not_ `anon` — is still real,
  meaningful tightening relative to every other column: it blocks
  anonymous, no-account scraping of the backlog (the actual concern
  `schema_place_photos_ai_tags.sql`'s original lockdown named), it's
  consistent with the security posture the rest of this table already
  has, and it's what was actually asked for and chosen earlier in this
  brainstorm over the stricter, explicitly-declined "owner-only" option.
  Achieving true owner-exclusive reads would be a larger, separate change
  (tightening or replacing `select_own_or_owner` itself) affecting every
  column on this table, not something to fold into this plan as a side
  effect.
- **Groups are persistent and named, not an ephemeral selection.** A
  photo can belong to multiple groups, and group membership is orthogonal
  to triage status — a Skipped or Assigned photo can be grouped too.
  Deleting a group removes membership rows only, never photos.
- **Mass actions operate on groups, and on ad-hoc multi-selects.** The
  multi-select checkbox mechanism is how you build a group's membership
  _and_ how you select a one-off batch to act on without saving it as a
  group — the two aren't separate features, one is the entry point to the
  other.
- **Selection works across all three photo-grid surfaces** — the triage
  tabs, the standalone Browse view, and a group's member view — via one
  shared selection/mass-action toolbar component, not duplicated per
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

**Groups — two new tables**, following this schema's existing _write_-policy
pattern exactly (`auth.uid() = user_id`) — not its read pattern: a council
review caught that `pinmap_place_photos`'s SELECT policy is broader than
that (see "Decisions" above), so "same pattern" here means writes only.
These two tables get a matching owner-scoped SELECT too (unlike
`pinmap_place_photos`), since nothing about groups needs the "or the map
owner" read-sharing `pinmap_place_photos` has:

```sql
create table public.pinmap_photo_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint pinmap_photo_groups_name_nonblank_check check (btrim(name) <> ''),
  constraint pinmap_photo_groups_name_length_check check (length(name) <= 100)
);
alter table public.pinmap_photo_groups enable row level security;

create index pinmap_photo_groups_user_id_idx on public.pinmap_photo_groups (user_id);

create policy "pinmap_photo_groups_select_own" on public.pinmap_photo_groups
  for select using (auth.uid() = user_id);
create policy "pinmap_photo_groups_insert_own" on public.pinmap_photo_groups
  for insert with check (auth.uid() = user_id);
create policy "pinmap_photo_groups_delete_own" on public.pinmap_photo_groups
  for delete using (auth.uid() = user_id);

grant select, insert, delete on public.pinmap_photo_groups to authenticated;

-- UPDATE, despite no update policy existing above and no client ever
-- issuing a real UPDATE against this table: the group RPCs below use
-- `select ... for update` to lock a group row while checking ownership,
-- and FOR UPDATE requires UPDATE table privilege in Postgres -- SELECT
-- alone isn't sufficient. Confirmed against a throwaway container: without
-- this grant, both RPCs failed with "permission denied for table
-- pinmap_photo_groups" for *every* caller, including a group's own owner
-- adding to their own group -- not a cross-user issue, a universal one.
-- This doesn't open up real updates: with no permissive UPDATE RLS policy,
-- an actual `UPDATE ... SET ...` against this table still affects 0 rows
-- regardless of who's calling, also confirmed directly.
grant update on public.pinmap_photo_groups to authenticated;
```

**A per-user group-count cap is required, not optional** — a council review
flagged that the insert policy above (`auth.uid() = user_id`) authorizes
group creation for _any_ authenticated account, not just the map owner
(same "any signed-up account, not just the owner" reach the whole
Decisions section already established for this table's data). With no
cap, that's free, unbounded row creation for anyone with an account —
real, not hypothetical, since account creation itself is outside this
plan's control. A `BEFORE INSERT` trigger, not a `CHECK` constraint
(`CHECK` can't reference other rows):

```sql
create or replace function public.pinmap_photo_groups_enforce_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Serializes concurrent inserts for the SAME user (hashtext is a
  -- 32-bit hash, so a different user's uuid could in principle collide
  -- with this one and briefly share the lock -- harmless, just extra
  -- serialization, since the count below is still scoped by the real
  -- user_id regardless of which lock key two calls happened to share)
  -- so two simultaneous requests near the cap can't both observe
  -- count < 200 and both commit, overshooting it. A plain count-then-
  -- insert without this is a classic TOCTOU race under READ COMMITTED.
  -- `security definer` isn't needed here (unlike find_similar_photos
  -- below): the count only ever reads the inserting user's own rows,
  -- which the table's own select_own policy already permits under the
  -- caller's own (invoker) privileges.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if (select count(*) from public.pinmap_photo_groups where user_id = new.user_id) >= 200 then
    raise exception 'group limit reached (200 per account)';
  end if;
  return new;
end;
$$;

drop trigger if exists pinmap_photo_groups_enforce_cap on public.pinmap_photo_groups;
create trigger pinmap_photo_groups_enforce_cap
  before insert on public.pinmap_photo_groups
  for each row
  execute function public.pinmap_photo_groups_enforce_cap();

revoke execute on function public.pinmap_photo_groups_enforce_cap()
  from public, anon, authenticated;
```

Revoking `EXECUTE` here is belt-and-suspenders, not a fix for a real
gap — Postgres refuses to run a trigger function outside trigger
context regardless of who has `EXECUTE` on it (it errors on the missing
`NEW`/`OLD` record) — but this instance's confirmed default ACL grants
`EXECUTE` to `anon`/`authenticated` on every new `public` function the
same way it does for `find_similar_photos`/the two group RPCs, and
revoking it here keeps every function in this plan under the same
explicit discipline rather than leaving one silently exempted.

```sql
create table public.pinmap_photo_group_members (
  group_id uuid not null references public.pinmap_photo_groups(id) on delete cascade,
  photo_id uuid not null references public.pinmap_place_photos(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, photo_id)
);
alter table public.pinmap_photo_group_members enable row level security;

create index pinmap_photo_group_members_photo_id_idx on public.pinmap_photo_group_members (photo_id);
```

`name` has a non-blank check but no `unique (user_id, name)` — deliberate,
not an oversight: reusing a name across years ("Iceland 2024", a second
"Iceland" trip later) is legitimate, and forcing uniqueness would block
that. The "existing group ▾" picker in the mass-action toolbar
disambiguates same-named groups by showing creation date and member count.

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

**Membership rows have no cap of their own — this is real but
pre-existing, not a gap this plan introduces.** A council review pointed
out that `pinmap_photo_group_members_insert_own` (above) authorizes
unbounded row creation the same way the groups table did before the cap
trigger, and asked why the same threat model wasn't applied here too. The
difference: every membership row requires an owned `photo_id` (the
insert policy's ownership-check clause above), and
`(group_id, photo_id)` is the primary key, so the ceiling on membership
rows is "however many photos this account
owns, times its 200-group cap" — large, but not the same open-ended "any
authenticated account, any number of rows" shape the groups table had
without its trigger. That real ceiling traces back to
`pinmap_place_photos_insert_own`, which already permits unlimited
self-owned photo inserts today — a condition of the existing schema this
plan builds on top of, not something it introduces, and out of scope to
fix here. Capping membership-row count without capping the photos table
itself wouldn't close the actual gap the review is pointing at.

**"Add to group"/"Remove from group" are bulk operations, one round trip
per action, not a per-photo loop — and both are Postgres functions, not
raw PostgREST table calls.** Unlike the four triage-status actions,
nothing constrains these two to reuse an existing single-photo function
(they're new code either way), so a council review's "why loop
one-at-a-time when nothing requires it" critique applies squarely here
and is adopted. Earlier drafts of this paragraph went through two more
shapes before landing here, each caught by a later review: a raw bulk
`.insert()`/`.delete()` pair (the `.insert()` has no `WHERE`, so a stale
photo id would abort the whole batch instead of being skipped; the
`.delete().in("photo_id", [...])` puts the id list in the URL query
string, the same failure shape this doc condemns for the group-filtered
fetch); then a pair of `security invoker` functions that fixed both of
those but turned out to have their own gap — `add_photos_to_group`'s
"a bad `group_id` fails the whole call" guarantee silently broke if
every `photo_id` happened to get filtered out first (the insert would
then touch zero rows, so `WITH CHECK` never ran to catch the bad group),
and `remove_photos_from_group`'s existence check ran as a separate
statement before its `DELETE`, leaving a TOCTOU window where a
concurrently-deleted group between the two produced exactly the silent
"0 removed" the check was written to prevent. Also, one of those two —
`add_photos_to_group` — wasn't valid SQL to begin with: a data-modifying
`INSERT` can't sit inside a `FROM` subquery, only at the top of a `WITH`.

Both problems share one fix: check group ownership _first_, as its own
statement, with `for update` so the check and the write can't straddle a
concurrent deletion, and do it identically in both functions instead of
leaning on RLS/`WITH CHECK` to surface it as a side effect:

```sql
create or replace function public.add_photos_to_group(
  p_group_id uuid,
  p_photo_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_added integer;
begin
  if not exists (
    select 1 from public.pinmap_photo_groups
    where id = p_group_id and user_id = auth.uid()
    for update
  ) then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  insert into public.pinmap_photo_group_members (group_id, photo_id)
  select p_group_id, photo_id
  from unnest(p_photo_ids) as photo_id
  where photo_id in (
    select id from public.pinmap_place_photos where user_id = auth.uid()
  )
  on conflict (group_id, photo_id) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

create or replace function public.remove_photos_from_group(
  p_group_id uuid,
  p_photo_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
begin
  if not exists (
    select 1 from public.pinmap_photo_groups
    where id = p_group_id and user_id = auth.uid()
    for update
  ) then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  delete from public.pinmap_photo_group_members
  where group_id = p_group_id and photo_id = any(p_photo_ids);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function public.add_photos_to_group(uuid, uuid[]),
  public.remove_photos_from_group(uuid, uuid[])
  from public, anon;
grant execute on function public.add_photos_to_group(uuid, uuid[]),
  public.remove_photos_from_group(uuid, uuid[])
  to authenticated;
```

`security invoker`, not `definer`, for both — neither needs elevated
privilege; RLS on the target tables is exactly the access control wanted
here, unlike `find_similar_photos` below (RLS still applies underneath
this check as defense in depth, it's just no longer the thing the client
relies on to detect a bad `group_id`). `select ... for update` on the
group row is what closes the race: if a concurrent `DELETE` on that same
group row is in flight, this blocks until it commits or rolls back — if
it commits, the row is gone and the `exists` check correctly fails; if
it rolls back, the check proceeds against the still-valid row. Both
functions raise the same custom code (`errcode = 'P0002'`, not
Postgres's `raise exception` default of `P0001`, precisely so a caller
can tell "this plan's own explicit ownership check failed" apart from
any other exception a future change might raise from inside these
functions) on a missing/foreign group, so the client maps one error
code to "this group no longer exists" for both actions — not two
different codes, which an earlier draft of this section wrongly claimed
`add_photos_to_group` would raise via a `WITH CHECK` violation (`42501`)
while `remove_photos_from_group` raised `P0001`; unifying both functions
onto the same explicit check removes that inconsistency along with the
race, not just papers over the wording. `add_photos_to_group` still
filters photo ownership inside its own `insert ... select` (not via
`WITH CHECK`) so a deleted or never-owned photo id silently disappears
from what's written rather than being treated as an error — that part
of the design is unchanged. Both functions' `row_count` result is
exactly the summary UI's "N added"/"N removed" (see "Mass actions"
below) — not `photoIds.length`, which would misreport already-members
or already-removed ids as freshly acted on.

The client-side repository functions `addPhotosToGroup`/
`removePhotosFromGroup` (`src/lib/photosRepository.ts`) are thin RPC
wrappers around `add_photos_to_group`/`remove_photos_from_group` —
same `(groupId, photoIds: uuid[])` shape, just naming that matches this
codebase's existing camelCase repository convention rather than the
database's snake_case function names. Neither bulk call has a per-item
`ok`/`conflict`/`error` outcome to report — `add_photos_to_group`'s
`on conflict do nothing` folds a re-added existing member into the same
call's overall count silently, and `remove_photos_from_group`'s result
is a single number, not N outcomes — see "Mass actions" below for how
the summary UI reflects that difference from the four looped actions.

**`find_similar_photos` RPC** — the "more like this" backend. A council
review of this doc's first draft found the security model here was wrong
in a way that would have made it fail for every real user: the original
draft declared `security invoker` while the function body reads
`p1.embedding`/`p2.embedding`, a column this plan explicitly never grants
to `authenticated`. Under `invoker`, the _caller's_ column privileges
apply inside the function — so every real call would hit a permission
error on the `embedding` column. The stated rationale ("RPC return values
bypass column grants, so a curated return list is needed to avoid leaking
`embedding`") describes `security definer` behavior, not `invoker` — the
reasoning was right, the declaration contradicted it. Fixed by actually
using `security definer`, which needs its own explicit ownership check
(RLS doesn't apply to a definer's underlying table access) and a pinned
`search_path` (routine hardening for definer functions):

```sql
create or replace function public.find_similar_photos(
  p_photo_id uuid,
  p_limit integer default 24
)
returns table (
  id uuid,
  storage_path text,
  place_query text,
  skipped_at timestamptz,
  label text,
  caption text,
  tags text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p2.id, p2.storage_path, p2.place_query, p2.skipped_at, p2.label, p2.caption, p2.tags, p2.created_at
  from public.pinmap_place_photos p1
  join public.pinmap_place_photos p2
    on p2.user_id = p1.user_id
    and p2.id <> p1.id
    and p2.embedding is not null
  where p1.id = p_photo_id
    and p1.user_id = auth.uid()
    and p1.embedding is not null
  order by p2.embedding <=> p1.embedding
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.find_similar_photos(uuid, integer)
  from public, anon;
grant execute on function public.find_similar_photos(uuid, integer) to authenticated;
```

`security definer` runs as the function's owner — table owners bypass
their own tables' RLS by default (no `force row level security` is set
on either table here), so table access inside this function isn't
gated by policy at all, which is exactly why `p1.user_id = auth.uid()`
is required explicitly in the query itself, not left to RLS. The revoke needs to name
`anon` explicitly, not just `public` — checked directly against this
instance's real `pg_default_acl` (not assumed): this Supabase install
grants `EXECUTE` on new functions in `public` **directly** to `anon` and
`authenticated` at creation time, not through the `PUBLIC` pseudo-role,
so `revoke ... from public` alone would leave `anon`'s own direct grant
in place. `set search_path = public` is correct here specifically because
this instance's `vector` extension was installed into `public` (also
checked directly, not assumed — some Supabase setups put it in a separate
`extensions` schema instead, which would need a two-schema search path
there). Both of these are environment facts, not universal
Postgres/Supabase defaults — re-verify them if this is ever ported to a
different instance. The trailing `, pg_temp` (also on the trigger
function above) is not a formality: a plain `set search_path = public`
still searches the session's temp schema _first_, implicitly and before
`public` — a later review caught that this leaves the unqualified `<=>`
operator (and any other unqualified reference) resolvable against a
temp-schema object that shadows the real one, which is exactly what
pinning a `search_path` on a `security definer` function is meant to
close off. Naming `pg_temp` explicitly, last, removes that shadowing
window; it doesn't disable the temp schema, it just stops it from being
searched ahead of the schemas actually intended. The explicit ownership check means that even if
called, the function can only ever return the caller's own photos. This
is the P0 gate for this piece — see `image-group-todo.md`, "P0 — Schema":
verify against a throwaway container that replicates _both_ this
instance's RLS setup _and_ its default-privilege grants. A plain
`pgvector/pgvector:pg16` container starts with none of what this plan's
DDL needs — no `auth` schema at all (`auth.users`, `auth.uid()`, both
referenced by every new table and policy here), no `anon`/`authenticated`
roles, no default ACLs. The setup script has to stand up all of it before
applying any of this plan's SQL, not just the roles/ACLs — the `auth`
schema stub this session already uses for every RLS verification (see
the `unassign_own` verification earlier this session for the full
pattern):

```sql
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
```

— plus the `anon`/`authenticated` roles and their default ACLs, or the
`anon`-rejected-outright check would pass for the wrong reason (no grant
existed to test against, not a real rejection). Also confirm the
container's `vector` extension version and install schema actually match
production (query `pg_extension` for `extversion`/`extnamespace` on both)
before trusting any similarity-search result from it, and check this
project's actual configured PostgREST row cap (`db-max-rows`) rather than
assuming the commonly-cited 1000 default — the cursor-pagination design
elsewhere in this plan is cap-value-agnostic, but the reasoning that
motivated it deserves a real number, not an assumed one. This confirmed
number matters for a second reason beyond pagination: `db-max-rows`
truncates PostgREST responses for _any_ resource that returns a set,
which includes a `setof`/`table`-returning RPC like `find_similar_photos`
— a later review pointed out this connection was never drawn. "More like
this" always requests `p_limit=100` in one unpaginated call (see "More
like this" below); if the confirmed cap is below 100, the response is
truncated there too, silently, the same failure shape the doc already
warns about for fetches. The "showing N of M" design (below) already
defines M as the RPC's actual returned count rather than the requested
100, so a truncated response doesn't make M _wrong_ — but it does make
"M" an artifact of the row cap rather than a true count of similar
photos, worth confirming isn't happening unnoticed. Checks: cross-user
isolation, a non-owner's `p_photo_id` returning zero rows, `anon`
rejected outright, and a source photo with ≥100 genuine matches actually
returning 100 rows (not silently fewer) — before touching production,
same as every other RLS-adjacent change this session. One more grant to
actually check rather than assume, per that same standard: this instance
already confirmed default ACLs grant function `EXECUTE` directly to
`anon`/`authenticated` outside the `PUBLIC` pseudo-role (see above) — the
same `pg_default_acl` query should be checked for _table_ privileges too,
to confirm the two new tables don't pick up an unwanted default grant to
`anon` the same way. This plan never issues one deliberately (only
`... to authenticated` above), so this is a "confirm the absence," not a
step expected to find anything — RLS would still block `anon` reads even
if a stray default grant existed, so it's not a live gap, just an
unexamined one worth closing off explicitly rather than assumed away.

### Triage-tab tag filter

A row of tag chips — the 7 fixed taxonomy categories
(`landscape, people, screenshot, document, food, animal, other`) plus an
explicit **"Untagged"** chip — rendered above the photo grid in
`UnsortedPhotosPanel`, alongside the existing Unassigned/Skipped/Assigned
tabs. Narrows whichever tab is currently active, not a fourth tab of its
own (tag and triage-status are independent filter dimensions, not
alternatives). The "Untagged" chip exists because, per the data-readiness
note above, almost the entire backlog has no tags yet — without it, every
category chip together would still leave nearly 8,000 photos with no way
to find them; "Untagged" filters on `caption is null`.

That relies on more than the schema constraint alone — worth being
precise about, since the constraint by itself doesn't fully guarantee it.
`pinmap_place_photos_complete_implies_outputs_check` only guarantees
_complete ⇒ caption/tags/embedding all set_; it says nothing about the
reverse (a `skipped`/`failed` row could in principle have a caption with
no embedding). What actually makes `caption is null` a reliable stand-in
for "no embedding, not yet usably processed" is `scripts/backfill-photo-tags.ts`'s
own write pattern, not just the constraint: per `ai-tagging-plan.md`, the
success path sets `tag_status = 'complete'` and all five output columns
(`caption`, `tags`, `phash`, `embedding`, `tagged_at`) in one atomic
update, and the failure path (`record_photo_tag_failure`) only ever
touches `tag_attempts`/`tag_last_error`/`tag_status` — never `caption`.
The `skipped` path (the doc's own earlier parenthetical named this as an
unexamined case, and it's worth actually checking rather than assuming
away twice): checked against `scripts/lib/tagPhoto.ts` directly —
`tagPhoto()` is the only function that ever produces a caption, and its
own doc comment states callers route video rows to a `skipped` status via
`inferMediaType()` _before_ `tagPhoto()` would ever run, never after —
the function that could write a caption is never even called on the path
that sets `skipped`. All three status transitions
covered, not just two. Given that, the _only_ writer of these columns
never leaves a row with a caption but no embedding. This is an
application-level
invariant this plan is relying on, not a database-enforced one — if the
backfill script's write pattern ever changes, this proxy would need
revisiting. Chosen anyway over also granting `tag_status` because nothing
else in this plan reads it, and one borrowed invariant is simpler than a
second granted column used nowhere else.

One more case worth ruling out explicitly, since the DB constraint alone
doesn't: could a `complete` row have a caption but an _empty_ `tags`
array (`{}`), which would match neither a category chip nor "Untagged"?
Checked against the actual pipeline code, not assumed —
`scripts/lib/tagPhoto.ts`'s `sanitizeTags()` returns `null`, not `[]`,
when zero valid tags survive sanitization, and `parseModelResponse`
treats a `null` tags result as a parse _failure_ — which never reaches
the `complete`/atomic-output-write path at all (it goes through
`record_photo_tag_failure` instead, which never sets `caption`). A
`complete` row's `tags` is therefore always non-empty by construction,
not just by convention — this case doesn't exist, not just doesn't occur
today.

`fetchUnsortedPhotos`/`fetchUnsortedPhotoCount`
(`src/lib/photosRepository.ts`) gain an optional `tag?: string` parameter
(`"untagged"` is a reserved value, not a real taxonomy entry, mapped to
`.is("caption", null)` instead of `.contains("tags", [...])`), applied
alongside the existing status filter — both apply together (e.g.,
"Unassigned photos tagged `people`").

Each card also gets a "More like this" link — its full behavior (what it
switches the grid into, how status-filtering works against the RPC's
results) is specified once, under "More like this" below, not repeated
here; this section only owns the chip row and the `tag` fetch parameter
(P1 scope, per the tracking table — "More like this" is P2).

### Groups

- **Create**: name only (no description/color in this pass — YAGNI).
- **Add members**: via the same multi-select mechanism mass actions use
  (see below) — "Add to group" is itself one of the selection toolbar's
  actions, offering "existing group ▾" or "+ new group inline." Re-adding
  an existing member is a no-op (`on conflict do nothing`, per the schema
  section) folded silently into the call's overall success — this bulk
  call has no per-item outcome to mark it with (see "Mass actions"
  below).
- **Remove members**: only meaningful while looking at a group's own
  member list (removing "from" a group requires knowing which group you
  mean — there's no single "remove from group" action on a card in a
  generic grid that isn't scoped to one). "Remove from group" is a mass
  action available specifically in the group-members view described
  below, alongside a per-card "×" for removing one photo at a time.
- **List/browse a group's members**: does **not** wait on the standalone
  Browse view (P2) — a minimal "My Groups" list (name, member count,
  created date) plus a member grid ships as part of this same P1 piece,
  reusing the shared photo-grid component the triage tabs already use.
  Member counts come from one grouped aggregate query over
  `pinmap_photo_group_members` (`group by group_id`, or an equivalent
  embedded-count select) — never one count query per listed group. Its
  own entry point is a sidebar item, next to the existing "Unsorted"
  button (not gated on the mass-action toolbar being open, which only
  exists in Select mode with an active selection — that's an _action_
  entry point for adding to a group, not a _browsing_ one). The full
  Browse view later folds this list in as one of its filter modes rather
  than replacing it.
- **Delete**: removes the group and its membership rows via the
  membership table's `on delete cascade` on `group_id` — never touches
  `pinmap_place_photos` itself.

### Mass actions

A "Select" mode toggle (checkboxes on cards) available in the triage tabs,
the standalone Browse view, and a group's member view — one shared
selection/toolbar component, not duplicated per surface.

**"Select all matching the current filter" is load-bearing, not
optional** — per-card checkboxes on an infinite-scroll grid alone don't
deliver the actual point of this feature (batch-clearing hundreds or
thousands of backlog photos at once); manually checking each of, say,
400 `people`-tagged Unassigned photos isn't a real workflow. "Select
mode" therefore includes a "Select all N" control scoped to whatever tag/
status/group filter is currently active, not just a per-card toggle. The
`N` on the control itself is the badge count (`fetchUnsortedPhotoCount`
or its Browse/group equivalent) for responsiveness, but that count and
the row-walk below are two separate queries that can legitimately drift
(a photo added/removed between the two) — so the confirmation shown right
before the batch runs states the walk's own actual row count, not the
badge's, and that's the number the batch is scoped to. Badge counts
across every surface are re-fetched once a mass action completes, since
it just changed the counts they display.

The four triage-status actions run as a client-side loop of per-photo
calls (not a single batch `UPDATE`), so "Select all N" needs the full
matching **row** set in hand before it can run any of them — not just
ids: `id` and whichever of `place_query`/`skipped_at` the mixed-status
check below needs, dropping `caption`/`tags`/`label` (columns no
selection-time check reads). It gets that by walking the existing
filtered query's own cursor/pagination — the same one
`fetchUnsortedPhotos`'s infinite scroll already uses, repeated until
exhausted, never a single uncapped fetch: this table's backlog is large
enough (~8,000 rows) that a naive "just raise the page size" request
would silently truncate at PostgREST's own default row cap and act on
fewer photos than the "N" shown. This applies uniformly — the
group-filtered fetch in "Standalone Browse view" below is one round trip
_per page_, not one shot regardless of size; "Select all N" against a
group walks it the same paginated way. Holding rows (not bare ids) is
also what lets the mixed-status check work for a query-based selection
the same way it works for a manual one: status is read off the rows
already in hand, no second query needed. `addPhotosToGroup`/
`removePhotosFromGroup` (below) only need the `id` column from this
walk, since they're a single bulk call, not a loop needing per-photo
status. The one real risk this doesn't try to hide: the held set can go
stale between "Select all N" and the batch actually running (another
session assigns one of the photos in the meantime) — for the four looped
actions this is already handled by the same per-item ok/conflict/error
outcome every action already reports (each one conditions its
write on the row's _live_ state at execution time — e.g.
`assignPhotoPlace`'s `.is("place_query", null)` — not a cached snapshot,
so any staleness is caught regardless of how large the window was); for
the two bulk group calls, see "Schema changes" above for how each
function handles a stale id — both `add_photos_to_group` and
`remove_photos_from_group` silently exclude it from their affected-row
count, and both fail loud instead (a distinct, catchable error) on a
bad `group_id`, since that's a permission problem rather than a
staleness one.

The toolbar offers whatever's valid for the current selection. The four
triage-status actions require every selected photo to already share that
status — hidden entirely (not shown-but-disabled) for any mixed-status
selection, never a partial or best-effort apply. The triage tabs
themselves never produce a
mixed selection (each shows one status at a time), but both the Browse
view and a group's member view can, since neither is scoped to a single
status; this rule applies on any surface, not just Browse. "Add to
group"/"Remove from group" have no such constraint, since group
membership is orthogonal to triage status:

| Action            | Valid when...                                             | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mass Assign       | selection is all-Unassigned                               | one `assignPhotoPlace(id, placeQuery)` call per photo, same already-resolved `placeQuery` string for all — the toolbar resolves the place _once_, before the batch starts, reusing the existing single-photo assign search/create-new-pin UI; `assignPhotoPlace` itself is a plain DB write (`.update({ place_query: placeQuery })`, `src/lib/photosRepository.ts`) with no external call, so the per-photo loop never re-resolves or re-geocodes anything N times |
| Mass Skip         | selection is all-Unassigned                               | one `skipPhoto()` call per selected photo                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Mass Unskip       | selection is all-Skipped                                  | one `unskipPhoto()` call per selected photo                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Mass Unassign     | selection is all-Assigned                                 | one `unassignPhoto()` call per selected photo                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Add to group      | any selection, any surface                                | one `addPhotosToGroup(groupId, photoIds)` call, an RPC wrapper (schema section above) — single round trip, not a loop, `uuid[]` in the POST body                                                                                                                                                                                                                                                                                                                   |
| Remove from group | viewing a group's members, or a single card's "×" (below) | one `removePhotosFromGroup(groupId, photoIds)` call, same RPC-wrapper shape — the "×" is this same function called with a one-element array, not a separate code path                                                                                                                                                                                                                                                                                              |

The four triage-status actions are thin loops over the **existing,
already-verified** single-photo repository functions — `assignPhotoPlace`,
`skipPhoto`, `unskipPhoto`, and `unassignPhoto` in
`src/lib/photosRepository.ts`, whose RLS was written and verified in
`schema_place_photos_update_policy.sql`, `_skip.sql`, `_unskip.sql`, and
`_unassign.sql` respectively — no new RLS surface, no new attack shape to
reason about for _those four_. "Add to group"/"Remove from group" are
different: they touch the brand-new `pinmap_photo_group_members` table
and its policies, which _is_ new RLS surface — already covered by its own
P0 verification step — but since nothing constrains them to a
per-photo-loop shape the way the other four are, they're each one bulk
call instead (see "Schema changes" above), not a fifth/sixth loop.

The four triage-status loops run with a concurrency cap of **5 in-flight
requests** — a UX/rate-limiting tuning choice, not a correctness fork, so
settled here rather than left open through another round of review;
adjust later if 400-photo batches prove too slow or too bursty in
practice — rather than firing hundreds of requests at once.
`addPhotosToGroup`/`removePhotosFromGroup` need no concurrency cap at
all, being one call each regardless of selection size.

Every one of the six actions reports through the same summary UI — "38
assigned, 2 already handled elsewhere, 0 failed." The four loops get this
for free, aggregating the `"ok" | "conflict" | "error"` each per-photo
call already returns (see the repository functions' existing signatures
in `src/lib/photosRepository.ts`). The two bulk calls report a row count
from one response instead of aggregating N — no per-item outcome exists
for them to aggregate, so their contribution to the summary is "N
added"/"N removed" in the same sentence, not N individual entries. A
batch that ends with per-item `error` outcomes (the four looped actions
only) can be retried scoped to just those photos — the toolbar keeps the
`error` subset after a run completes and offers "Retry N failed" instead
of only "run the whole batch again," which would needlessly re-attempt
everything that already succeeded. `conflict` outcomes are deliberately
excluded from that retry set, not merely forgotten: a `conflict` means
the photo's live state no longer matches what the action requires (e.g.
someone else already assigned it), which retrying doesn't change —
retrying an unchanged conflict just conflicts again. `conflict` is
reported in the summary count and nowhere else; only `error` is
retryable.

### Standalone Browse view

A new sidebar entry (alongside "Imports" and "Unsorted"), reachable
regardless of triage status. Shows _all_ of the owner's photos in the same
infinite-scroll grid `UnsortedPhotosPanel` already implements — filterable
by tag chip and/or by group (both apply together — AND, not either/or —
consistent with tag-and-status already composing in the triage tabs), and
offering "more like this" per card, same as the triage tabs. Mass-action
selection works here too.

Mechanically this is mostly **assembly**, not new primitives, but it does
need two genuinely new pieces of query logic, not zero — worth naming
both rather than waving at "just assembly":

- **An "all statuses" fetch and its count sibling — `fetchAllPhotos` and
  `fetchAllPhotosCount`, committed names, not a suggestion.**
  `fetchUnsortedPhotos`'s status filter is the `PhotoTriageStatus` union
  (`unassigned`/`skipped`/`assigned`) today, with no "no filter" option,
  and reusing that name for a function serving every photo (not just the
  unsorted backlog) would read wrong — so these are sibling functions,
  mirroring the existing `fetchUnsortedPhotos`/`fetchUnsortedPhotoCount`
  pair, and keeping both existing functions untouched and their names
  accurate. `fetchAllPhotosCount` is what "Mass actions" above means by
  "its Browse/group equivalent" for the Select-all-N badge on this
  surface — named here explicitly rather than left implicit, the same way
  the group equivalent (the grouped-aggregate member count under
  "Groups") is named in its own section. Both filter by
  `.eq("user_id", userId)` explicitly, same as `fetchUnsortedPhotos`/
  `fetchUnsortedPhotoCount` already do and for the same reason: this
  table's SELECT RLS doesn't scope reads to the owner (see "Decisions"
  above), so the app-level filter is load-bearing, not a formality.
- **Group-filtered fetch.** Filtering the grid to one group's members
  needs an actual join, not a two-step "fetch every membership id, then
  `.in("id", [...])` the photos" — that shape breaks at real scale
  (PostgREST's default row cap on the first fetch, plus a group anywhere
  near backlog size serializing thousands of UUIDs into one request's
  filter). The correct shape is PostgREST's embedded-resource filter in
  one request, translating to
  `supabase.from("pinmap_place_photos").select("id, storage_path, created_at, place_query, skipped_at, label, caption, tags, pinmap_photo_group_members!inner(group_id)").eq("user_id", userId).eq("pinmap_photo_group_members.group_id", groupId)`
  in supabase-js — the explicit column list, not `select("*, …")`: this
  table's grant to `authenticated` is column-level (`embedding`/`phash`/
  `has_face` stay ungranted per "Schema changes" above), and PostgREST
  rejects a bare `*` against a column-scoped grant. The `user_id` filter
  matters independently of the join: `pinmap_place_photos`'s
  SELECT RLS is confirmed non-owner-scoped (see "Decisions" above), so
  this query — like `fetchAllPhotos` below — supplies the owner filter
  itself rather than leaning on RLS for it, the same way
  `fetchUnsortedPhotos` already does today. One round trip _per page_ —
  normal cursor pagination for on-screen display, walked across pages the
  same way as any other filtered query when driving "Select all N" (see
  "Mass actions") — no client-side id list, composes with the tag filter
  the same way the status filter already does. This is the same join the
  group-members view (P1, "Groups" above) needs for its own listing —
  moved here only because the Browse view section is where the
  _composition with a tag
  filter_ is new; the join itself is P1-tracked, under "P1 — Groups" in
  the todo, not gated on this P2 section.

### More like this

The RPC backend is covered in "Schema changes" above. This is the UI half
— listed as its own P2 todo item, separate from the P1 "Triage-tab tag
filter" work, because it's meaningfully separable and can ship after or
before that core without blocking either; the per-card link that triggers
it appears in every surface (triage tabs, Browse view, group-members
view), but its behavior is specified once, here, not per-surface.

A "More like this" link on each card — hidden entirely, not shown-and-
failing or shown-but-disabled, when `caption === null` (no embedding yet;
`caption`/`tags`/`embedding` are only ever set together, per "Triage-tab tag filter"
above) — switches the grid into similar-photos mode for that photo. The
client always calls
`find_similar_photos(photo_id, 100)` — the RPC's clamped maximum, not its
default of 24 — and filters the results client-side to the current
surface's triage status, using the RPC's `place_query`/`skipped_at`
return columns to derive it the same way the rest of the app already does
(`place_query` not null → Assigned; `place_query` null and `skipped_at`
not null → Skipped; both null → Unassigned; no status filtering at all in
the Browse view or a group's member view, neither of which is
status-scoped). The RPC doesn't rank by status, it just returns enough to
derive it.

The UI displays up to 24 of the filtered survivors and shows "showing N
of M similar photos," where **M is the RPC's actual returned row count**
(`.length` of what came back — not the constant 100 requested). Pinning
the message to the literal 100 would be dishonest in the opposite
direction right now: per the data-readiness note, only 19 photos are
tagged today, so the RPC can return at most 18 candidates for any given
source photo — "showing 8 of 100" would claim a candidate pool that
doesn't exist yet, at exactly the moment this feature is most likely to
actually be tested. Requesting the RPC's clamped maximum (100, not the
smaller 24 actually displayed) still matters — it's what M is drawn from
— just not as a hardcoded number in the message. Because status filtering
happens client-side, _after_ that fetch, a same-status match can still
exist beyond whatever M photos the RPC actually returned and never
surface — the indicator communicates _that_ pool size honestly, not a
guarantee that nothing beyond it exists. Pushing the status filter into
the RPC itself (an extra parameter + `where` clause) is the more correct
long-term fix but is deferred — see Open Questions.

A visible "Back to Unassigned"/"Back to Skipped"/etc. control (naming the
status the surface was showing before similar-photos mode was entered, or
just "Back" in the Browse/group-members case) exits back to the normal
filtered grid.

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
   (granted to `authenticated`, per "Decisions" above) through
   `fetchUnsortedPhotos` (triage tabs) or `fetchAllPhotos` (Browse view,
   the sibling function described in "Standalone Browse view" above,
   optionally joined through `pinmap_photo_group_members` for a
   group-filtered fetch), both filterable by tag.
3. "More like this" calls the `find_similar_photos(photo_id, 100)` RPC
   (`security definer`, not a plain filtered fetch) instead.
4. Groups themselves (`createGroup`/`deleteGroup`/`fetchGroups`) are read
   and written directly against `pinmap_photo_groups` via supabase-js,
   RLS-gated the same way every other owner-scoped table in this app
   already is. Membership (`pinmap_photo_group_members`) is read directly
   the same way, but **written only** through the `add_photos_to_group`/
   `remove_photos_from_group` RPCs (see "Schema changes" above) — not a
   raw supabase-js `.insert()`/`.delete()` against that table, for the
   scale and error-handling reasons that section explains.
5. The four triage-status mass actions never touch new tables — they loop
   the existing single-photo mutations. "Add to group" and "Remove from
   group" both touch new state (`pinmap_photo_group_members`).

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

- **A photo can carry zero tags** (not yet processed by the pipeline, or
  processed with `tag_status` `skipped`/`failed` — see
  `schema_place_photos_ai_tags.sql`) — it falls under the "Untagged" chip
  (`caption is null`) rather than any real category, and "more like this"
  is unavailable for it (`find_similar_photos` requires a non-null
  embedding on the source photo — the client can infer this the same way,
  from `caption === null`, without needing `tag_status` itself granted).
- **Deleting a group a mass action is mid-flight against**: a real
  scenario (concurrent sessions/tabs for one account are possible and
  already assumed elsewhere in this plan — see "Select all N" above, not
  something to wave away here as impossible). Both `add_photos_to_group`
  and `remove_photos_from_group` (see "Schema changes" above) are single
  bulk calls, not per-item loops, each starting with the same explicit,
  `for update`-locked check that the group still belongs to the caller
  before doing anything else — this went through two earlier, weaker
  designs (leaning on `WITH CHECK` for add, a plain unlocked `exists`
  check for remove) that two later reviews each found a hole in: the
  `WITH CHECK` approach silently returned "0 added" instead of erroring
  if every photo id happened to get filtered out first, and the unlocked
  check left a TOCTOU window where a concurrent deletion between the
  check and the write reproduced the exact silent "0 removed" it was
  meant to prevent. With the current design, a deleted/foreign
  `group_id` makes both functions raise the same explicit, custom error
  (`errcode = 'P0002'`) before touching `pinmap_photo_group_members` at
  all — not a quiet "0 rows" success, and not dependent on how many (if
  any) of the photo ids in the batch survive their own checks. The
  client maps that one error code to a "this group no longer exists"
  notice for both actions; a genuinely empty removal (valid group,
  already-gone ids) still reports `0` with no error — not a summary
  count either way, since bulk group actions never had per-item outcomes
  to begin with.
- **A photo already in a group gets mass-assigned/skipped/unassigned**:
  group membership is untouched — triage status and group membership are
  deliberately orthogonal, per the "Decisions" section.

## Open Questions

- **Pushing the triage-status filter into `find_similar_photos` itself**
  (an extra parameter + `where` clause), instead of the RPC returning up
  to 100 candidates and the client filtering afterward: the correct fix
  for the "more like this" under-delivery case described above, deferred
  because the client-side workaround (an honest "showing N of M" using
  the real returned count, not a silently sparse grid) is honest about
  its own limit rather than actually broken — revisit if it turns out to
  matter in practice.
- **Browse view pagination**: same infinite-scroll pattern as the triage
  tabs, or does an all-statuses, potentially-larger result set need a
  different page size? Likely no different — revisit only if real usage
  shows otherwise.
- **An ANN index (`ivfflat`/`hnsw`) on `pinmap_place_photos.embedding`**
  for `find_similar_photos`'s `order by ... <=>`: unnecessary at the
  current ~8,000-row scale (a sequential scan is fine), but worth a note
  for whoever revisits this once the full backlog is tagged and the table
  is much larger.

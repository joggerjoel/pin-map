-- Persistent, named, user-created sets of photos, independent of triage
-- status -- the mechanism image-group-plan.md's mass actions operate on.
-- See that doc's "Schema changes" section for the full design rationale;
-- this file is a direct transcription of the reviewed SQL there.
--
-- Follows this schema's existing *write*-policy pattern exactly
-- (auth.uid() = user_id) -- not its read pattern: pinmap_place_photos's
-- SELECT policy is broader than that (any authenticated user can read any
-- owner's photos, not just their own), so "same pattern" here means writes
-- only. This table gets a matching owner-scoped SELECT too, since nothing
-- about groups needs the "or the map owner" read-sharing pinmap_place_photos
-- has.
--
-- `name` has a non-blank check but deliberately no `unique (user_id, name)`
-- -- reusing a name across years ("Iceland 2024", a second "Iceland" trip
-- later) is legitimate, and forcing uniqueness would block that. The
-- client's "existing group" picker disambiguates same-named groups by
-- showing creation date and member count.
--
-- No update policy in this pass -- renaming a group isn't part of the
-- brainstormed scope; add one later if actually needed (YAGNI).

create table public.pinmap_photo_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint pinmap_photo_groups_name_nonblank_check check (btrim(name) <> ''),
  constraint pinmap_photo_groups_name_length_check check (length(name) <= 100)
);
alter table public.pinmap_photo_groups enable row level security;

create index if not exists pinmap_photo_groups_user_id_idx
  on public.pinmap_photo_groups (user_id);

drop policy if exists "pinmap_photo_groups_select_own" on public.pinmap_photo_groups;
create policy "pinmap_photo_groups_select_own" on public.pinmap_photo_groups
  for select using (auth.uid() = user_id);

drop policy if exists "pinmap_photo_groups_insert_own" on public.pinmap_photo_groups;
create policy "pinmap_photo_groups_insert_own" on public.pinmap_photo_groups
  for insert with check (auth.uid() = user_id);

drop policy if exists "pinmap_photo_groups_delete_own" on public.pinmap_photo_groups;
create policy "pinmap_photo_groups_delete_own" on public.pinmap_photo_groups
  for delete using (auth.uid() = user_id);

revoke all on public.pinmap_photo_groups from authenticated, anon;
grant select, insert, delete on public.pinmap_photo_groups to authenticated;

-- UPDATE, despite no update policy existing (see above) and no client ever
-- issuing a real UPDATE against this table: `select ... for update`, used
-- by add_photos_to_group/remove_photos_from_group in
-- schema_photo_group_members.sql to lock a group row while checking
-- ownership, requires UPDATE table privilege in Postgres -- SELECT alone
-- isn't sufficient for FOR UPDATE, confirmed against a throwaway container
-- (the RPCs failed with "permission denied for table pinmap_photo_groups"
-- for every caller, including a group's own owner, until this grant was
-- added). This does NOT open up real updates: with no permissive UPDATE
-- RLS policy, an actual `UPDATE ... SET ...` against this table still
-- affects 0 rows regardless of who's calling -- also confirmed directly
-- against the same container.
grant update on public.pinmap_photo_groups to authenticated;

-- A per-user group-count cap is required, not optional: the insert policy
-- above (auth.uid() = user_id) authorizes group creation for *any*
-- authenticated account, not just the map owner -- the same "any signed-up
-- account, not just the owner" reach this whole schema already has. With no
-- cap, that's free, unbounded row creation for anyone with an account --
-- real, not hypothetical, since account creation itself is outside this
-- feature's control. A BEFORE INSERT trigger, not a CHECK constraint (CHECK
-- can't reference other rows).
--
-- The advisory lock serializes concurrent inserts for the SAME user
-- (hashtext is a 32-bit hash, so a different user's uuid could in principle
-- collide with this one and briefly share the lock -- harmless, just extra
-- serialization, since the count below is still scoped by the real user_id
-- regardless of which lock key two calls happened to share) so two
-- simultaneous requests near the cap can't both observe count < 200 and both
-- commit, overshooting it. A plain count-then-insert without this is a
-- classic TOCTOU race under READ COMMITTED. `security definer` isn't needed
-- here (unlike find_similar_photos in schema_find_similar_photos.sql): the
-- count only ever reads the inserting user's own rows, which this table's
-- own select_own policy above already permits under the caller's own
-- (invoker) privileges.

create or replace function public.pinmap_photo_groups_enforce_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

-- Belt-and-suspenders, not a fix for a real gap: Postgres refuses to run a
-- trigger function outside trigger context regardless of who has EXECUTE on
-- it. But this instance's default ACLs grant EXECUTE to anon/authenticated
-- on every new public function at creation time (confirmed against
-- pg_default_acl, not assumed -- see schema_find_similar_photos.sql), and
-- revoking it here keeps every function this feature adds under the same
-- explicit discipline rather than leaving one silently exempted.
revoke execute on function public.pinmap_photo_groups_enforce_cap()
  from public, anon, authenticated;

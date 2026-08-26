-- Membership rows for pinmap_photo_groups (schema_photo_groups.sql). See
-- image-group-plan.md, "Schema changes," for the full design rationale and
-- review history; this file is a direct transcription of the reviewed SQL
-- there.
--
-- RLS is gated *through the group's own ownership*, not a denormalized
-- user_id column on this table (which could drift from the group's actual
-- owner if ever edited directly).
--
-- Membership rows have no cap of their own -- real but pre-existing, not a
-- gap this feature introduces. Every membership row requires an owned
-- photo_id (the insert policy's ownership-check clause below), and
-- (group_id, photo_id) is the primary key, so the ceiling on membership rows
-- is "however many photos this account owns, times its 200-group cap" --
-- large, but not the same open-ended shape pinmap_photo_groups had before
-- its cap trigger. That real ceiling traces back to
-- pinmap_place_photos_insert_own, which already permits unlimited
-- self-owned photo inserts today -- a condition of the existing schema this
-- feature builds on top of, not something it introduces, and out of scope
-- to fix here.
--
-- No update policy in this pass, same reasoning as pinmap_photo_groups.

create table public.pinmap_photo_group_members (
  group_id uuid not null references public.pinmap_photo_groups(id) on delete cascade,
  photo_id uuid not null references public.pinmap_place_photos(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, photo_id)
);
alter table public.pinmap_photo_group_members enable row level security;

create index if not exists pinmap_photo_group_members_photo_id_idx
  on public.pinmap_photo_group_members (photo_id);

drop policy if exists "pinmap_photo_group_members_select_own"
  on public.pinmap_photo_group_members;
create policy "pinmap_photo_group_members_select_own"
  on public.pinmap_photo_group_members for select
  using (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
  );

drop policy if exists "pinmap_photo_group_members_insert_own"
  on public.pinmap_photo_group_members;
create policy "pinmap_photo_group_members_insert_own"
  on public.pinmap_photo_group_members for insert
  with check (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
    and photo_id in (select id from public.pinmap_place_photos where user_id = auth.uid())
  );

drop policy if exists "pinmap_photo_group_members_delete_own"
  on public.pinmap_photo_group_members;
create policy "pinmap_photo_group_members_delete_own"
  on public.pinmap_photo_group_members for delete
  using (
    group_id in (select id from public.pinmap_photo_groups where user_id = auth.uid())
  );

revoke all on public.pinmap_photo_group_members from authenticated, anon;
grant select, insert, delete on public.pinmap_photo_group_members to authenticated;

-- "Add to group"/"Remove from group" are bulk operations, one round trip
-- per action, not a per-photo loop -- and both are Postgres functions, not
-- raw PostgREST table calls, taking uuid[] in a POST body rather than a
-- URL-encoded filter (a raw `.delete().in("photo_id", [...])` would put the
-- id list in the query string, which breaks at the scale "Select all N"
-- against a group is explicitly allowed to reach).
--
-- Both start with the identical explicit check: does a pinmap_photo_groups
-- row with this id and user_id = auth.uid() exist, locked with `for
-- update`? Raise errcode = 'P0002' if not, *before* touching this table at
-- all. That `for update` lock needs the `authenticated` role to hold
-- UPDATE privilege on pinmap_photo_groups even though the table has no
-- update policy and nothing ever issues a real UPDATE against it -- see
-- the grant and its comment at the bottom of schema_photo_groups.sql, added
-- after this exact "permission denied for table pinmap_photo_groups" error
-- surfaced against a throwaway container for every caller, not just a
-- cross-user case. This isn't the first design tried -- two earlier shapes (leaning on
-- WITH CHECK for add, an unlocked `exists` check for remove) each had a real
-- bug: WITH CHECK never fires if every photo_id gets filtered out before the
-- insert runs (so a bad group_id could silently return "0 added" instead of
-- erroring), and an unlocked check leaves a TOCTOU window where a concurrent
-- group deletion between the check and the write reproduces the exact
-- silent "0 removed" the check exists to prevent. `select ... for update`
-- closes that window: if a concurrent DELETE on that group row is in
-- flight, this blocks until it commits or rolls back -- if it commits, the
-- row is gone and the exists check correctly fails; if it rolls back, the
-- check proceeds against the still-valid row.
--
-- security invoker, not definer, for both -- neither needs elevated
-- privilege; RLS on the target tables is exactly the access control wanted
-- here (it still applies underneath the explicit check as defense in
-- depth, it's just no longer the thing the client relies on to detect a
-- bad group_id). add_photos_to_group filters photo ownership inside its own
-- insert ... select (not via WITH CHECK) so a deleted or never-owned photo
-- id silently disappears from what's written rather than being treated as
-- an error.
--
-- Both functions return the actual affected-row count via `get diagnostics
-- ... = row_count` -- that's the summary UI's "N added"/"N removed," not
-- photoIds.length, which on-conflict-do-nothing/already-removed ids would
-- make wrong.

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

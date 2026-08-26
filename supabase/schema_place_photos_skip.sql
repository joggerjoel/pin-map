-- Persisted "skip" for the unsorted-photo triage panel — reverses the
-- original 2026-08-25 design (docs/superpowers/specs/
-- 2026-08-25-unsorted-photo-triage-design.md), which deliberately made
-- Skip session-only ("it's just a filter"). Skipped photos now stay
-- hidden from the unsorted grid across reloads/sessions instead of
-- reappearing every time the panel is reopened.
--
-- Mirrors schema_place_photos_update_policy.sql's shape exactly (same
-- pattern, a second independent action instead of a second copy of the
-- assign policy): a photo can be skipped only while it's still
-- unassigned and not already skipped, via its own UPDATE policy and its
-- own column-scoped grant. Multiple permissive UPDATE policies on the
-- same table are OR'd independently for USING and WITH CHECK, so this
-- doesn't disturb the existing assign policy at all.

alter table public.pinmap_place_photos
  add column if not exists skipped_at timestamptz;

drop policy if exists "pinmap_place_photos_skip_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_skip_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id and place_query is null and skipped_at is null)
  with check (auth.uid() = user_id and skipped_at is not null);

grant update (skipped_at) on public.pinmap_place_photos to authenticated;

-- Postgres ORs every permissive policy's USING and WITH CHECK
-- independently across ALL of a table's policies for the same command --
-- not per-policy. That means a single UPDATE combining place_query AND
-- skipped_at in one request can satisfy pinmap_place_photos_update_own's
-- with_check (which only validates place_query, has no idea skipped_at
-- also changed) even though neither the skip action nor the assign
-- action alone was ever meant to touch the other's column. Verified by
-- direct reproduction: an UPDATE setting both `place_query = 'Hijacked'`
-- and `skipped_at = now()` on a previously-unassigned row succeeds
-- without this trigger, because 'Hijacked' independently satisfies the
-- assign policy's own non-blank check regardless of skipped_at.
--
-- A second/tightened RLS policy can't close this: WITH CHECK only ever
-- sees the proposed NEW row, never OLD, so no policy expression can
-- assert "place_query must be unchanged by this write". A trigger can
-- see both and is evaluated unconditionally, independent of which
-- policy's OR-ed check happened to admit the request.
create or replace function public.pinmap_place_photos_prevent_skip_reassign()
returns trigger
language plpgsql
as $$
begin
  if old.skipped_at is null and new.skipped_at is not null
     and new.place_query is distinct from old.place_query then
    raise exception 'cannot change place_query in the same update as skipped_at';
  end if;
  return new;
end;
$$;

drop trigger if exists pinmap_place_photos_prevent_skip_reassign
  on public.pinmap_place_photos;
create trigger pinmap_place_photos_prevent_skip_reassign
  before update on public.pinmap_place_photos
  for each row
  execute function public.pinmap_place_photos_prevent_skip_reassign();

-- The client needs to both filter on skipped_at (fetchUnsortedPhotos,
-- fetchUnsortedPhotoCount) and read it back after an update
-- (assign/skip's .select("id") pattern doesn't need this, but a future
-- caller might) -- grant select on it explicitly, since
-- schema_place_photos_ai_tags.sql already replaced the table's previous
-- bare `grant select` with a column-scoped one. Additive: this doesn't
-- touch any other column's grant.
grant select (skipped_at) on public.pinmap_place_photos to anon, authenticated;

-- Matches pinmap_place_photos_unsorted_idx's shape (from the update-policy
-- migration) but scoped to the query fetchUnsortedPhotos/Count actually run
-- post-skip: unassigned AND not-skipped.
create index if not exists pinmap_place_photos_unsorted_unskipped_idx
  on public.pinmap_place_photos (user_id, created_at, id)
  where place_query is null and skipped_at is null;

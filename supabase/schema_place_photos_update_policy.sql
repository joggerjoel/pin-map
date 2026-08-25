-- Lets an owner assign a place to their own unsorted photos
-- (place_query is null) — see docs/superpowers/specs/
-- 2026-08-25-unsorted-photo-triage-design.md. schema_place_photos.sql has
-- select/insert/delete policies but no update.

drop policy if exists "pinmap_place_photos_update_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_update_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id and place_query is null)
  with check (
    auth.uid() = user_id
    and place_query is not null
    and btrim(place_query) <> ''
  );

revoke update on public.pinmap_place_photos from authenticated, anon;
grant update (place_query) on public.pinmap_place_photos to authenticated;

create index if not exists pinmap_place_photos_unsorted_idx
  on public.pinmap_place_photos (user_id, created_at, id)
  where place_query is null;

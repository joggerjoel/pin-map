-- A short, user-editable label per photo in the unsorted triage panel, so
-- the owner has something stable and human-chosen to reference a specific
-- photo by when reporting a problem (the alternative -- an 8-char id
-- prefix -- works but isn't memorable). Falls back to the id prefix in the
-- UI when no label has been set; this column itself is always optional.
--
-- Scoped identically to schema_place_photos_skip.sql's skip policy
-- (place_query is null) -- deliberately, not broader. A wider USING clause
-- here (e.g. "any row the owner owns") would make already-assigned rows
-- selectable again for UPDATE via this policy's OR-ed USING, which would
-- undo the place_query-immutability intent of the assign policy: a
-- combined write like `set label = 'x', place_query = 'Hijacked'` against
-- an already-assigned row would become selectable through THIS policy even
-- though neither the assign nor the skip policy would have allowed
-- touching that row at all. Keeping the scope identical to skip's avoids
-- reopening that door instead of needing another trigger to close it.

alter table public.pinmap_place_photos
  add column if not exists label text;

alter table public.pinmap_place_photos
  add constraint pinmap_place_photos_label_length_check
    check (label is null or length(label) <= 100);

drop policy if exists "pinmap_place_photos_label_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_label_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id and place_query is null)
  with check (auth.uid() = user_id and place_query is null);

grant update (label) on public.pinmap_place_photos to authenticated;
grant select (label) on public.pinmap_place_photos to anon, authenticated;

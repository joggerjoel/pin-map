-- Photos attached to pinned places. Storage objects live in the public
-- "pin-photos" bucket at {user_id}/{uuid}.{ext}; this table is what
-- associates an uploaded object with a place (keyed by query text, matching
-- how pins/tags are already associated in this schema).

create table if not exists public.pinmap_place_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_query text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.pinmap_place_photos enable row level security;

create policy "pinmap_place_photos_select_own_or_owner"
  on public.pinmap_place_photos for select
  using (
    auth.uid() = user_id
    or user_id in (select user_id from public.pinmap_owner)
  );

create policy "pinmap_place_photos_insert_own"
  on public.pinmap_place_photos for insert
  with check (auth.uid() = user_id);

create policy "pinmap_place_photos_delete_own"
  on public.pinmap_place_photos for delete
  using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.pinmap_place_photos to anon;
grant select, insert, delete on public.pinmap_place_photos to authenticated;

-- Public bucket: reads (thumbnails) never need auth, matching the rest of
-- the app's public-by-default view. Writes are still gated below.
insert into storage.buckets (id, name, public)
values ('pin-photos', 'pin-photos', true)
on conflict (id) do nothing;

create policy "pin_photos_insert_own_folder"
  on storage.objects for insert
  with check (
    bucket_id = 'pin-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "pin_photos_delete_own_folder"
  on storage.objects for delete
  using (
    bucket_id = 'pin-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

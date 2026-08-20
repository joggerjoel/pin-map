-- Additional photos classmates can attach to a roster person — a recent
-- photo (year is null) or a photo from a specific year. Distinct from the
-- official class1989 portrait (pinmap_class_roster.image_url, on Cloudflare
-- R2) — these are user-uploaded, so they reuse the existing "pin-photos"
-- Supabase Storage bucket and its per-uploader-folder RLS policy, just
-- under a class-roster-specific path prefix.

create table if not exists public.pinmap_class_roster_photos (
  id uuid primary key default gen_random_uuid(),
  class_slug text not null,
  person_id integer not null,
  storage_path text not null,
  year integer,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.pinmap_class_roster_photos enable row level security;

create policy "pinmap_class_roster_photos_select_authenticated"
  on public.pinmap_class_roster_photos for select
  to authenticated
  using (true);

create policy "pinmap_class_roster_photos_insert_own"
  on public.pinmap_class_roster_photos for insert
  to authenticated
  with check (auth.uid() = uploaded_by);

create policy "pinmap_class_roster_photos_delete_own"
  on public.pinmap_class_roster_photos for delete
  to authenticated
  using (auth.uid() = uploaded_by);

grant usage on schema public to authenticated;
grant select, insert, delete on public.pinmap_class_roster_photos to authenticated;

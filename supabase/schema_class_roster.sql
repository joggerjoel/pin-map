-- Roster for the "?class=<slug>" shared reunion feature. Scoped by
-- class_slug so multiple class instances could exist later. Readable and
-- writable by any authenticated user — access control for this feature is
-- "must be logged in and know the URL" (the class_slug), not a stronger
-- per-class membership check, matching the feature's stated design.

create table if not exists public.pinmap_class_roster (
  class_slug text not null,
  id integer not null,
  filename text not null,
  image_url text not null,
  high_school_name text not null default '',
  current_name text not null default '',
  hometown text not null default '',
  living text not null default '',
  current_location text not null default '',
  updated_at timestamptz not null default now(),
  primary key (class_slug, id)
);

alter table public.pinmap_class_roster enable row level security;

create policy "pinmap_class_roster_select_authenticated"
  on public.pinmap_class_roster for select
  to authenticated
  using (true);

create policy "pinmap_class_roster_upsert_authenticated"
  on public.pinmap_class_roster for insert
  to authenticated
  with check (true);

create policy "pinmap_class_roster_update_authenticated"
  on public.pinmap_class_roster for update
  to authenticated
  using (true)
  with check (true);

grant usage on schema public to authenticated;
grant select, insert, update on public.pinmap_class_roster to authenticated;

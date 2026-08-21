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
  living_lat double precision,
  living_lng double precision,
  current_location text not null default '',
  updated_at timestamptz not null default now(),
  primary key (class_slug, id)
);

alter table public.pinmap_class_roster enable row level security;

-- These reference pinmap_class_user_can_read/_can_write, defined in
-- schema_class_access_control.sql — apply that file first on a fresh
-- install.
create policy "pinmap_class_roster_select_authenticated"
  on public.pinmap_class_roster for select
  to authenticated
  using (public.pinmap_class_user_can_read(class_slug));

create policy "pinmap_class_roster_upsert_authenticated"
  on public.pinmap_class_roster for insert
  to authenticated
  with check (public.pinmap_class_user_can_write(class_slug));

create policy "pinmap_class_roster_update_authenticated"
  on public.pinmap_class_roster for update
  to authenticated
  using (public.pinmap_class_user_can_write(class_slug))
  with check (public.pinmap_class_user_can_write(class_slug));

grant usage on schema public to authenticated;
grant select, insert, update on public.pinmap_class_roster to authenticated;

-- Shared "who I met, where, and when" board for the "?class=<slug>"
-- reunion feature. Every authenticated visitor who knows the class_slug
-- (via the URL) sees the same collaborative set of entries — unlike the
-- travel map, this is not scoped to a single owner or per-user isolated.
--
-- met_person_name is a denormalized snapshot of the roster display name at
-- submission time (not a strict FK to pinmap_class_roster) so an entry
-- stays meaningful even if that person's name is edited later.

create table if not exists public.pinmap_class_meetups (
  id uuid primary key default gen_random_uuid(),
  class_slug text not null,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submitted_by_email text not null,
  met_person_id integer,
  met_person_name text not null,
  query text not null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  met_date text not null default '',
  created_at timestamptz not null default now()
);

alter table public.pinmap_class_meetups enable row level security;

create policy "pinmap_class_meetups_select_authenticated"
  on public.pinmap_class_meetups for select
  to authenticated
  using (true);

create policy "pinmap_class_meetups_insert_own"
  on public.pinmap_class_meetups for insert
  to authenticated
  with check (auth.uid() = submitted_by);

create policy "pinmap_class_meetups_delete_own"
  on public.pinmap_class_meetups for delete
  to authenticated
  using (auth.uid() = submitted_by);

grant usage on schema public to authenticated;
grant select, insert, delete on public.pinmap_class_meetups to authenticated;

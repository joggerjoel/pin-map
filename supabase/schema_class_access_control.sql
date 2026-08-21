-- Admin access control for the "?class=<slug>" reunion feature.
-- joel.labelle@gmail.com is the sole administrator — hardcoded here since
-- there's exactly one admin, not a role/membership system.
--
-- pinmap_class_logins is an append-only record of "this user opened the
-- signed-in class app" — the admin's audit trail of who has signed in and
-- when.
--
-- pinmap_class_user_access holds an explicit status per (class_slug,
-- user_id): 'active' (default — no row means active), 'read_only' (can
-- view, can't write), or 'disabled' (can't view or write). The two helper
-- functions below are called from every other class-reunion table's RLS
-- policies, so restricting someone takes effect immediately at the
-- database layer, not just by hiding buttons in the UI.

create table if not exists public.pinmap_class_logins (
  id uuid primary key default gen_random_uuid(),
  class_slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  logged_in_at timestamptz not null default now()
);

alter table public.pinmap_class_logins enable row level security;

drop policy if exists "pinmap_class_logins_select_admin" on public.pinmap_class_logins;
create policy "pinmap_class_logins_select_admin"
  on public.pinmap_class_logins for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'joel.labelle@gmail.com');

drop policy if exists "pinmap_class_logins_insert_own" on public.pinmap_class_logins;
create policy "pinmap_class_logins_insert_own"
  on public.pinmap_class_logins for insert
  to authenticated
  with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert on public.pinmap_class_logins to authenticated;

create table if not exists public.pinmap_class_user_access (
  class_slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'read_only', 'disabled')),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (class_slug, user_id)
);

alter table public.pinmap_class_user_access enable row level security;

drop policy if exists "pinmap_class_user_access_select_self_or_admin" on public.pinmap_class_user_access;
create policy "pinmap_class_user_access_select_self_or_admin"
  on public.pinmap_class_user_access for select
  to authenticated
  using (
    auth.uid() = user_id
    or auth.jwt() ->> 'email' = 'joel.labelle@gmail.com'
  );

drop policy if exists "pinmap_class_user_access_write_admin" on public.pinmap_class_user_access;
create policy "pinmap_class_user_access_write_admin"
  on public.pinmap_class_user_access for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'joel.labelle@gmail.com')
  with check (auth.jwt() ->> 'email' = 'joel.labelle@gmail.com');

grant usage on schema public to authenticated;
grant select, insert, update on public.pinmap_class_user_access to authenticated;

create or replace function public.pinmap_class_user_can_read(p_class_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select status <> 'disabled'
      from public.pinmap_class_user_access
      where class_slug = p_class_slug and user_id = auth.uid()
    ),
    true
  );
$$;

create or replace function public.pinmap_class_user_can_write(p_class_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select status = 'active'
      from public.pinmap_class_user_access
      where class_slug = p_class_slug and user_id = auth.uid()
    ),
    true
  );
$$;

grant execute on function public.pinmap_class_user_can_read(text) to authenticated;
grant execute on function public.pinmap_class_user_can_write(text) to authenticated;

-- Enforce read/write status on the roster.
drop policy if exists "pinmap_class_roster_select_authenticated" on public.pinmap_class_roster;
create policy "pinmap_class_roster_select_authenticated"
  on public.pinmap_class_roster for select
  to authenticated
  using (public.pinmap_class_user_can_read(class_slug));

drop policy if exists "pinmap_class_roster_upsert_authenticated" on public.pinmap_class_roster;
create policy "pinmap_class_roster_upsert_authenticated"
  on public.pinmap_class_roster for insert
  to authenticated
  with check (public.pinmap_class_user_can_write(class_slug));

drop policy if exists "pinmap_class_roster_update_authenticated" on public.pinmap_class_roster;
create policy "pinmap_class_roster_update_authenticated"
  on public.pinmap_class_roster for update
  to authenticated
  using (public.pinmap_class_user_can_write(class_slug))
  with check (public.pinmap_class_user_can_write(class_slug));

-- Enforce read/write status on meetups.
drop policy if exists "pinmap_class_meetups_select_authenticated" on public.pinmap_class_meetups;
create policy "pinmap_class_meetups_select_authenticated"
  on public.pinmap_class_meetups for select
  to authenticated
  using (public.pinmap_class_user_can_read(class_slug));

drop policy if exists "pinmap_class_meetups_insert_own" on public.pinmap_class_meetups;
create policy "pinmap_class_meetups_insert_own"
  on public.pinmap_class_meetups for insert
  to authenticated
  with check (
    auth.uid() = submitted_by
    and public.pinmap_class_user_can_write(class_slug)
  );

drop policy if exists "pinmap_class_meetups_delete_own" on public.pinmap_class_meetups;
create policy "pinmap_class_meetups_delete_own"
  on public.pinmap_class_meetups for delete
  to authenticated
  using (
    auth.uid() = submitted_by
    and public.pinmap_class_user_can_write(class_slug)
  );

-- Enforce read/write status on roster photos.
drop policy if exists "pinmap_class_roster_photos_select_authenticated" on public.pinmap_class_roster_photos;
create policy "pinmap_class_roster_photos_select_authenticated"
  on public.pinmap_class_roster_photos for select
  to authenticated
  using (public.pinmap_class_user_can_read(class_slug));

drop policy if exists "pinmap_class_roster_photos_insert_own" on public.pinmap_class_roster_photos;
create policy "pinmap_class_roster_photos_insert_own"
  on public.pinmap_class_roster_photos for insert
  to authenticated
  with check (
    auth.uid() = uploaded_by
    and public.pinmap_class_user_can_write(class_slug)
  );

drop policy if exists "pinmap_class_roster_photos_delete_own" on public.pinmap_class_roster_photos;
create policy "pinmap_class_roster_photos_delete_own"
  on public.pinmap_class_roster_photos for delete
  to authenticated
  using (
    auth.uid() = uploaded_by
    and public.pinmap_class_user_can_write(class_slug)
  );

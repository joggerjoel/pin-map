-- Adds a designated "owner" whose pinmap_pinned_places rows are readable by
-- anyone (anon or authenticated) — the public default view. Authenticated
-- users still only ever read/write their own rows via their own explicit
-- queries; this policy is a security backstop, not something the app relies
-- on to auto-merge an authenticated non-owner's view with the owner's data.

create table if not exists public.pinmap_owner (
  user_id uuid primary key references auth.users(id)
);

alter table public.pinmap_owner enable row level security;

create policy "pinmap_owner_select_all"
  on public.pinmap_owner for select
  using (true);

grant usage on schema public to anon, authenticated;
grant select on public.pinmap_owner to anon, authenticated;

drop policy if exists "pinmap_pinned_places_select_own" on public.pinmap_pinned_places;

create policy "pinmap_pinned_places_select_own_or_owner"
  on public.pinmap_pinned_places for select
  using (
    auth.uid() = user_id
    or user_id in (select user_id from public.pinmap_owner)
  );

grant select on public.pinmap_pinned_places to anon;
grant select, insert, update, delete on public.pinmap_pinned_places to authenticated;

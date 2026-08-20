-- Pin Map account-backed storage. Scoped with a pinmap_ prefix since this
-- Postgres instance is shared with other projects on aorus4. Each table is
-- RLS-protected so a user can only ever see/modify their own rows.

create extension if not exists pgcrypto;

create table if not exists public.pinmap_pinned_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  category text,
  icon text,
  custom_tag_id text,
  date text,
  created_at timestamptz not null default now(),
  unique (user_id, query)
);

alter table public.pinmap_pinned_places enable row level security;

create policy "pinmap_pinned_places_select_own"
  on public.pinmap_pinned_places for select
  using (auth.uid() = user_id);

create policy "pinmap_pinned_places_insert_own"
  on public.pinmap_pinned_places for insert
  with check (auth.uid() = user_id);

create policy "pinmap_pinned_places_update_own"
  on public.pinmap_pinned_places for update
  using (auth.uid() = user_id);

create policy "pinmap_pinned_places_delete_own"
  on public.pinmap_pinned_places for delete
  using (auth.uid() = user_id);

create table if not exists public.pinmap_custom_tags (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  color text not null,
  icon_shape text not null default 'none',
  primary key (user_id, id)
);

alter table public.pinmap_custom_tags enable row level security;

create policy "pinmap_custom_tags_all_own"
  on public.pinmap_custom_tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.pinmap_tag_appearance (
  user_id uuid not null references auth.users(id) on delete cascade,
  builtin_key text not null,
  color text not null,
  icon_shape text not null,
  primary key (user_id, builtin_key)
);

alter table public.pinmap_tag_appearance enable row level security;

create policy "pinmap_tag_appearance_all_own"
  on public.pinmap_tag_appearance for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

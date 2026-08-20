-- Per-account UI preferences that should follow the user across browsers and
-- devices. declutterSettings.ts's localStorage value remains the
-- signed-out/offline fallback and initial paint value; this table is the
-- source of truth once a user is signed in.

create table if not exists public.pinmap_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  declutter_enabled boolean not null default false
);

alter table public.pinmap_user_settings enable row level security;

create policy "pinmap_user_settings_all_own"
  on public.pinmap_user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.pinmap_user_settings to authenticated;

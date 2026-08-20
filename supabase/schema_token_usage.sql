-- Per-account usage counters that gate access to the shared/bundled Mapbox
-- token (VITE_MAPBOX_TOKEN). Once a non-owner account crosses either
-- threshold, the app stops using the bundled token for them and requires
-- their own (see src/lib/tokenUsage.ts, src/App.tsx). The owner is always
-- exempt — decided in the app, not here.

create table if not exists public.pinmap_token_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  places_pinned_count integer not null default 0,
  login_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.pinmap_token_usage enable row level security;

create policy "pinmap_token_usage_select_own"
  on public.pinmap_token_usage for select
  using (auth.uid() = user_id);

-- Atomic increment via a security-definer function scoped to auth.uid()
-- itself, rather than a client-supplied user id — a plain read-then-upsert
-- from the client would also race across concurrent tabs.
create or replace function public.pinmap_increment_usage(
  p_places_delta integer,
  p_login_delta integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.pinmap_token_usage (user_id, places_pinned_count, login_count)
  values (auth.uid(), greatest(p_places_delta, 0), greatest(p_login_delta, 0))
  on conflict (user_id) do update
  set places_pinned_count = pinmap_token_usage.places_pinned_count + greatest(p_places_delta, 0),
      login_count = pinmap_token_usage.login_count + greatest(p_login_delta, 0),
      updated_at = now();
end;
$$;

grant usage on schema public to authenticated;
grant select on public.pinmap_token_usage to authenticated;
grant execute on function public.pinmap_increment_usage(integer, integer) to authenticated;

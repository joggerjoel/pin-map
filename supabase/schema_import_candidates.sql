-- Facebook import: owner-private staging area for candidate pins parsed
-- from a Facebook data export, reviewed/edited before becoming a real
-- pinmap_pinned_places row. See facebook-import-layout-plan.md.

create table if not exists public.pinmap_import_candidates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  external_key          text not null,
  place_name            text not null,
  suggested_lat         double precision,
  suggested_lng         double precision,
  geocode_confidence    text,
  visit_time            timestamptz not null,
  note                  text,
  status                text not null default 'pending',
  related_candidate_id  uuid references public.pinmap_import_candidates(id),
  approved_pin_id       uuid references public.pinmap_pinned_places(id),
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz,
  unique (user_id, external_key),
  check (status in ('pending', 'later', 'approved', 'rejected', 'split', 'merged')),
  check (geocode_confidence is null or geocode_confidence in ('high', 'low', 'failed'))
);

alter table public.pinmap_import_candidates enable row level security;

drop policy if exists "pinmap_import_candidates_select_own" on public.pinmap_import_candidates;
create policy "pinmap_import_candidates_select_own"
  on public.pinmap_import_candidates for select
  using (auth.uid() = user_id);

drop policy if exists "pinmap_import_candidates_insert_own" on public.pinmap_import_candidates;
create policy "pinmap_import_candidates_insert_own"
  on public.pinmap_import_candidates for insert
  with check (auth.uid() = user_id);

drop policy if exists "pinmap_import_candidates_update_own" on public.pinmap_import_candidates;
create policy "pinmap_import_candidates_update_own"
  on public.pinmap_import_candidates for update
  using (auth.uid() = user_id);

drop policy if exists "pinmap_import_candidates_delete_own" on public.pinmap_import_candidates;
create policy "pinmap_import_candidates_delete_own"
  on public.pinmap_import_candidates for delete
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.pinmap_import_candidates to authenticated;

-- Photos matched/staged for a candidate, before it's approved. Storage
-- objects live in the private "import-staging" bucket at
-- {user_id}/{candidate_id}/{filename}.

create table if not exists public.pinmap_import_candidate_photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  candidate_id  uuid not null references public.pinmap_import_candidates(id) on delete cascade,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

alter table public.pinmap_import_candidate_photos enable row level security;

drop policy if exists "pinmap_import_candidate_photos_select_own" on public.pinmap_import_candidate_photos;
create policy "pinmap_import_candidate_photos_select_own"
  on public.pinmap_import_candidate_photos for select
  using (auth.uid() = user_id);

drop policy if exists "pinmap_import_candidate_photos_insert_own" on public.pinmap_import_candidate_photos;
create policy "pinmap_import_candidate_photos_insert_own"
  on public.pinmap_import_candidate_photos for insert
  with check (auth.uid() = user_id);

drop policy if exists "pinmap_import_candidate_photos_delete_own" on public.pinmap_import_candidate_photos;
create policy "pinmap_import_candidate_photos_delete_own"
  on public.pinmap_import_candidate_photos for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.pinmap_import_candidate_photos to authenticated;

-- Private bucket: unlike "pin-photos", nothing here is public — these are
-- unreviewed personal photos that may never be approved.
insert into storage.buckets (id, name, public)
values ('import-staging', 'import-staging', false)
on conflict (id) do nothing;

drop policy if exists "import_staging_select_own_folder" on storage.objects;
create policy "import_staging_select_own_folder"
  on storage.objects for select
  using (
    bucket_id = 'import-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "import_staging_insert_own_folder" on storage.objects;
create policy "import_staging_insert_own_folder"
  on storage.objects for insert
  with check (
    bucket_id = 'import-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "import_staging_delete_own_folder" on storage.objects;
create policy "import_staging_delete_own_folder"
  on storage.objects for delete
  using (
    bucket_id = 'import-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Approve: atomic pin creation only (no storage writes). Runs as the
-- caller (no `security definer`), so it can never do anything the caller's
-- own RLS wouldn't already allow — deliberate, see
-- facebook-import-layout-plan.md's "Candidate lifecycle mechanics".
create or replace function public.approve_import_candidate(p_candidate_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_candidate public.pinmap_import_candidates%rowtype;
  v_pin_id uuid;
begin
  select * into v_candidate
  from public.pinmap_import_candidates
  where id = p_candidate_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'candidate % not found for current user', p_candidate_id;
  end if;

  -- Idempotent retry: a client that already approved this candidate but
  -- lost the response (the exact dropped-connection scenario this design
  -- exists to survive) gets the same pin id back, not an error.
  if v_candidate.status = 'approved' then
    return v_candidate.approved_pin_id;
  end if;

  if v_candidate.status <> 'later' and v_candidate.status <> 'pending' then
    raise exception 'candidate % has status %, expected pending, later, or approved',
      p_candidate_id, v_candidate.status;
  end if;

  if v_candidate.suggested_lat is null or v_candidate.suggested_lng is null then
    raise exception 'candidate % has no coordinates', p_candidate_id;
  end if;

  insert into public.pinmap_pinned_places (user_id, query, name, lat, lng, date)
  values (
    auth.uid(),
    v_candidate.place_name,
    v_candidate.place_name,
    v_candidate.suggested_lat,
    v_candidate.suggested_lng,
    to_char(v_candidate.visit_time, 'YYYY-MM-DD')
  )
  on conflict (user_id, query) do nothing
  returning id into v_pin_id;

  if v_pin_id is null then
    select id into v_pin_id
    from public.pinmap_pinned_places
    where user_id = auth.uid() and query = v_candidate.place_name;
  end if;

  update public.pinmap_import_candidates
  set status = 'approved',
      approved_pin_id = v_pin_id,
      resolved_at = now()
  where id = p_candidate_id;

  return v_pin_id;
end;
$$;

grant execute on function public.approve_import_candidate(uuid) to authenticated;

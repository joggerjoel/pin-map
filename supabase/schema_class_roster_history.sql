-- Audit trail for pinmap_class_roster edits. A BEFORE UPDATE trigger logs
-- the pre-change snapshot on every save, tagged with who made the change
-- and when — since the roster is open to any authenticated classmate to
-- edit, this is what lets a bad or accidental edit be identified and
-- manually reverted later.

create table if not exists public.pinmap_class_roster_history (
  id uuid primary key default gen_random_uuid(),
  class_slug text not null,
  person_id integer not null,
  changed_by uuid,
  changed_by_email text,
  high_school_name text not null,
  current_name text not null,
  hometown text not null,
  living text not null,
  current_location text not null,
  changed_at timestamptz not null default now()
);

alter table public.pinmap_class_roster_history enable row level security;

create policy "pinmap_class_roster_history_select_authenticated"
  on public.pinmap_class_roster_history for select
  to authenticated
  using (true);

grant usage on schema public to authenticated;
grant select on public.pinmap_class_roster_history to authenticated;

create or replace function public.pinmap_class_roster_log_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pinmap_class_roster_history (
    class_slug, person_id, changed_by, changed_by_email,
    high_school_name, current_name, hometown, living, current_location
  )
  values (
    old.class_slug, old.id, auth.uid(), auth.jwt() ->> 'email',
    old.high_school_name, old.current_name, old.hometown, old.living,
    old.current_location
  );
  return new;
end;
$$;

drop trigger if exists pinmap_class_roster_history_trigger
  on public.pinmap_class_roster;

create trigger pinmap_class_roster_history_trigger
  before update on public.pinmap_class_roster
  for each row
  execute function public.pinmap_class_roster_log_history();

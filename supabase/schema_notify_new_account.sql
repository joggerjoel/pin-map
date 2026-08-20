-- Notifies joel.labelle@gmail.com by email whenever a new account is
-- created, via a Postgres trigger on auth.users -> pg_net -> the
-- notify-relay service (notify-relay/, deployed on aorus4, joined to the
-- supabase_default Docker network so it's reachable by container name and
-- never exposed publicly).
--
-- __RELAY_SECRET__ must be substituted with the value in
-- ~/Documents/Projects/pin-map-notify-relay/.env on aorus4 before applying
-- this file — it is not committed here.

create or replace function public.pinmap_notify_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'http://pin-map-notify-relay:8095/notify-access',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-relay-secret', '__RELAY_SECRET__'),
    body := jsonb_build_object('email', new.email)
  );
  return new;
end;
$$;

drop trigger if exists pinmap_notify_new_account_trigger on auth.users;
create trigger pinmap_notify_new_account_trigger
  after insert on auth.users
  for each row
  execute function public.pinmap_notify_new_account();

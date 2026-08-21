-- Public teaser view for the class-reunion globe: anonymous visitors can
-- browse avatar pins (photo + location only) before signing in, but names
-- and every other roster field stay behind the "authenticated" gate on the
-- base table. Views run with their owner's privileges against the base
-- table by default, so granting `anon` select here doesn't touch the base
-- table's RLS/grants at all.

create or replace view public.pinmap_class_roster_public as
  select class_slug, id, image_url, living_lat, living_lng
  from public.pinmap_class_roster
  where living_lat is not null and living_lng is not null;

grant usage on schema public to anon;
grant select on public.pinmap_class_roster_public to anon;

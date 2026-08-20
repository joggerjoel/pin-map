-- Cached geocode for the "Living" field, so the map avatar pin doesn't
-- re-geocode on every load — only when the text actually changes (see
-- ClassRosterEditor's save handler).

alter table public.pinmap_class_roster
  add column if not exists living_lat double precision,
  add column if not exists living_lng double precision;

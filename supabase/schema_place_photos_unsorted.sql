-- Bulk-imported photos (e.g. recovered from a Facebook capture, which
-- strips location metadata) land with no place yet. NULL place_query means
-- "unsorted" -- pending manual triage in the app.
alter table public.pinmap_place_photos alter column place_query drop not null;

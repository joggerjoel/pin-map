#!/usr/bin/env bash
# Applies supabase/schema_place_photos_unsorted.sql against the live
# self-hosted Supabase Postgres on aorus4. There's no exposed psql/DATABASE_URL
# in this repo's .env by design, so this goes through SSH + docker exec into
# the supabase-db container instead.
set -euo pipefail
ssh aorus4 "docker exec -u postgres supabase-db psql -U postgres -d postgres -c \"alter table public.pinmap_place_photos alter column place_query drop not null;\""

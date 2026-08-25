-- AI photo tagging pipeline (perceptual hash, vision-model caption/tags,
-- face detection, semantic embedding) for pinmap_place_photos. Written by
-- a local batch script (scripts/backfill-photo-tags.ts, not yet built) via
-- the service-role key -- no RLS policy change needed, same table, same
-- owner-scoped policies already in schema_place_photos.sql.
--
-- See ai-tagging-plan.md for the full design and the P0 spike's findings
-- (model choice, embedding dimension, phash bit-length, real extension
-- distribution) that this migration's exact values come from -- none of
-- them are guessed.

create extension if not exists vector;

alter table public.pinmap_place_photos
  add column if not exists caption               text,
  add column if not exists tags                  text[],
  add column if not exists has_face              boolean,
  add column if not exists phash                 text,
  add column if not exists embedding             vector(768),
  add column if not exists tagged_at             timestamptz,
  add column if not exists media_type            text not null default 'image',
  add column if not exists tag_status            text not null default 'pending',
  add column if not exists tag_attempts          integer not null default 0,
  add column if not exists tag_last_error        text,
  add column if not exists tag_last_attempted_at timestamptz,
  add column if not exists pipeline_version      integer;

alter table public.pinmap_place_photos
  add constraint pinmap_place_photos_media_type_check
    check (media_type in ('image', 'video')),
  add constraint pinmap_place_photos_tag_status_check
    check (tag_status in ('pending', 'complete', 'skipped', 'failed')),
  add constraint pinmap_place_photos_tags_taxonomy_check
    check (tags is null or tags <@ array[
      'landscape', 'people', 'screenshot', 'document', 'food', 'animal', 'other'
    ]),
  add constraint pinmap_place_photos_caption_nonblank_check
    check (caption is null or length(btrim(caption)) > 0),
  -- 16-bit blockhash-core parameter -> 256-bit hash -> 64 hex chars, per
  -- the P0 spike's decision (ai-tagging-plan.md, "Perceptual hash").
  add constraint pinmap_place_photos_phash_format_check
    check (phash is null or phash ~ '^[0-9a-f]{64}$'),
  add constraint pinmap_place_photos_complete_implies_outputs_check
    check (
      tag_status <> 'complete'
      or (caption is not null and tags is not null and phash is not null
          and embedding is not null and tagged_at is not null
          and pipeline_version is not null)
    );

create index if not exists pinmap_place_photos_pending_idx
  on public.pinmap_place_photos (created_at, id)
  where tag_status = 'pending';

-- One-time backfill for the ~8,037 already-imported rows, which have no
-- stored record of image vs. video (import-mitm-photos.ts knew this at
-- import time but discarded it -- fixed going forward, see that script).
-- Extension regex confirmed against a full scan of the real backlog (P0
-- spike): webp 7804, png 108, jpg 81, gif 2, mp4 44 -- no .mov/.webm
-- actually present, but kept in the pattern as a safe superset matching
-- the client's existing kindFromStoragePath() convention.
--
-- This is what makes "a full successful pass is a fast no-op on re-run"
-- true: video rows land in tag_status = 'skipped' once, and the
-- `where tag_status = 'pending'` selection never sees them again.
update public.pinmap_place_photos
set media_type = case
    when storage_path ~* '\.(mp4|mov|webm)$' then 'video'
    else 'image'
  end,
  tag_status = case
    when storage_path ~* '\.(mp4|mov|webm)$' then 'skipped'
    else tag_status
  end
where tag_status = 'pending';

-- Column-level exposure: pinmap_place_photos is already publicly readable
-- (schema_place_photos.sql grants bare `select` to anon, and the table's
-- RLS policy allows anyone -- even unauthenticated -- to read every row
-- belonging to the map's owner, by design). Adding `caption` and
-- `embedding` to that same broad grant would let anyone build a
-- searchable description of the owner's entire private, not-yet-triaged
-- photo backlog from the public internet. Every current client read
-- already selects specific columns, not `select("*")`
-- (src/lib/photosRepository.ts), so tightening the grant to exactly those
-- columns changes nothing about what the app already does. Every new
-- column added above is server-only -- readable only via the service-role
-- key, which bypasses grants and RLS entirely.
revoke select on public.pinmap_place_photos from anon, authenticated;
grant select (id, user_id, place_query, storage_path, created_at)
  on public.pinmap_place_photos to anon, authenticated;

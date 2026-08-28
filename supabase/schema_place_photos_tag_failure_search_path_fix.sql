-- record_photo_tag_failure (schema_place_photos_ai_tags.sql) was defined
-- `security definer` with `set search_path = public` -- missing the
-- `, pg_temp` suffix its sibling schema_find_similar_photos.sql documents
-- as required: a plain `set search_path = public` still searches the
-- session's temp schema *first*, implicitly and before public, leaving any
-- unqualified reference in the function body (here, the bare `now()` call)
-- resolvable against a temp-schema object that shadows the real one --
-- exactly what pinning a search_path on a security definer function is
-- meant to close off. Naming pg_temp explicitly, last, removes that
-- shadowing window without disabling the temp schema.
--
-- Real-world exploitability is low here (only the trusted service-role-key
-- backfill script calls this RPC, never arbitrary `authenticated` callers),
-- but the fix is one line and free -- no reason to leave the inconsistency
-- once schema_find_similar_photos.sql already established the pattern.
--
-- `create or replace function` with the identical body: safe to re-run,
-- doesn't touch any data, matches this repo's one-file-per-change
-- migration convention (applied manually via `psql -f`, same as every
-- other schema file here).
create or replace function public.record_photo_tag_failure(
  p_photo_id uuid,
  p_error text,
  p_max_attempts integer
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.pinmap_place_photos
  set tag_attempts = tag_attempts + 1,
      tag_last_error = p_error,
      tag_last_attempted_at = now(),
      tag_status = case
        when tag_attempts + 1 >= p_max_attempts then 'failed'
        else 'pending'
      end
  where id = p_photo_id and tag_status = 'pending';
$$;

revoke all on function public.record_photo_tag_failure(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_photo_tag_failure(uuid, text, integer)
  to service_role;

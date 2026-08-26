-- "More like this" backend -- compares one photo's already-stored embedding
-- against every other photo of the same owner's embedding, entirely inside
-- Postgres via pgvector's <=> operator. See image-group-plan.md, "Schema
-- changes," for the full design rationale and review history; this file is
-- a direct transcription of the reviewed SQL there.
--
-- security definer, not invoker: the function body reads
-- p1.embedding/p2.embedding, a column never granted to authenticated (see
-- schema_place_photos_caption_tags_grant.sql -- only caption/tags are
-- granted, not embedding/phash/has_face). Under invoker, the caller's own
-- column privileges would apply inside the function, so every real call
-- would hit a permission error on the embedding column. RPC return values
-- bypass column grants, so the curated `returns table` column list below is
-- what actually avoids leaking embedding to the client -- not the column
-- grant, since definer bypasses grants on the underlying tables entirely.
--
-- security definer runs as the function's owner -- table owners bypass
-- their own tables' RLS by default (no FORCE ROW LEVEL SECURITY is set on
-- pinmap_place_photos), so table access inside this function isn't gated by
-- policy at all, which is exactly why `p1.user_id = auth.uid()` is required
-- explicitly in the query itself, not left to RLS.
--
-- The revoke names anon explicitly, not just public -- checked directly
-- against this instance's real pg_default_acl (not assumed): this Supabase
-- install grants EXECUTE on new functions in `public` directly to anon and
-- authenticated at creation time, not through the PUBLIC pseudo-role, so
-- `revoke ... from public` alone would leave anon's own direct grant in
-- place.
--
-- `set search_path = public, pg_temp` -- the `public` part is correct here
-- specifically because this instance's vector extension was installed into
-- public (also checked directly, not assumed -- some Supabase setups put it
-- in a separate `extensions` schema instead, which would need a two-schema
-- search path there). Both of these are environment facts, not universal
-- Postgres/Supabase defaults -- re-verify them if this is ever ported to a
-- different instance. The trailing `, pg_temp` is not a formality: a plain
-- `set search_path = public` still searches the session's temp schema
-- *first*, implicitly and before public -- that leaves the unqualified <=>
-- operator (and any other unqualified reference) resolvable against a
-- temp-schema object that shadows the real one, which is exactly what
-- pinning a search_path on a security definer function is meant to close
-- off. Naming pg_temp explicitly, last, removes that shadowing window; it
-- doesn't disable the temp schema, it just stops it from being searched
-- ahead of the schemas actually intended.
--
-- p_limit is clamped to [1, 100] -- the RPC's returned row count also feeds
-- PostgREST's own db-max-rows cap for setof/table-returning RPCs, not just
-- table/view fetches; this instance's actual db-max-rows value needs
-- confirming to be >= 100 before trusting "showing N of M" as an honest
-- count on the client (see image-group-todo.md, "P0 -- Schema").
--
-- P0 gate: verify against a throwaway container that replicates *both* this
-- instance's RLS setup *and* its default-privilege grants -- see
-- image-group-todo.md, "P0 -- Schema," for the full container-setup
-- requirements and checklist.

create or replace function public.find_similar_photos(
  p_photo_id uuid,
  p_limit integer default 24
)
returns table (
  id uuid,
  storage_path text,
  place_query text,
  skipped_at timestamptz,
  label text,
  caption text,
  tags text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p2.id, p2.storage_path, p2.place_query, p2.skipped_at, p2.label, p2.caption, p2.tags, p2.created_at
  from public.pinmap_place_photos p1
  join public.pinmap_place_photos p2
    on p2.user_id = p1.user_id
    and p2.id <> p1.id
    and p2.embedding is not null
  where p1.id = p_photo_id
    and p1.user_id = auth.uid()
    and p1.embedding is not null
  order by p2.embedding <=> p1.embedding
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.find_similar_photos(uuid, integer)
  from public, anon;
grant execute on function public.find_similar_photos(uuid, integer) to authenticated;

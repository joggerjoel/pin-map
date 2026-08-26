-- Lets an owner unassign an already-placed photo, sending it back to
-- Unassigned so it can be reassigned or skipped -- until now, place_query
-- only ever transitioned unassigned -> assigned
-- (pinmap_place_photos_update_own in schema_place_photos_update_policy.sql),
-- with no way back and no way to see where a photo landed on the map from
-- the triage panel.
--
-- Always clears skipped_at in the same write, not just place_query: an
-- assign can happen on a row regardless of its skip history (update_own's
-- USING only checks place_query is null, not skipped_at), so a photo that
-- was skipped and later assigned could otherwise land back in Skipped
-- rather than Unassigned on unassign -- confusing, since "unassign" should
-- mean "back to the triage queue," not "wherever its skip history happens
-- to leave it." Verified against a throwaway container.
--
-- unassign_own is the first policy whose USING clause ever matches an
-- already-assigned row (place_query is not null) -- every other policy on
-- this table only ever selects unassigned or skipped rows. Checked what
-- that newly opens up: update_own's WITH CHECK
-- (schema_place_photos_update_policy.sql) only validates that the *new*
-- place_query is non-blank -- it doesn't also require the row was
-- previously unassigned, because until now it never needed to (its own
-- USING already guaranteed that). Postgres ORs WITH CHECK clauses across
-- ALL policies independent of which policy's USING actually selected the
-- row for update, so a combined write on an assigned row could satisfy
-- unassign_own's USING and update_own's WITH CHECK at the same time --
-- silently reassigning an already-assigned photo to a different place in
-- one step, bypassing the null state either policy's own WITH CHECK
-- actually intended to gate. Same root cause as the skip/place_query
-- interaction fixed in schema_place_photos_skip.sql, same fix shape: a
-- BEFORE UPDATE trigger, since neither WITH CHECK can see the OLD row to
-- compare against. Reproduced the attack and confirmed the trigger blocks
-- it against a throwaway container before applying this anywhere real.

create or replace function public.pinmap_place_photos_prevent_direct_reassign()
returns trigger
language plpgsql
as $$
begin
  if old.place_query is not null
     and new.place_query is not null
     and new.place_query is distinct from old.place_query then
    raise exception 'cannot change place_query directly -- unassign first';
  end if;
  return new;
end;
$$;

drop trigger if exists pinmap_place_photos_prevent_direct_reassign
  on public.pinmap_place_photos;
create trigger pinmap_place_photos_prevent_direct_reassign
  before update on public.pinmap_place_photos
  for each row
  execute function public.pinmap_place_photos_prevent_direct_reassign();

drop policy if exists "pinmap_place_photos_unassign_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_unassign_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id and place_query is not null)
  with check (auth.uid() = user_id and place_query is null and skipped_at is null);

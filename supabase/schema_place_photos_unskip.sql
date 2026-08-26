-- Lets an owner bring a skipped photo back to Unassigned (the inverse of
-- schema_place_photos_skip.sql). Needed once the triage panel can show a
-- Skipped tab at all -- otherwise skipping is a one-way action with no
-- recovery from a mis-click.
--
-- Scoped the same deliberate way as skip_own/label_own: USING only matches
-- rows already in exactly the Skipped state (place_query is null AND
-- skipped_at is not null), so this can never make an already-assigned row
-- selectable for UPDATE via this policy. WITH CHECK requires skipped_at to
-- become null and place_query to still be null -- an Unskip action never
-- touches place_query, by construction of both this policy and the
-- unskipPhoto() repository function that uses it.

drop policy if exists "pinmap_place_photos_unskip_own" on public.pinmap_place_photos;
create policy "pinmap_place_photos_unskip_own"
  on public.pinmap_place_photos for update
  using (auth.uid() = user_id and place_query is null and skipped_at is not null)
  with check (auth.uid() = user_id and place_query is null and skipped_at is null);

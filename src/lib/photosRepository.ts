import { supabase } from "./supabaseClient";

const BUCKET = "pin-photos";

export interface PlacePhoto {
  id: string;
  placeQuery: string;
  storagePath: string;
  url: string;
}

export interface UnsortedPhoto {
  id: string;
  storagePath: string;
  createdAt: string;
  kind: "image" | "video";
  label: string | null;
  placeQuery: string | null;
  skippedAt: string | null;
  caption: string | null;
  tags: string[] | null;
}

export const PHOTO_LABEL_MAX_LENGTH = 100;

/**
 * The three-way partition of pinmap_place_photos by triage state:
 * "unassigned" = place_query is null and skipped_at is null (needs triage),
 * "skipped" = place_query is null and skipped_at is not null (set aside),
 * "assigned" = place_query is not null (done, regardless of skip history --
 * once assigned, a photo's skip history stops mattering).
 */
export type PhotoTriageStatus = "unassigned" | "skipped" | "assigned";

/**
 * Mirrors pinmap_place_photos_tags_taxonomy_check
 * (schema_place_photos_ai_tags.sql) -- keep in sync if that constraint
 * changes.
 */
export const PHOTO_TAG_TAXONOMY = [
  "landscape",
  "people",
  "screenshot",
  "document",
  "food",
  "animal",
  "other",
] as const;
export type PhotoTag = (typeof PHOTO_TAG_TAXONOMY)[number];

// "untagged" is a reserved filter value, not a real taxonomy entry -- it
// maps to `caption is null` (no embedding/tags/caption written yet) rather
// than `.contains("tags", [...])`. Typed as its own union member (not a
// bare `string` parameter) so a typo in a taxonomy value is a compile
// error, not a silently-empty query result.
export type PhotoTagFilter = PhotoTag | "untagged";

export interface UnsortedPhotoCursor {
  createdAt: string;
  id: string;
}

export interface PhotoGroup {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

function kindFromStoragePath(storagePath: string): "image" | "video" {
  const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
}

function publicUrl(storagePath: string, options?: { width?: number }): string {
  return supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath, options ? { transform: options } : undefined)
    .data.publicUrl;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCursor(after: UnsortedPhotoCursor): boolean {
  return (
    ISO_TIMESTAMP_PATTERN.test(after.createdAt) && UUID_PATTERN.test(after.id)
  );
}

export async function fetchPhotos(userId: string): Promise<PlacePhoto[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .select("id, place_query, storage_path")
      .eq("user_id", userId);
    if (error || data === null) {
      return [];
    }
    return (
      data as { id: string; place_query: string; storage_path: string }[]
    ).map((row) => ({
      id: row.id,
      placeQuery: row.place_query,
      storagePath: row.storage_path,
      url: publicUrl(row.storage_path),
    }));
  } catch {
    return [];
  }
}

export async function uploadPhoto(
  userId: string,
  placeQuery: string,
  file: File,
): Promise<PlacePhoto | null> {
  try {
    const ext = file.name.split(".").pop() ?? "jpg";
    const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file);
    if (uploadError) {
      return null;
    }

    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .insert({
        user_id: userId,
        place_query: placeQuery,
        storage_path: storagePath,
      })
      .select("id")
      .single();
    if (error || data === null) {
      return null;
    }

    return {
      id: (data as { id: string }).id,
      placeQuery,
      storagePath,
      url: publicUrl(storagePath),
    };
  } catch {
    return null;
  }
}

export async function fetchUnsortedPhotoCount(
  userId: string,
  status: PhotoTriageStatus = "unassigned",
  tag?: PhotoTagFilter,
): Promise<number | null> {
  try {
    let query = supabase
      .from("pinmap_place_photos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (status === "unassigned") {
      query = query.is("place_query", null).is("skipped_at", null);
    } else if (status === "skipped") {
      query = query.is("place_query", null).not("skipped_at", "is", null);
    } else {
      query = query.not("place_query", "is", null);
    }
    if (tag !== undefined) {
      query =
        tag === "untagged"
          ? query.is("caption", null)
          : query.contains("tags", [tag]);
    }
    const { count, error } = await query;
    if (error || count === null) {
      return null;
    }
    return count;
  } catch {
    return null;
  }
}

interface UnsortedPhotoRow {
  id: string;
  storage_path: string;
  created_at: string;
  label: string | null;
  place_query: string | null;
  skipped_at: string | null;
  caption: string | null;
  tags: string[] | null;
}

const UNSORTED_PHOTO_COLUMNS =
  "id, storage_path, created_at, label, place_query, skipped_at, caption, tags";

function mapUnsortedPhotoRow(row: UnsortedPhotoRow): UnsortedPhoto {
  return {
    id: row.id,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    kind: kindFromStoragePath(row.storage_path),
    label: row.label,
    placeQuery: row.place_query,
    skippedAt: row.skipped_at,
    caption: row.caption,
    tags: row.tags,
  };
}

export async function fetchUnsortedPhotos(
  userId: string,
  {
    limit,
    after,
    status = "unassigned",
    tag,
  }: {
    limit: number;
    after: UnsortedPhotoCursor | null;
    status?: PhotoTriageStatus;
    tag?: PhotoTagFilter;
  },
): Promise<UnsortedPhoto[] | null> {
  if (after !== null && !isValidCursor(after)) {
    return null;
  }
  try {
    let query = supabase
      .from("pinmap_place_photos")
      .select(UNSORTED_PHOTO_COLUMNS)
      .eq("user_id", userId);
    if (status === "unassigned") {
      query = query.is("place_query", null).is("skipped_at", null);
    } else if (status === "skipped") {
      query = query.is("place_query", null).not("skipped_at", "is", null);
    } else {
      query = query.not("place_query", "is", null);
    }
    if (tag !== undefined) {
      query =
        tag === "untagged"
          ? query.is("caption", null)
          : query.contains("tags", [tag]);
    }
    query = query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (after !== null) {
      query = query.or(
        `created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")`,
      );
    }
    const { data, error } = await query;
    if (error || data === null) {
      return null;
    }
    return (data as UnsortedPhotoRow[]).map(mapUnsortedPhotoRow);
  } catch {
    return null;
  }
}

export function unsortedPhotoUrl(
  photo: UnsortedPhoto,
  variant: "thumbnail" | "full",
): string {
  if (photo.kind === "video" || variant === "full") {
    return publicUrl(photo.storagePath);
  }
  return publicUrl(photo.storagePath, { width: 240 });
}

// Sibling to fetchUnsortedPhotos/fetchUnsortedPhotoCount, not a variant of
// them -- serves every photo regardless of triage status, not just the
// unsorted backlog, so it gets its own name rather than overloading
// "unsorted" to mean something it doesn't. Still filters by
// `.eq("user_id", userId)` explicitly: this table's SELECT RLS
// (pinmap_place_photos_select_own_or_owner) is NOT scoped to the owner --
// any authenticated user can read any owner's rows -- so this filter is
// load-bearing, not redundant with RLS.
export async function fetchAllPhotos(
  userId: string,
  {
    limit,
    after,
    tag,
    groupId,
  }: {
    limit: number;
    after: UnsortedPhotoCursor | null;
    tag?: PhotoTagFilter;
    groupId?: string;
  },
): Promise<UnsortedPhoto[] | null> {
  if (after !== null && !isValidCursor(after)) {
    return null;
  }
  try {
    let query =
      groupId !== undefined
        ? supabase
            .from("pinmap_place_photos")
            .select(
              `${UNSORTED_PHOTO_COLUMNS}, pinmap_photo_group_members!inner(group_id)`,
            )
            .eq("pinmap_photo_group_members.group_id", groupId)
            .eq("user_id", userId)
        : supabase
            .from("pinmap_place_photos")
            .select(UNSORTED_PHOTO_COLUMNS)
            .eq("user_id", userId);
    if (tag !== undefined) {
      query =
        tag === "untagged"
          ? query.is("caption", null)
          : query.contains("tags", [tag]);
    }
    query = query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (after !== null) {
      query = query.or(
        `created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt."${after.id}")`,
      );
    }
    const { data, error } = await query;
    if (error || data === null) {
      return null;
    }
    return (data as UnsortedPhotoRow[]).map(mapUnsortedPhotoRow);
  } catch {
    return null;
  }
}

export async function fetchAllPhotosCount(
  userId: string,
  { tag, groupId }: { tag?: PhotoTagFilter; groupId?: string } = {},
): Promise<number | null> {
  try {
    let query =
      groupId !== undefined
        ? supabase
            .from("pinmap_place_photos")
            .select("id, pinmap_photo_group_members!inner(group_id)", {
              count: "exact",
              head: true,
            })
            .eq("pinmap_photo_group_members.group_id", groupId)
            .eq("user_id", userId)
        : supabase
            .from("pinmap_place_photos")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
    if (tag !== undefined) {
      query =
        tag === "untagged"
          ? query.is("caption", null)
          : query.contains("tags", [tag]);
    }
    const { count, error } = await query;
    if (error || count === null) {
      return null;
    }
    return count;
  } catch {
    return null;
  }
}

// A group's members -- the same embedded-resource join fetchAllPhotos uses
// when passed a groupId, exposed as its own named entry point for the
// group-members view (which is never status- or Browse-scoped, always just
// "this group's photos"). Kept as a separate function rather than always
// routing through fetchAllPhotos so the group-members view doesn't have to
// reason about the tag-filter/status parameters it never uses.
export async function fetchGroupMembers(
  userId: string,
  groupId: string,
  { limit, after }: { limit: number; after: UnsortedPhotoCursor | null },
): Promise<UnsortedPhoto[] | null> {
  return fetchAllPhotos(userId, { limit, after, groupId });
}

export async function createGroup(
  userId: string,
  name: string,
): Promise<PhotoGroup | "invalid" | "limit" | "error"> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > 100) {
    return "invalid";
  }
  try {
    const { data, error } = await supabase
      .from("pinmap_photo_groups")
      .insert({ user_id: userId, name: trimmed })
      .select("id, name, created_at")
      .single();
    if (error) {
      // pinmap_photo_groups_enforce_cap (schema_photo_groups.sql) raises a
      // plain `raise exception` with no explicit errcode, so it surfaces as
      // Postgres's default P0001 -- distinguished by message text, the
      // only signal available for it.
      if (error.message?.includes("group limit reached")) {
        return "limit";
      }
      return "error";
    }
    if (data === null) {
      return "error";
    }
    const row = data as { id: string; name: string; created_at: string };
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      memberCount: 0,
    };
  } catch {
    return "error";
  }
}

export async function deleteGroup(groupId: string): Promise<"ok" | "error"> {
  try {
    const { error } = await supabase
      .from("pinmap_photo_groups")
      .delete()
      .eq("id", groupId);
    if (error) {
      return "error";
    }
    return "ok";
  } catch {
    return "error";
  }
}

// Member counts come from a second query over every membership row for
// this user's groups, tallied client-side -- not PostgREST's embedded
// aggregate-count syntax (`pinmap_photo_group_members(count)`), which
// depends on `db-aggregates-enabled`, a PostgREST config flag Supabase
// commonly leaves off and this instance hasn't been confirmed to have on.
// Still exactly two queries total, never one count query per listed group.
export async function fetchGroups(
  userId: string,
): Promise<PhotoGroup[] | null> {
  try {
    const { data: groups, error: groupsError } = await supabase
      .from("pinmap_photo_groups")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (groupsError || groups === null) {
      return null;
    }
    const groupRows = groups as {
      id: string;
      name: string;
      created_at: string;
    }[];
    const groupIds = groupRows.map((g) => g.id);
    const counts = new Map<string, number>();
    if (groupIds.length > 0) {
      const { data: members, error: membersError } = await supabase
        .from("pinmap_photo_group_members")
        .select("group_id")
        .in("group_id", groupIds);
      if (membersError || members === null) {
        return null;
      }
      for (const row of members as { group_id: string }[]) {
        counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
      }
    }
    return groupRows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      memberCount: counts.get(row.id) ?? 0,
    }));
  } catch {
    return null;
  }
}

// Thin RPC wrappers around add_photos_to_group/remove_photos_from_group
// (schema_photo_group_members.sql) -- bulk, one round trip each, not a
// per-photo loop, and not a raw PostgREST table call (see that file's
// header comment for why a raw bulk insert/delete doesn't work here).
// Both RPCs raise a custom `P0002` error on a deleted/foreign groupId,
// caught here and surfaced as "group_not_found" so the caller can show a
// "this group no longer exists" notice without needing to parse Postgres
// error codes itself.
export async function addPhotosToGroup(
  groupId: string,
  photoIds: string[],
): Promise<{ added: number } | "group_not_found" | "error"> {
  if (photoIds.length === 0) {
    return { added: 0 };
  }
  try {
    const { data, error } = await supabase.rpc("add_photos_to_group", {
      p_group_id: groupId,
      p_photo_ids: photoIds,
    });
    if (error) {
      return error.code === "P0002" ? "group_not_found" : "error";
    }
    if (typeof data !== "number") {
      return "error";
    }
    return { added: data };
  } catch {
    return "error";
  }
}

export async function removePhotosFromGroup(
  groupId: string,
  photoIds: string[],
): Promise<{ removed: number } | "group_not_found" | "error"> {
  if (photoIds.length === 0) {
    return { removed: 0 };
  }
  try {
    const { data, error } = await supabase.rpc("remove_photos_from_group", {
      p_group_id: groupId,
      p_photo_ids: photoIds,
    });
    if (error) {
      return error.code === "P0002" ? "group_not_found" : "error";
    }
    if (typeof data !== "number") {
      return "error";
    }
    return { removed: data };
  } catch {
    return "error";
  }
}

// "More like this" -- security-definer RPC, see
// schema_find_similar_photos.sql. Always request the RPC's clamped maximum
// (100), not its default of 24 -- the "showing N of M" indicator (client
// UI) needs the real candidate pool, not the smaller number actually
// displayed per page.
export const FIND_SIMILAR_PHOTOS_LIMIT = 100;

export async function findSimilarPhotos(
  photoId: string,
): Promise<UnsortedPhoto[] | null> {
  try {
    const { data, error } = await supabase.rpc("find_similar_photos", {
      p_photo_id: photoId,
      p_limit: FIND_SIMILAR_PHOTOS_LIMIT,
    });
    if (error || data === null) {
      return null;
    }
    return (
      data as {
        id: string;
        storage_path: string;
        place_query: string | null;
        skipped_at: string | null;
        label: string | null;
        caption: string | null;
        tags: string[] | null;
        created_at: string;
      }[]
    ).map((row) =>
      mapUnsortedPhotoRow({
        id: row.id,
        storage_path: row.storage_path,
        created_at: row.created_at,
        label: row.label,
        place_query: row.place_query,
        skipped_at: row.skipped_at,
        caption: row.caption,
        tags: row.tags,
      }),
    );
  } catch {
    return null;
  }
}

export async function assignPhotoPlace(
  photoId: string,
  placeQuery: string,
): Promise<"ok" | "conflict" | "error"> {
  if (placeQuery.trim() === "") {
    return "error";
  }
  try {
    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .update({ place_query: placeQuery })
      .eq("id", photoId)
      .is("place_query", null)
      .select("id");
    if (error) {
      return "error";
    }
    if (data === null || data.length === 0) {
      return "conflict";
    }
    return "ok";
  } catch {
    return "error";
  }
}

export async function skipPhoto(
  photoId: string,
): Promise<"ok" | "conflict" | "error"> {
  try {
    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .update({ skipped_at: new Date().toISOString() })
      .eq("id", photoId)
      .is("place_query", null)
      .is("skipped_at", null)
      .select("id");
    if (error) {
      return "error";
    }
    if (data === null || data.length === 0) {
      return "conflict";
    }
    return "ok";
  } catch {
    return "error";
  }
}

export async function unskipPhoto(
  photoId: string,
): Promise<"ok" | "conflict" | "error"> {
  try {
    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .update({ skipped_at: null })
      .eq("id", photoId)
      .is("place_query", null)
      .not("skipped_at", "is", null)
      .select("id");
    if (error) {
      return "error";
    }
    if (data === null || data.length === 0) {
      return "conflict";
    }
    return "ok";
  } catch {
    return "error";
  }
}

// Clears both place_query and skipped_at in one write, always landing the
// photo back in Unassigned regardless of skip history -- see
// schema_place_photos_unassign.sql.
export async function unassignPhoto(
  photoId: string,
): Promise<"ok" | "conflict" | "error"> {
  try {
    const { data, error } = await supabase
      .from("pinmap_place_photos")
      .update({ place_query: null, skipped_at: null })
      .eq("id", photoId)
      .not("place_query", "is", null)
      .select("id");
    if (error) {
      return "error";
    }
    if (data === null || data.length === 0) {
      return "conflict";
    }
    return "ok";
  } catch {
    return "error";
  }
}

export async function setPhotoLabel(
  photoId: string,
  label: string,
): Promise<"ok" | "error"> {
  const trimmed = label.trim();
  if (trimmed.length > PHOTO_LABEL_MAX_LENGTH) {
    return "error";
  }
  try {
    const { error } = await supabase
      .from("pinmap_place_photos")
      .update({ label: trimmed === "" ? null : trimmed })
      .eq("id", photoId)
      .is("place_query", null);
    if (error) {
      return "error";
    }
    return "ok";
  } catch {
    return "error";
  }
}

export async function deletePhoto(
  userId: string,
  photo: { id: string; storagePath: string },
): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([photo.storagePath]);
    await supabase
      .from("pinmap_place_photos")
      .delete()
      .eq("user_id", userId)
      .eq("id", photo.id);
  } catch {
    // Fire-and-forget — see pinsRepository.upsertPins.
  }
}

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

export interface UnsortedPhotoCursor {
  createdAt: string;
  id: string;
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
    const { count, error } = await query;
    if (error || count === null) {
      return null;
    }
    return count;
  } catch {
    return null;
  }
}

export async function fetchUnsortedPhotos(
  userId: string,
  {
    limit,
    after,
    status = "unassigned",
  }: {
    limit: number;
    after: UnsortedPhotoCursor | null;
    status?: PhotoTriageStatus;
  },
): Promise<UnsortedPhoto[] | null> {
  if (after !== null && !isValidCursor(after)) {
    return null;
  }
  try {
    let query = supabase
      .from("pinmap_place_photos")
      .select("id, storage_path, created_at, label, place_query")
      .eq("user_id", userId);
    if (status === "unassigned") {
      query = query.is("place_query", null).is("skipped_at", null);
    } else if (status === "skipped") {
      query = query.is("place_query", null).not("skipped_at", "is", null);
    } else {
      query = query.not("place_query", "is", null);
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
    return (
      data as {
        id: string;
        storage_path: string;
        created_at: string;
        label: string | null;
        place_query: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
      createdAt: row.created_at,
      kind: kindFromStoragePath(row.storage_path),
      label: row.label,
      placeQuery: row.place_query,
    }));
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

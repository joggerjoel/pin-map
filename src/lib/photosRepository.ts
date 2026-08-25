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
}

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
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("pinmap_place_photos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("place_query", null);
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
  { limit, after }: { limit: number; after: UnsortedPhotoCursor | null },
): Promise<UnsortedPhoto[] | null> {
  if (after !== null && !isValidCursor(after)) {
    return null;
  }
  try {
    let query = supabase
      .from("pinmap_place_photos")
      .select("id, storage_path, created_at")
      .eq("user_id", userId)
      .is("place_query", null)
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
      data as { id: string; storage_path: string; created_at: string }[]
    ).map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
      createdAt: row.created_at,
      kind: kindFromStoragePath(row.storage_path),
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

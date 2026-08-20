import { supabase } from "./supabaseClient";

const BUCKET = "pin-photos";

export interface PlacePhoto {
  id: string;
  placeQuery: string;
  storagePath: string;
  url: string;
}

function publicUrl(storagePath: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
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

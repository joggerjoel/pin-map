import { supabase } from "./supabaseClient";

const BUCKET = "pin-photos";

export interface RosterPersonPhoto {
  id: string;
  personId: number;
  storagePath: string;
  year: number | null;
  url: string;
}

interface RosterPhotoRow {
  id: string;
  person_id: number;
  storage_path: string;
  year: number | null;
}

function publicUrl(storagePath: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

function toRosterPersonPhoto(row: RosterPhotoRow): RosterPersonPhoto {
  return {
    id: row.id,
    personId: row.person_id,
    storagePath: row.storage_path,
    year: row.year,
    url: publicUrl(row.storage_path),
  };
}

export async function fetchRosterPhotos(
  classSlug: string,
): Promise<RosterPersonPhoto[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_roster_photos")
      .select("id, person_id, storage_path, year")
      .eq("class_slug", classSlug);
    if (error || data === null) {
      return [];
    }
    return (data as RosterPhotoRow[]).map(toRosterPersonPhoto);
  } catch {
    return [];
  }
}

export async function uploadRosterPhoto(
  userId: string,
  classSlug: string,
  personId: number,
  year: number | null,
  file: File,
): Promise<RosterPersonPhoto | null> {
  try {
    const ext = file.name.split(".").pop() ?? "jpg";
    const storagePath = `${userId}/class-roster/${classSlug}/${personId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file);
    if (uploadError) {
      return null;
    }

    const { data, error } = await supabase
      .from("pinmap_class_roster_photos")
      .insert({
        class_slug: classSlug,
        person_id: personId,
        storage_path: storagePath,
        year,
        uploaded_by: userId,
      })
      .select("id")
      .single();
    if (error || data === null) {
      return null;
    }

    return {
      id: (data as { id: string }).id,
      personId,
      storagePath,
      year,
      url: publicUrl(storagePath),
    };
  } catch {
    return null;
  }
}

export async function deleteRosterPhoto(
  id: string,
  storagePath: string,
): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    await supabase.from("pinmap_class_roster_photos").delete().eq("id", id);
  } catch {
    // Fire-and-forget — see pinsRepository.upsertPins.
  }
}

import { supabase } from "./supabaseClient";

export interface PublicRosterLocation {
  id: number;
  imageUrl: string;
  livingLat: number;
  livingLng: number;
}

interface PublicRosterLocationRow {
  id: number;
  image_url: string;
  living_lat: number;
  living_lng: number;
}

export async function fetchPublicRosterLocations(
  classSlug: string,
): Promise<PublicRosterLocation[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_roster_public")
      .select("id, image_url, living_lat, living_lng")
      .eq("class_slug", classSlug);
    if (error || data === null) {
      return [];
    }
    return (data as PublicRosterLocationRow[]).map((row) => ({
      id: row.id,
      imageUrl: row.image_url,
      livingLat: row.living_lat,
      livingLng: row.living_lng,
    }));
  } catch {
    return [];
  }
}

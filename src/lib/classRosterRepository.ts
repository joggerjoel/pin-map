import { supabase } from "./supabaseClient";

export interface RosterPerson {
  id: number;
  filename: string;
  imageUrl: string;
  highSchoolName: string;
  currentName: string;
  hometown: string;
  currentLocation: string;
}

interface RosterRow {
  id: number;
  filename: string;
  image_url: string;
  high_school_name: string;
  current_name: string;
  hometown: string;
  current_location: string;
}

function toRosterPerson(row: RosterRow): RosterPerson {
  return {
    id: row.id,
    filename: row.filename,
    imageUrl: row.image_url,
    highSchoolName: row.high_school_name,
    currentName: row.current_name,
    hometown: row.hometown,
    currentLocation: row.current_location,
  };
}

export async function fetchRoster(classSlug: string): Promise<RosterPerson[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_class_roster")
      .select(
        "id, filename, image_url, high_school_name, current_name, hometown, current_location",
      )
      .eq("class_slug", classSlug)
      .order("id");
    if (error || data === null) {
      return [];
    }
    return (data as RosterRow[]).map(toRosterPerson);
  } catch {
    return [];
  }
}

export interface RosterPersonUpdate {
  id: number;
  highSchoolName: string;
  currentName: string;
  hometown: string;
  currentLocation: string;
}

export async function saveRosterPerson(
  classSlug: string,
  update: RosterPersonUpdate,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("pinmap_class_roster")
      .update({
        high_school_name: update.highSchoolName,
        current_name: update.currentName,
        hometown: update.hometown,
        current_location: update.currentLocation,
      })
      .eq("class_slug", classSlug)
      .eq("id", update.id);
    return error === null;
  } catch {
    return false;
  }
}

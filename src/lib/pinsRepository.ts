import { supabase } from "./supabaseClient";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { CustomTag } from "./customTags";

interface PinRow {
  query: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  icon: string | null;
  custom_tag_id: string | null;
  date: string | null;
}

export async function fetchOwnerId(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("pinmap_owner")
      .select("user_id")
      .limit(1)
      .maybeSingle();
    if (error || data === null) {
      return null;
    }
    return (data as { user_id: string }).user_id;
  } catch {
    return null;
  }
}

export async function fetchPins(
  userId: string,
  customTags: CustomTag[],
): Promise<PinnedPlace[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_pinned_places")
      .select("query, name, lat, lng, category, icon, custom_tag_id, date")
      .eq("user_id", userId);
    if (error || data === null) {
      return [];
    }
    return (data as PinRow[]).map((row) => {
      const customTag = row.custom_tag_id
        ? customTags.find((tag) => tag.id === row.custom_tag_id)
        : undefined;
      return {
        query: row.query,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        category: (row.category ?? undefined) as PinnedPlace["category"],
        icon: (row.icon ?? undefined) as PinnedPlace["icon"],
        customTag,
        date: row.date ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function upsertPins(
  userId: string,
  places: PinnedPlace[],
): Promise<void> {
  if (places.length === 0) {
    return;
  }
  try {
    const rows = places.map((place) => ({
      user_id: userId,
      query: place.query,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      category: place.category ?? null,
      icon: place.icon ?? null,
      custom_tag_id: place.customTag?.id ?? null,
      date: place.date ?? null,
    }));
    await supabase
      .from("pinmap_pinned_places")
      .upsert(rows, { onConflict: "user_id,query" });
  } catch {
    // Fire-and-forget sync — a failed write here shouldn't crash the UI,
    // which has already updated optimistically. The next successful sync
    // (or a page reload once connectivity is back) will reconcile it.
  }
}

export async function updatePinFields(
  userId: string,
  query: string,
  updates: Partial<{
    name: string;
    lat: number;
    lng: number;
    category: string | null;
    icon: string | null;
    custom_tag_id: string | null;
  }>,
): Promise<void> {
  try {
    await supabase
      .from("pinmap_pinned_places")
      .update(updates)
      .eq("user_id", userId)
      .eq("query", query);
  } catch {
    // See upsertPins.
  }
}

export async function deletePin(userId: string, query: string): Promise<void> {
  try {
    await supabase
      .from("pinmap_pinned_places")
      .delete()
      .eq("user_id", userId)
      .eq("query", query);
  } catch {
    // See upsertPins.
  }
}

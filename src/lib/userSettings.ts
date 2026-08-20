import { supabase } from "./supabaseClient";

export async function fetchDeclutterEnabled(
  userId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("pinmap_user_settings")
      .select("declutter_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || data === null) {
      return null;
    }
    return (data as { declutter_enabled: boolean }).declutter_enabled;
  } catch {
    return null;
  }
}

export async function saveDeclutterEnabledRemote(
  userId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await supabase
      .from("pinmap_user_settings")
      .upsert(
        { user_id: userId, declutter_enabled: enabled },
        { onConflict: "user_id" },
      );
  } catch {
    // Fire-and-forget sync — see pinsRepository.upsertPins.
  }
}

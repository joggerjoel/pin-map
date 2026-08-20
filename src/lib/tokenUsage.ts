import { supabase } from "./supabaseClient";

export const PLACES_PINNED_LIMIT = 50;
export const LOGIN_LIMIT = 10;

export interface TokenUsage {
  placesPinnedCount: number;
  loginCount: number;
}

const EMPTY_USAGE: TokenUsage = { placesPinnedCount: 0, loginCount: 0 };

export async function fetchTokenUsage(userId: string): Promise<TokenUsage> {
  try {
    const { data, error } = await supabase
      .from("pinmap_token_usage")
      .select("places_pinned_count, login_count")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || data === null) {
      return EMPTY_USAGE;
    }
    const row = data as {
      places_pinned_count: number;
      login_count: number;
    };
    return {
      placesPinnedCount: row.places_pinned_count,
      loginCount: row.login_count,
    };
  } catch {
    return EMPTY_USAGE;
  }
}

export async function incrementPlacesPinned(count: number): Promise<void> {
  if (count <= 0) {
    return;
  }
  try {
    await supabase.rpc("pinmap_increment_usage", {
      p_places_delta: count,
      p_login_delta: 0,
    });
  } catch {
    // Fire-and-forget usage counter — a failed increment just means this
    // event goes uncounted, not a user-facing failure.
  }
}

export async function incrementLogin(): Promise<void> {
  try {
    await supabase.rpc("pinmap_increment_usage", {
      p_places_delta: 0,
      p_login_delta: 1,
    });
  } catch {
    // See incrementPlacesPinned.
  }
}

export function shouldForcePersonalToken(usage: TokenUsage): boolean {
  return (
    usage.placesPinnedCount >= PLACES_PINNED_LIMIT ||
    usage.loginCount > LOGIN_LIMIT
  );
}

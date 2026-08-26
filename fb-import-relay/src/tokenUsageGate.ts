// Server-side enforcement of the same shared-Mapbox-token quota the app's
// paste-places flow already gates client-side (pin-map's
// src/lib/tokenUsage.ts) -- enforced here too since a caller can skip that
// client-side check entirely by calling this relay's /geocode directly.
// Reads and writes use the CALLER's own forwarded bearer token, never a
// service-role key, matching every other Supabase access this service
// makes. The owner is exempt from this counter app-wide (see
// pinmap_token_usage's own schema comment); callers of this module handle
// that exemption themselves via ownerGate.ts's isOwner(), not here.

export const PLACES_PINNED_LIMIT = 50;

export interface TokenUsageGateConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  currentCount: number;
}

// Fails open (treats a read error as 0 usage) rather than closed --
// blocking every geocode call on a transient DB hiccup would be worse for
// this low-stakes, cost-protection-only gate than occasionally letting a
// batch through it shouldn't have. Matches the client's own
// fetchTokenUsage(), which does the same (falls back to EMPTY_USAGE on
// any error).
export async function fetchPlacesPinnedCount(
  authorizationHeader: string,
  userId: string,
  config: TokenUsageGateConfig,
): Promise<number> {
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/pinmap_token_usage?user_id=eq.${encodeURIComponent(userId)}&select=places_pinned_count`,
      {
        headers: {
          apikey: config.anonKey,
          Authorization: authorizationHeader,
        },
      },
    );
    if (!res.ok) return 0;
    const rows = (await res.json()) as Array<{
      places_pinned_count?: number;
    }>;
    return rows[0]?.places_pinned_count ?? 0;
  } catch {
    return 0;
  }
}

// Checks the batch's own size against remaining headroom, not just
// whether the caller is already over -- a caller sitting at 49 can't clear
// an arbitrarily large batch in one call.
export async function checkQuota(
  authorizationHeader: string,
  userId: string,
  batchSize: number,
  config: TokenUsageGateConfig,
): Promise<QuotaCheckResult> {
  const currentCount = await fetchPlacesPinnedCount(
    authorizationHeader,
    userId,
    config,
  );
  return {
    allowed: currentCount + batchSize <= PLACES_PINNED_LIMIT,
    currentCount,
  };
}

// Fire-and-forget, matching incrementPlacesPinned()'s existing
// client-side behavior: a failed increment just means this event goes
// uncounted, not a user-facing failure -- the Mapbox spend it's tracking
// already happened regardless of whether this call succeeds.
export async function incrementPlacesPinned(
  authorizationHeader: string,
  count: number,
  config: TokenUsageGateConfig,
): Promise<void> {
  if (count <= 0) return;
  try {
    await fetch(`${config.supabaseUrl}/rest/v1/rpc/pinmap_increment_usage`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: authorizationHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_places_delta: count, p_login_delta: 0 }),
    });
  } catch {
    // See comment above.
  }
}

// Owner-only auth gate shared by every endpoint in this service. Verifies
// a Supabase access token against GoTrue, then checks the resulting user
// id against pinmap_owner (publicly SELECT-able by design — see
// schema_owner.sql — so this is a plain REST read, no service-role key
// needed anywhere in this service). Fails closed on any error: a network
// failure, a non-2xx response, or an unexpected shape is always rejection,
// never silently treated as "probably fine."

export interface OwnerGateConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface OwnerCheckResult {
  ok: boolean;
  userId?: string;
  reason?: string;
}

export async function verifyOwner(
  authorizationHeader: string | null | undefined,
  config: OwnerGateConfig,
): Promise<OwnerCheckResult> {
  if (!authorizationHeader) {
    return { ok: false, reason: "missing authorization header" };
  }

  let userId: string | undefined;
  try {
    const userRes = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authorizationHeader,
        apikey: config.anonKey,
      },
    });
    if (!userRes.ok) {
      return {
        ok: false,
        reason: `token verification failed (${userRes.status})`,
      };
    }
    const user = (await userRes.json()) as { id?: string };
    userId = user?.id;
  } catch (err) {
    return {
      ok: false,
      reason: `token verification request failed: ${(err as Error).message}`,
    };
  }

  if (!userId) {
    return { ok: false, reason: "no user id in token verification response" };
  }

  try {
    const ownerRes = await fetch(
      `${config.supabaseUrl}/rest/v1/pinmap_owner?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
      {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
      },
    );
    if (!ownerRes.ok) {
      return { ok: false, reason: `owner check failed (${ownerRes.status})` };
    }
    const rows = (await ownerRes.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, reason: "authenticated user is not the owner" };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `owner check request failed: ${(err as Error).message}`,
    };
  }

  return { ok: true, userId };
}

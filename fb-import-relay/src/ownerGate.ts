// Authentication (any signed-in user) is separate from the owner-exemption
// check (item 3's Mapbox-quota gate) — split into two functions so each
// caller only pays for what it needs, and so the owner-only semantics
// verifyOwner() used to have don't leak back in by accident now that every
// endpoint uses verifyAuthenticated() instead.

export interface OwnerGateConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface AuthCheckResult {
  ok: boolean;
  userId?: string;
  reason?: string;
}

export async function verifyAuthenticated(
  authorizationHeader: string | null | undefined,
  config: OwnerGateConfig,
): Promise<AuthCheckResult> {
  if (!authorizationHeader) {
    return { ok: false, reason: "missing authorization header" };
  }

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
    if (!user?.id) {
      return { ok: false, reason: "no user id in token verification response" };
    }
    return { ok: true, userId: user.id };
  } catch (err) {
    return {
      ok: false,
      reason: `token verification request failed: ${(err as Error).message}`,
    };
  }
}

// pinmap_owner is publicly SELECT-able by design (schema_owner.sql), so
// this is a plain REST read with the anon key — no service-role key, and
// no dependency on the caller's own token. Fails closed: any network
// error or non-2xx response means "not the owner," never "probably fine."
export async function isOwner(
  userId: string,
  config: OwnerGateConfig,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/pinmap_owner?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
      {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
      },
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// The recorded owner's user_id — used by the one-time backfill script to
// assign pre-existing uploads (all of which, by definition, were created
// by the owner, since no one else could have uploaded before this feature
// shipped). Same public read as isOwner, just returning the id instead of
// a boolean.
export async function fetchOwnerUserId(
  config: OwnerGateConfig,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/pinmap_owner?select=user_id&limit=1`,
      {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ user_id?: string }>;
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

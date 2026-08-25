// Verifies a Supabase access token against GoTrue -- same pattern as
// pin-map-fb-import-relay's ownerGate.ts, duplicated rather than shared
// since these are two independently-deployed services. Used by
// /notify-login so the client can be trusted to say who logged in without
// needing to expose RELAY_SECRET (the static secret /notify-access uses)
// to browser JS, which would defeat it as a secret entirely.

export interface AuthConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface AuthResult {
  ok: boolean;
  email?: string;
  userId?: string;
  reason?: string;
}

export async function verifyAuthenticated(
  authorizationHeader: string | null | undefined,
  config: AuthConfig,
): Promise<AuthResult> {
  if (!authorizationHeader) {
    return { ok: false, reason: "missing authorization header" };
  }

  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authorizationHeader,
        apikey: config.anonKey,
      },
    });
    if (!res.ok) {
      return { ok: false, reason: `token verification failed (${res.status})` };
    }
    const user = (await res.json()) as { id?: string; email?: string };
    if (!user?.id || !user?.email) {
      return {
        ok: false,
        reason: "no user id/email in token verification response",
      };
    }
    return { ok: true, userId: user.id, email: user.email };
  } catch (err) {
    return {
      ok: false,
      reason: `token verification request failed: ${(err as Error).message}`,
    };
  }
}

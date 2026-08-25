// Calls notify-relay's /notify-login after a successful sign-in (see
// src/hooks/useAuth.ts) -- fire-and-forget, matching this app's existing
// pattern for non-critical side effects (incrementPlacesPinned,
// incrementLogin): a failed notification should never block or surface an
// error to the person signing in, it just means the owner doesn't get
// told about this particular event.

const NOTIFY_RELAY_URL = import.meta.env.VITE_NOTIFY_RELAY_URL as
  string | undefined;

export async function notifyLogin(
  accessToken: string,
  ip: string | null,
  isNewAccount: boolean,
): Promise<void> {
  if (!NOTIFY_RELAY_URL) return;
  try {
    await fetch(`${NOTIFY_RELAY_URL}/notify-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ ip: ip ?? "unknown", isNewAccount }),
    });
  } catch {
    // See file header.
  }
}

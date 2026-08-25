// The app is served through a Cloudflare Tunnel (see idea.md), which means
// every request already passes through Cloudflare's edge -- its
// /cdn-cgi/trace endpoint reflects the caller's own public IP back as
// plain text, no external service or API key needed. Best-effort: any
// failure returns null rather than blocking whatever called this.

export async function fetchClientIp(): Promise<string | null> {
  try {
    const res = await fetch("/cdn-cgi/trace");
    if (!res.ok) return null;
    const text = await res.text();
    const match = /^ip=(.+)$/m.exec(text);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

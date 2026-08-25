import nodemailer from "nodemailer";
import { verifyAuthenticated, type AuthConfig } from "./src/verifyAuth";

const RELAY_SECRET = process.env.RELAY_SECRET;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "587");
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (
  !RELAY_SECRET ||
  !SMTP_HOST ||
  !SMTP_USER ||
  !SMTP_PASS ||
  !NOTIFY_EMAIL_TO ||
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY
) {
  throw new Error(
    "Missing one of RELAY_SECRET, SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL_TO, SUPABASE_URL, SUPABASE_ANON_KEY",
  );
}

const authConfig: AuthConfig = {
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Static-secret path: called only from the Postgres trigger
// (schema_notify_new_account.sql) via pg_net, server-to-server -- never
// reachable from a browser, so a shared secret is fine here. No IP: a DB
// trigger has no HTTP request context to get one from.
async function handleNotifyAccess(req: Request): Promise<Response> {
  if (req.headers.get("x-relay-secret") !== RELAY_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as {
    email?: string;
  } | null;
  const email = body?.email ?? "unknown";

  await transport.sendMail({
    from: SMTP_USER,
    to: NOTIFY_EMAIL_TO,
    subject: "Pin Map: new account created",
    text: `${email} just created a Pin Map account at https://map.joggerjoel.com.`,
  });

  return json({ ok: true });
}

// Client-driven path: called from the browser right after a successful
// sign-in (see src/hooks/useAuth.ts). Trusts the caller's own Supabase
// session token instead of a shared secret -- RELAY_SECRET can't be given
// to browser JS at all (Vite bakes VITE_* vars into the public bundle,
// and this isn't one, so there'd be no way to keep it secret once shipped
// client-side). The email in the notification comes from the verified
// token, never from the request body, so a caller can't claim to be
// someone else. IP is client-reported (see src/lib/clientIp.ts) --
// informational, not a security boundary; a motivated caller could send a
// fake one, same as any client-reported field anywhere.
async function handleNotifyLogin(req: Request): Promise<Response> {
  const auth = await verifyAuthenticated(
    req.headers.get("authorization"),
    authConfig,
  );
  if (!auth.ok) {
    return json({ error: auth.reason ?? "forbidden" }, 403);
  }

  const body = (await req.json().catch(() => null)) as {
    ip?: string;
    isNewAccount?: boolean;
  } | null;
  const ip = body?.ip ?? "unknown";
  const isNewAccount = body?.isNewAccount === true;

  await transport.sendMail({
    from: SMTP_USER,
    to: NOTIFY_EMAIL_TO,
    subject: isNewAccount ? "Pin Map: new account created" : "Pin Map: login",
    text: isNewAccount
      ? `${auth.email} just created a Pin Map account at https://map.joggerjoel.com from ${ip}.`
      : `${auth.email} just logged into Pin Map from ${ip}.`,
  });

  return json({ ok: true });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://map.joggerjoel.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function withCors(res: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

Bun.serve({
  port: 8095,
  hostname: "0.0.0.0",
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (req.method === "POST" && url.pathname === "/notify-access") {
      return handleNotifyAccess(req);
    }
    if (req.method === "POST" && url.pathname === "/notify-login") {
      return withCors(await handleNotifyLogin(req));
    }
    return new Response("not found", { status: 404 });
  },
});

console.log("notify-relay listening on :8095");

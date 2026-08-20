import nodemailer from "nodemailer";

const RELAY_SECRET = process.env.RELAY_SECRET;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "587");
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO;

if (
  !RELAY_SECRET ||
  !SMTP_HOST ||
  !SMTP_USER ||
  !SMTP_PASS ||
  !NOTIFY_EMAIL_TO
) {
  throw new Error(
    "Missing one of RELAY_SECRET, SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL_TO",
  );
}

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

Bun.serve({
  port: 8095,
  hostname: "0.0.0.0",
  async fetch(req) {
    if (
      req.method !== "POST" ||
      new URL(req.url).pathname !== "/notify-access"
    ) {
      return new Response("not found", { status: 404 });
    }
    if (req.headers.get("x-relay-secret") !== RELAY_SECRET) {
      return new Response("unauthorized", { status: 401 });
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

    return new Response("ok");
  },
});

console.log("notify-relay listening on :8095");

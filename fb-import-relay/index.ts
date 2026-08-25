import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { verifyOwner, type OwnerGateConfig } from "./src/ownerGate";
import { extractZip } from "./src/zipExtract";
import { parsePlacesTaggedIn, type CheckIn } from "./src/parsePlacesTaggedIn";
import { correlate, type TimestampedItem } from "./src/correlate";
import { computeExternalKey } from "./src/externalKey";
import { geocodeBatch, type GeocodeInput } from "./src/geocode";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const MAPBOX_TOKEN = requireEnv("MAPBOX_TOKEN");
const PORT = Number(process.env.PORT ?? 8097);
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data";

const ownerGateConfig: OwnerGateConfig = {
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireOwner(req: Request): Promise<string | Response> {
  const check = await verifyOwner(
    req.headers.get("authorization"),
    ownerGateConfig,
  );
  if (!check.ok) return json({ error: check.reason ?? "forbidden" }, 403);
  return check.userId as string;
}

// --- POST /tusd-hook ------------------------------------------------------
//
// tusd's single configured hook endpoint. Every event type lands here as
// one JSON body; only `pre-create` is acted on (reject before any bytes
// are accepted), every other event is acknowledged as a no-op. The exact
// shape of tusd's hook payload (and whether the Authorization header is
// forwarded at all) needs `-hooks-http-forward-headers=Authorization` set
// on the tusd deployment — verify this against a real hook call once
// wired up, the payload shape here is tusd's documented format but should
// be confirmed live, the same way every other assumption in this service
// was checked against the real thing rather than trusted blind.
interface TusdHookBody {
  Type?: string;
  Event?: {
    HTTPRequest?: {
      Header?: Record<string, string[]>;
    };
  };
}

async function handleTusdHook(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as TusdHookBody | null;
  if (!body || body.Type !== "pre-create") {
    return json({});
  }

  const authHeaderValues = body.Event?.HTTPRequest?.Header?.Authorization;
  const authHeader = authHeaderValues?.[0] ?? null;
  const check = await verifyOwner(authHeader, ownerGateConfig);
  if (!check.ok) {
    return json({ error: check.reason ?? "forbidden" }, 403);
  }
  return json({});
}

// --- POST /parse ------------------------------------------------------
//
// Free — makes zero Mapbox calls. Reads the already-uploaded (via tusd)
// zip off the shared volume by its tusd upload ID, extracts only the
// allow-listed files, parses check-ins, and returns candidates with no
// lat/lng. See facebook-import-layout-plan.md.
async function handleParse(req: Request): Promise<Response> {
  const ownerOrResponse = await requireOwner(req);
  if (ownerOrResponse instanceof Response) return ownerOrResponse;

  const body = (await req.json().catch(() => null)) as {
    tusUploadId?: string;
  } | null;
  const tusUploadId = body?.tusUploadId;
  if (!tusUploadId) {
    return json({ error: "missing tusUploadId" }, 400);
  }

  const zipPath = path.join(UPLOAD_DIR, tusUploadId);
  try {
    const stats = await stat(zipPath);
    if (!stats.isFile()) throw new Error("not a file");
  } catch {
    return json({ error: "upload not found" }, 404);
  }

  const extractDir = path.join(UPLOAD_DIR, "_extracted", tusUploadId);
  await mkdir(extractDir, { recursive: true });

  let checkIns: CheckIn[] = [];
  try {
    const extracted = await extractZip(zipPath, extractDir);
    const placesFile = extracted.find((p) =>
      p.endsWith("places_you_have_been_tagged_in.html"),
    );
    if (placesFile) {
      const html = await readFile(path.join(extractDir, placesFile), "utf-8");
      checkIns = parsePlacesTaggedIn(html);
    }

    // NOT YET BUILT: parsers for your_posts__check_ins_*.html,
    // your_photos.html, comments_and_reactions/*.html into
    // TimestampedItem[] for correlate() to match notes/photos against.
    // Candidates ship with no note/photos until that exists — a strict
    // subset of the full design (incomplete, never wrong), tracked as a
    // follow-up in facebook-import-layout-todo.md.
    const correlated = correlate(checkIns, [] as TimestampedItem[]);

    const candidates = correlated.map(({ checkIn }) => ({
      externalKey: computeExternalKey(checkIn.placeName, checkIn.visitTime),
      placeName: checkIn.placeName,
      visitTime: checkIn.visitTime.toISOString(),
      note: null as string | null,
      photos: [] as string[],
    }));

    return json({ candidates });
  } finally {
    // Retention: the zip is deleted once /parse has read it (or, if this
    // handler never runs, tusd's own volume-level TTL sweep — separate,
    // not yet implemented). Extracted files are cleaned up too since
    // nothing here keeps any of them past this request yet (no photo
    // cache exists until posts/photos parsing is built).
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(`${zipPath}.info`, { force: true }).catch(() => {});
  }
}

// --- POST /geocode ------------------------------------------------------
//
// The only endpoint that spends money. See src/geocode.ts.
async function handleGeocode(req: Request): Promise<Response> {
  const ownerOrResponse = await requireOwner(req);
  if (ownerOrResponse instanceof Response) return ownerOrResponse;

  const body = (await req.json().catch(() => null)) as {
    inputs?: GeocodeInput[];
  } | null;
  if (!Array.isArray(body?.inputs)) {
    return json({ error: "missing inputs" }, 400);
  }

  const result = await geocodeBatch(body.inputs, { mapboxToken: MAPBOX_TOKEN });
  return json(result);
}

// --- GET /photo/:tusUploadId/:filename ------------------------------------
//
// Not implemented yet — depends on the photo cache that posts/photos
// correlation would populate. Currently always 404s; tracked as a
// follow-up alongside the correlation parsers above.
async function handlePhoto(): Promise<Response> {
  return json({ error: "not implemented" }, 404);
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (req.method === "POST" && url.pathname === "/tusd-hook") {
      return handleTusdHook(req);
    }
    if (req.method === "POST" && url.pathname === "/parse") {
      return handleParse(req);
    }
    if (req.method === "POST" && url.pathname === "/geocode") {
      return handleGeocode(req);
    }
    if (req.method === "GET" && url.pathname.startsWith("/photo/")) {
      return handlePhoto();
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`fb-import-relay listening on :${server.port}`);

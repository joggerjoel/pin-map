import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  verifyAuthenticated,
  isOwner,
  type OwnerGateConfig,
} from "./src/ownerGate";
import { extractZip } from "./src/zipExtract";
import { parsePlacesTaggedIn, type CheckIn } from "./src/parsePlacesTaggedIn";
import { parsePostsCheckInsPhotos } from "./src/parsePostsCheckInsPhotos";
import { correlate } from "./src/correlate";
import { computeExternalKey } from "./src/externalKey";
import { geocodeBatch, type GeocodeInput } from "./src/geocode";
import {
  cachePhotos,
  cleanupStaleCaches,
  contentTypeFor,
  resolveCachedPhotoPath,
} from "./src/photoCache";
import { claimUpload, readOwner } from "./src/claimUpload";
import {
  checkQuota,
  incrementPlacesPinned,
  type TokenUsageGateConfig,
} from "./src/tokenUsageGate";

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
const PHOTO_CACHE_DIR = path.join(UPLOAD_DIR, "_photo_cache");
const OWNERS_DIR = path.join(UPLOAD_DIR, "_owners");

const ownerGateConfig: OwnerGateConfig = {
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};
const tokenUsageConfig: TokenUsageGateConfig = {
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface AuthedRequest {
  userId: string;
  authorizationHeader: string;
}

async function requireAuthenticated(
  req: Request,
): Promise<AuthedRequest | Response> {
  const authorizationHeader = req.headers.get("authorization");
  const check = await verifyAuthenticated(authorizationHeader, ownerGateConfig);
  if (!check.ok) return json({ error: check.reason ?? "forbidden" }, 403);
  return {
    userId: check.userId as string,
    authorizationHeader: authorizationHeader as string,
  };
}

// --- POST /tusd-hook ------------------------------------------------------
//
// tusd's single configured hook endpoint. Every event type lands here as
// one JSON body; only `pre-create` is acted on (reject before any bytes
// are accepted), every other event is acknowledged as a no-op. This gates
// upload *creation* to any authenticated user (item 1) -- unrelated to
// ownership binding, which is client-driven via /claim-upload below, not
// this hook. Confirmed live that tusd forwards the original request's
// Authorization header into this event.
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
  const check = await verifyAuthenticated(authHeader, ownerGateConfig);
  if (!check.ok) {
    return json({ error: check.reason ?? "forbidden" }, 403);
  }
  return json({});
}

// --- POST /claim-upload -----------------------------------------------
//
// Client-driven ownership binding -- see facebook-import-multi-tenant.md
// item 2. Called by the client immediately after tusd assigns a
// tusUploadId (at creation time, before any bytes are sent), so there's no
// dependency on tusd's hook payload for identity at all.
async function handleClaimUpload(req: Request): Promise<Response> {
  const authed = await requireAuthenticated(req);
  if (authed instanceof Response) return authed;

  const body = (await req.json().catch(() => null)) as {
    tusUploadId?: string;
  } | null;
  const tusUploadId = body?.tusUploadId;
  if (!tusUploadId) {
    return json({ error: "missing tusUploadId" }, 400);
  }

  const result = await claimUpload(
    UPLOAD_DIR,
    OWNERS_DIR,
    tusUploadId,
    authed.userId,
  );
  if (!result.ok) {
    const status = result.error === "already_claimed" ? 403 : 400;
    return json({ error: result.error }, status);
  }
  return json({ ok: true });
}

// --- POST /parse ------------------------------------------------------
//
// Free — makes zero Mapbox calls. Reads the already-uploaded (via tusd)
// zip off the shared volume by its tusd upload ID, extracts only the
// allow-listed files, parses check-ins, and returns candidates with no
// lat/lng. See facebook-import-layout-plan.md.
async function handleParse(req: Request): Promise<Response> {
  const authed = await requireAuthenticated(req);
  if (authed instanceof Response) return authed;

  const body = (await req.json().catch(() => null)) as {
    tusUploadId?: string;
  } | null;
  const tusUploadId = body?.tusUploadId;
  if (!tusUploadId) {
    return json({ error: "missing tusUploadId" }, 400);
  }

  const owner = await readOwner(OWNERS_DIR, tusUploadId);
  if (owner === null) {
    return json({ error: "no_binding" }, 403);
  }
  if (owner !== authed.userId) {
    return json({ error: "owner_mismatch" }, 403);
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

    // your_posts__check_ins__photos_and_videos_N.html — Facebook numbers
    // these when a category's data spans multiple files; every matching
    // one gets parsed and pooled together.
    const postsFiles = extracted.filter((p) =>
      /your_posts__check_ins__photos_and_videos_\d+\.html$/.test(p),
    );
    const posts = (
      await Promise.all(
        postsFiles.map(async (postsFile) => {
          const html = await readFile(
            path.join(extractDir, postsFile),
            "utf-8",
          );
          return parsePostsCheckInsPhotos(html);
        }),
      )
    ).flat();

    // A post whose auto-generated summary reads "checked in at X" is a
    // check-in in its own right, not just a note/photo source for one from
    // places_you_have_been_tagged_in.html — this is what actually widens
    // the date range beyond that file's own (often much sparser) coverage.
    // See parsePostsCheckInsPhotos.ts's header: the "checked in at"
    // extraction itself is unverified against a real example.
    const postCheckIns: CheckIn[] = posts
      .filter((p) => p.checkInPlaceName !== null)
      .map((p) => ({
        placeName: p.checkInPlaceName as string,
        visitTime: p.timestamp,
      }));

    // STILL NOT YET BUILT: your_photos.html and comments_and_reactions/*.html
    // as additional note/photo sources — tracked as a follow-up in
    // facebook-import-layout-todo.md. Posts (this file) are wired in now.
    const correlated = correlate([...checkIns, ...postCheckIns], posts);

    const candidates = correlated.map(({ checkIn, matches }) => ({
      externalKey: computeExternalKey(checkIn.placeName, checkIn.visitTime),
      placeName: checkIn.placeName,
      visitTime: checkIn.visitTime.toISOString(),
      note:
        matches.length > 0
          ? matches.map((m) => m.summaryText).join(" · ")
          : null,
      photos: matches.flatMap((m) => m.photoPaths),
    }));

    // Copy matched files out of extractDir into the persistent photo cache
    // *before* the finally block below deletes extractDir — GET /photo/...
    // serves out of the cache, never out of extractDir directly, since
    // extractDir's lifetime is scoped to this single request.
    const allPhotoPaths = candidates.flatMap((c) => c.photos);
    await cachePhotos(PHOTO_CACHE_DIR, tusUploadId, extractDir, allPhotoPaths);
    await cleanupStaleCaches(PHOTO_CACHE_DIR).catch(() => {});

    return json({ candidates });
  } finally {
    // Retention: the zip is deleted once /parse has read it (or, if this
    // handler never runs, tusd's own volume-level TTL sweep — separate,
    // not yet implemented). extractDir itself is always scoped to this
    // one request — anything worth keeping past it was already copied
    // into PHOTO_CACHE_DIR above.
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(`${zipPath}.info`, { force: true }).catch(() => {});
  }
}

// --- POST /geocode ------------------------------------------------------
//
// The only endpoint that spends money. See src/geocode.ts and
// src/tokenUsageGate.ts. The owner is exempt from the shared-token quota
// app-wide (pinmap_token_usage's own schema comment); everyone else is
// checked against it here, server-side, since a caller could otherwise
// skip the client's own pre-check by calling this endpoint directly.
async function handleGeocode(req: Request): Promise<Response> {
  const authed = await requireAuthenticated(req);
  if (authed instanceof Response) return authed;

  const body = (await req.json().catch(() => null)) as {
    inputs?: GeocodeInput[];
  } | null;
  if (!Array.isArray(body?.inputs)) {
    return json({ error: "missing inputs" }, 400);
  }

  const exempt = await isOwner(authed.userId, ownerGateConfig);
  if (!exempt) {
    const quota = await checkQuota(
      authed.authorizationHeader,
      authed.userId,
      body.inputs.length,
      tokenUsageConfig,
    );
    if (!quota.allowed) {
      return json(
        { error: "quota_exceeded", currentCount: quota.currentCount },
        429,
      );
    }
  }

  const result = await geocodeBatch(body.inputs, { mapboxToken: MAPBOX_TOKEN });

  if (!exempt) {
    // Count of place names that actually got a result back, not the raw
    // request size -- geocodeBatch's own per-request cap can truncate a
    // batch, and incrementing by the untruncated request size would
    // over-count relative to what was actually spent.
    await incrementPlacesPinned(
      authed.authorizationHeader,
      Object.keys(result.results).length,
      tokenUsageConfig,
    );
  }

  return json(result);
}

// --- GET /photo/:tusUploadId/:filename ------------------------------------
//
// Lazy photo fetch: streams raw bytes straight off the photo cache
// populated by /parse — no base64, no JSON envelope (see
// facebook-import-layout-plan.md's "lazy photo fetch" section on why).
// Same ownership check as /parse (via the .owner binding, not just
// authentication); filename is resolved through resolveCachedPhotoPath's
// traversal guard before ever touching disk.
async function handlePhoto(
  req: Request,
  tusUploadId: string,
  filename: string,
): Promise<Response> {
  const authed = await requireAuthenticated(req);
  if (authed instanceof Response) return authed;

  const owner = await readOwner(OWNERS_DIR, tusUploadId);
  if (owner === null) {
    return json({ error: "no_binding" }, 403);
  }
  if (owner !== authed.userId) {
    return json({ error: "owner_mismatch" }, 403);
  }

  const resolved = resolveCachedPhotoPath(
    PHOTO_CACHE_DIR,
    tusUploadId,
    filename,
  );
  if (resolved === null) {
    return json({ error: "invalid filename" }, 400);
  }

  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    return json({ error: "not found" }, 404);
  }

  return new Response(file, {
    status: 200,
    headers: { "Content-Type": contentTypeFor(filename) },
  });
}

// /parse, /geocode, /photo/*, and /claim-upload are called directly from
// the browser (see fbImportRelayClient.ts) — a cross-origin POST carrying
// a custom Authorization header triggers a CORS preflight OPTIONS
// request, which this server previously had no handling for at all
// (falling through to a bare 404 with no CORS headers). The browser then
// blocks the real request before it's even sent, surfacing as a generic
// "Failed to fetch" with no server-side trace — confirmed live: tusd's
// hooks (server-to-server, not subject to CORS) worked fine while the
// browser's own /parse call silently failed. No credentials/cookies are
// used here (Bearer token in a header, verified per-request by
// requireAuthenticated), so a wildcard origin is safe — it doesn't widen
// what requireAuthenticated already gates.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function withCors(res: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (req.method === "POST" && url.pathname === "/tusd-hook") {
      return handleTusdHook(req);
    }
    if (req.method === "POST" && url.pathname === "/claim-upload") {
      return withCors(await handleClaimUpload(req));
    }
    if (req.method === "POST" && url.pathname === "/parse") {
      return withCors(await handleParse(req));
    }
    if (req.method === "POST" && url.pathname === "/geocode") {
      return withCors(await handleGeocode(req));
    }
    if (req.method === "GET" && url.pathname.startsWith("/photo/")) {
      const [, , tusUploadId, filename] = url.pathname.split("/");
      if (!tusUploadId || !filename) {
        return withCors(
          json({ error: "missing tusUploadId or filename" }, 400),
        );
      }
      return withCors(await handlePhoto(req, tusUploadId, filename));
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`fb-import-relay listening on :${server.port}`);

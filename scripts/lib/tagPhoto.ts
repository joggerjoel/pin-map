// Shared per-photo AI tagging logic: perceptual hash, vision-model
// caption/tags, face detection, semantic embedding. Used by both
// scripts/backfill-photo-tags.ts and scripts/import-mitm-photos.ts, so a
// bug fixed here fixes both callers -- see ai-tagging-plan.md for the full
// design and the P0 spike's findings behind every choice made here (model
// picks, the sharp-first decode requirement, the sanitize-not-reject tag
// validation).
// @vladmandic/face-api replaced the original, unmaintained face-api.js:
// that package bundled its own tfjs-core@1.7.0, which created a second,
// incompatible kernel registry alongside any modern tfjs-node, and
// crashed at inference time ("forwardFunc_1 is not a function"),
// confirmed against real production photos before switching. This fork's
// default Node build (dist/face-api.node.js, what `import "@vladmandic/
// face-api"` resolves to) unconditionally requires plain `@tensorflow/
// tfjs-node` internally -- loading `@tensorflow/tfjs-node-gpu` in the same
// process as that default build fatally crashes ("Duplicate registration
// of device factory for type XLA_CPU"), confirmed by the local test suite.
//
// The fork also publishes a second, separate Node build --
// dist/face-api.node-gpu.js -- whose only native require() is
// `@tensorflow/tfjs-node-gpu`; it never touches plain tfjs-node, so it
// never hits the dual-runtime crash above (confirmed by reading the
// published bundle directly, not assumed). loadFaceApi() below picks
// between the two via FACE_DETECTOR_BACKEND, as a *dynamic* import so the
// unused backend's module is never even touched on a machine that
// doesn't have it installed (e.g. tfjs-node-gpu is an optionalDependency,
// absent on non-GPU machines). See macstudio-backfill-spec.md, "GPU
// acceleration on aorus", for the full story and verification results.
import { Canvas, Image, ImageData } from "canvas";
import sharp from "sharp";
import * as blockhash from "blockhash-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type FaceApiModule = typeof import("@vladmandic/face-api");

let faceapiPromise: Promise<FaceApiModule> | null = null;

function loadFaceApi(): Promise<FaceApiModule> {
  if (!faceapiPromise) {
    faceapiPromise = (async () => {
      const backend = process.env.FACE_DETECTOR_BACKEND ?? "cpu";
      const mod =
        backend === "gpu"
          ? ((await import("@vladmandic/face-api/dist/face-api.node-gpu.js")) as FaceApiModule)
          : ((await import("@vladmandic/face-api")) as FaceApiModule);
      // @ts-expect-error face-api.js expects browser globals; canvas polyfills them
      mod.env.monkeyPatch({ Canvas, Image, ImageData });
      return mod;
    })();
  }
  return faceapiPromise;
}

// Bumped from 1 -> 2 for the already-shipped face-api.js -> @vladmandic/
// face-api swap (different weight files -- a real trigger under the rule
// below). The CPU/GPU backend choice (FACE_DETECTOR_BACKEND) is NOT a
// pipeline_version trigger: both run the identical TinyFaceDetector
// weights through the identical op graph, just on a different native
// backend -- a compute detail, not a model change.
export const PIPELINE_VERSION = 2;

export const TAG_TAXONOMY = [
  "landscape",
  "people",
  "screenshot",
  "document",
  "food",
  "animal",
  "other",
] as const;
export type Tag = (typeof TAG_TAXONOMY)[number];

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const VISION_MODEL = "llava";
const EMBED_MODEL = "nomic-embed-text";
const OLLAMA_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const PHASH_BITS = 16; // -> 256-bit / 64-hex-char hash, per the P0 spike

// Confirmed against the real backlog by the P0 spike (all 8,039 rows
// scanned): webp 7804, png 108, jpg 81, gif 2, mp4 44 -- no .mov/.webm
// actually present, kept as a safe superset matching the client's
// existing kindFromStoragePath() convention in src/lib/photosRepository.ts.
const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm)$/i;

// The exact prompt the P0 spike measured (75-90% match against a 20-photo
// ground truth, scoring-dependent) -- part of the pipeline_version
// provenance definition (originally recorded under version 1, unchanged
// since). Changing this wording is a pipeline_version bump.
const TAGGING_PROMPT = `Look ONLY at what is literally visible in this photo. Do not guess or assume a typical scene.

Reply with ONLY a single-line JSON object, no markdown, no extra text:
{"caption": "<one sentence, only what you actually see>", "tags": [...]}

Choose tags ONLY from this exact list -- do not invent any other words:
landscape, people, screenshot, document, food, animal, other

Strict rules:
- Include a tag ONLY if you are confident it is actually visible. If in doubt, leave it out.
- "other" may ONLY appear alone, by itself, never combined with any other tag.
- Never output a tag that is not one of the seven words listed above.
- A real outdoor photo of a person or scenery is virtually never "screenshot", "document", "food", or "animal" -- do not add those unless they are unmistakably, literally in the photo.`;

const FACE_MODEL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "face-models",
);
let faceModelsLoaded = false;
async function ensureFaceModelsLoaded(): Promise<FaceApiModule> {
  const faceapi = await loadFaceApi();
  if (!faceModelsLoaded) {
    await faceapi.nets.tinyFaceDetector.loadFromDisk(FACE_MODEL_DIR);
    faceModelsLoaded = true;
  }
  return faceapi;
}

export interface DecodedImage {
  data: Buffer;
  width: number;
  height: number;
}

export function inferMediaType(storagePath: string): "image" | "video" {
  return VIDEO_EXTENSION_PATTERN.test(storagePath) ? "video" : "image";
}

// node-canvas cannot decode WebP (confirmed by the P0 spike -- it's 97% of
// this backlog), and neither can Ollama's own vision-model image
// ingestion. sharp/libvips is the pipeline's single decoder; every other
// consumer (face-api.js, Ollama) receives bytes it already produced, never
// raw file bytes.
export async function decodeImage(imageBytes: Buffer): Promise<DecodedImage> {
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image exceeds ${MAX_IMAGE_BYTES} byte cap`);
  }
  const { data, info } = await sharp(imageBytes)
    .rotate() // EXIF-orientation-normalize BEFORE hashing/detection
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function computePhash(image: DecodedImage): string {
  return blockhash.bmvbhash(image, PHASH_BITS);
}

export async function detectFace(image: DecodedImage): Promise<boolean> {
  const faceapi = await ensureFaceModelsLoaded();
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(image.width, image.height);
  imageData.data.set(image.data);
  ctx.putImageData(imageData, 0, 0);

  const detections = await faceapi.detectAllFaces(
    canvas as unknown as HTMLCanvasElement,
    new faceapi.TinyFaceDetectorOptions(),
  );
  return detections.length > 0;
}

/**
 * Sanitize a model's raw tag output rather than reject it outright: drop
 * any tag outside the fixed taxonomy, then drop "other" specifically if
 * it's combined with a real tag. Only null (invalid) if nothing valid
 * remains -- see ai-tagging-plan.md "Vision tagging + caption" for why
 * this replaced strict all-or-nothing rejection (llava's own content
 * judgment was consistently reliable even when it ignored the
 * other-exclusivity instruction).
 */
export function sanitizeTags(rawTags: unknown): Tag[] | null {
  if (!Array.isArray(rawTags)) return null;
  const known = rawTags.filter(
    (t): t is Tag =>
      typeof t === "string" && (TAG_TAXONOMY as readonly string[]).includes(t),
  );
  const deduped = [...new Set(known)];
  const sanitized =
    deduped.length > 1 ? deduped.filter((t) => t !== "other") : deduped;
  return sanitized.length > 0 ? sanitized : null;
}

export interface CaptionAndTags {
  caption: string;
  tags: Tag[];
}

export function parseModelResponse(raw: string): CaptionAndTags | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const caption = typeof obj.caption === "string" ? obj.caption.trim() : "";
  if (caption === "") return null;
  const tags = sanitizeTags(obj.tags);
  if (tags === null) return null;
  return { caption, tags };
}

// Thrown only for a genuine connectivity failure (fetch() itself rejecting:
// connection refused, DNS failure, or our own abort-on-timeout) -- never for
// a non-2xx HTTP response, which stays a per-photo failure. tagPhoto()
// re-throws this instead of swallowing it, so a total Ollama outage aborts
// the whole run rather than burning tag_attempts across every row it
// touches -- see ai-tagging-plan.md, "Error handling".
export class OllamaUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Ollama unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "OllamaUnavailableError";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new OllamaUnavailableError(err);
  } finally {
    clearTimeout(timeout);
  }
}

async function ollamaGenerate(pngBytes: Buffer): Promise<string> {
  const body = JSON.stringify({
    model: VISION_MODEL,
    prompt: TAGGING_PROMPT,
    images: [pngBytes.toString("base64")],
    stream: false,
    format: "json",
  });
  const res = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}/api/generate`,
    { method: "POST", body },
    OLLAMA_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(
      `Ollama /api/generate returned ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { response: string };
  return json.response;
}

/**
 * One immediate retry with a short backoff, for either a transient
 * network/timeout error OR a response that parses as invalid/empty JSON --
 * one shared retry budget covering both failure modes, not two stacked
 * retries. The retry attempt itself is unguarded: if it also fails (throws,
 * or parses to null), that's the final result -- a second parse failure is
 * the caller's tag_attempts concern, not this function's.
 */
export async function generateCaptionAndTags(
  pngBytes: Buffer,
): Promise<CaptionAndTags | null> {
  async function attempt(): Promise<CaptionAndTags | null> {
    const raw = await ollamaGenerate(pngBytes);
    return parseModelResponse(raw);
  }

  try {
    const result = await attempt();
    if (result !== null) return result;
  } catch {
    // fall through to the single retry below
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return attempt();
}

export async function embedCaption(caption: string): Promise<number[]> {
  const res = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}/api/embeddings`,
    {
      method: "POST",
      body: JSON.stringify({ model: EMBED_MODEL, prompt: caption }),
    },
    OLLAMA_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(
      `Ollama /api/embeddings returned ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { embedding: number[] };
  return json.embedding;
}

export interface TagPhotoSuccess {
  ok: true;
  caption: string;
  tags: Tag[];
  hasFace: boolean;
  phash: string;
  embedding: number[];
  pipelineVersion: number;
}

export interface TagPhotoFailure {
  ok: false;
  error: string;
}

export type TagPhotoResult = TagPhotoSuccess | TagPhotoFailure;

/**
 * Full pipeline for one image: decode once via sharp, then hash + detect +
 * caption/tag + embed from that single decode. Never call this for a
 * video row -- callers are expected to have already routed those to
 * tag_status = 'skipped' via inferMediaType(), same as the schema
 * migration's one-time backfill did for the existing backlog.
 */
export async function tagPhoto(imageBytes: Buffer): Promise<TagPhotoResult> {
  try {
    const image = await decodeImage(imageBytes);
    const phash = computePhash(image);
    const hasFace = await detectFace(image);

    const pngBytes = await sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png()
      .toBuffer();

    const captionAndTags = await generateCaptionAndTags(pngBytes);
    if (captionAndTags === null) {
      return { ok: false, error: "vision model response failed validation" };
    }

    const embedding = await embedCaption(captionAndTags.caption);

    return {
      ok: true,
      caption: captionAndTags.caption,
      tags: captionAndTags.tags,
      hasFace,
      phash,
      embedding,
      pipelineVersion: PIPELINE_VERSION,
    };
  } catch (err) {
    // A total Ollama outage is an environment problem, not a per-photo one
    // -- propagate it so the caller aborts the run instead of recording a
    // failed attempt against this (and every subsequent) row.
    if (err instanceof OllamaUnavailableError) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Persists a tagPhoto() result: a conditional write for success (no
 * arithmetic needed, plain PostgREST update suffices) or the
 * record_photo_tag_failure RPC for failure (atomic tag_attempts increment
 * -- not expressible as a plain PostgREST update). Shared by
 * backfill-photo-tags.ts and import-mitm-photos.ts so both write outcomes
 * through the exact same conditional-update discipline, not two
 * hand-rolled copies that could drift.
 */
export async function applyTagResult(
  supabase: SupabaseClient,
  photoId: string,
  result: TagPhotoResult,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<"completed" | "failed"> {
  if (!result.ok) {
    const { error: rpcError } = await supabase.rpc("record_photo_tag_failure", {
      p_photo_id: photoId,
      p_error: result.error,
      p_max_attempts: maxAttempts,
    });
    if (rpcError) {
      console.error(
        `Failed to record failure for ${photoId}: ${rpcError.message}`,
      );
    }
    return "failed";
  }

  const { data: updated, error: updateError } = await supabase
    .from("pinmap_place_photos")
    .update({
      caption: result.caption,
      tags: result.tags,
      has_face: result.hasFace,
      phash: result.phash,
      embedding: result.embedding,
      tagged_at: new Date().toISOString(),
      tag_status: "complete",
      pipeline_version: result.pipelineVersion,
    })
    .eq("id", photoId)
    .eq("tag_status", "pending")
    .select("id");

  if (updateError) {
    console.error(`Update failed for ${photoId}: ${updateError.message}`);
    // A genuine write failure, not "someone else already claimed it" --
    // record it the same way any other failure is recorded, so tag_attempts
    // increments and the row doesn't silently stay 'pending' forever,
    // untracked, if this keeps failing.
    const { error: rpcError } = await supabase.rpc("record_photo_tag_failure", {
      p_photo_id: photoId,
      p_error: updateError.message,
      p_max_attempts: maxAttempts,
    });
    if (rpcError) {
      console.error(
        `Failed to record failure for ${photoId}: ${rpcError.message}`,
      );
    }
    return "failed";
  }
  if (!updated || updated.length === 0) {
    // Another writer already claimed this row (shouldn't happen under the
    // file lock's single-instance guarantee, but the conditional WHERE is
    // defense-in-depth, not decoration) -- treat it as handled, not an error.
    console.log(`${photoId} was already claimed by another writer; skipping.`);
  }
  return "completed";
}

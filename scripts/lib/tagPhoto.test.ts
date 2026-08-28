import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sanitizeTags,
  parseModelResponse,
  inferMediaType,
  computePhash,
  decodeImage,
  generateCaptionAndTags,
  applyTagResult,
  OllamaUnavailableError,
  type DecodedImage,
} from "./tagPhoto";

const PHASH_PATTERN = /^[0-9a-f]{64}$/;

describe("sanitizeTags", () => {
  it("passes through valid taxonomy tags unchanged", () => {
    expect(sanitizeTags(["landscape", "people"])).toEqual([
      "landscape",
      "people",
    ]);
  });

  it("drops any tag outside the fixed taxonomy", () => {
    expect(sanitizeTags(["landscape", "cityscape", "forest"])).toEqual([
      "landscape",
    ]);
  });

  it("keeps 'other' when it's the only tag", () => {
    expect(sanitizeTags(["other"])).toEqual(["other"]);
  });

  it("drops 'other' when combined with a real tag, keeps the real tag", () => {
    expect(sanitizeTags(["other", "people"])).toEqual(["people"]);
    expect(sanitizeTags(["landscape", "people", "other"])).toEqual([
      "landscape",
      "people",
    ]);
  });

  it("dedupes repeated tags", () => {
    expect(sanitizeTags(["people", "people", "landscape"])).toEqual([
      "people",
      "landscape",
    ]);
  });

  it("returns null for an empty array", () => {
    expect(sanitizeTags([])).toBeNull();
  });

  it("returns null when every tag is out-of-taxonomy (nothing survives)", () => {
    expect(sanitizeTags(["cityscape", "forest"])).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(sanitizeTags("landscape")).toBeNull();
    expect(sanitizeTags(null)).toBeNull();
    expect(sanitizeTags(undefined)).toBeNull();
  });
});

describe("parseModelResponse", () => {
  it("parses a well-formed response", () => {
    expect(
      parseModelResponse(
        '{"caption": "A mountain trail.", "tags": ["landscape"]}',
      ),
    ).toEqual({ caption: "A mountain trail.", tags: ["landscape"] });
  });

  it("returns null for malformed JSON", () => {
    expect(parseModelResponse("not json at all")).toBeNull();
    expect(
      parseModelResponse('{"caption": "A mountain trail.", "tags": ['),
    ).toBeNull();
  });

  it("returns null for a blank or missing caption", () => {
    expect(
      parseModelResponse('{"caption": "", "tags": ["landscape"]}'),
    ).toBeNull();
    expect(
      parseModelResponse('{"caption": "   ", "tags": ["landscape"]}'),
    ).toBeNull();
    expect(parseModelResponse('{"tags": ["landscape"]}')).toBeNull();
  });

  it("returns null when tags sanitize down to nothing", () => {
    expect(
      parseModelResponse('{"caption": "A photo.", "tags": []}'),
    ).toBeNull();
    expect(
      parseModelResponse('{"caption": "A photo.", "tags": ["skateboards"]}'),
    ).toBeNull();
  });

  it("sanitizes tags rather than rejecting the whole response", () => {
    expect(
      parseModelResponse(
        '{"caption": "A cyclist on a road.", "tags": ["landscape", "people", "other"]}',
      ),
    ).toEqual({
      caption: "A cyclist on a road.",
      tags: ["landscape", "people"],
    });
  });

  it("trims whitespace from the caption", () => {
    expect(
      parseModelResponse('{"caption": "  A photo.  ", "tags": ["other"]}'),
    ).toEqual({ caption: "A photo.", tags: ["other"] });
  });
});

describe("inferMediaType", () => {
  it("classifies real backlog extensions correctly", () => {
    expect(inferMediaType("user/abc.webp")).toBe("image");
    expect(inferMediaType("user/abc.png")).toBe("image");
    expect(inferMediaType("user/abc.jpg")).toBe("image");
    expect(inferMediaType("user/abc.gif")).toBe("image");
    expect(inferMediaType("user/abc.mp4")).toBe("video");
  });

  it("also recognizes .mov/.webm as video, matching the client convention", () => {
    expect(inferMediaType("user/abc.mov")).toBe("video");
    expect(inferMediaType("user/abc.webm")).toBe("video");
  });

  it("is case-insensitive", () => {
    expect(inferMediaType("user/ABC.MP4")).toBe("video");
  });
});

function syntheticImage(pattern: "left-white" | "right-white"): DecodedImage {
  const width = 32;
  const height = 16;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isLeftHalf = x < width / 2;
      const white = pattern === "left-white" ? isLeftHalf : !isLeftHalf;
      const value = white ? 255 : 0;
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("computePhash", () => {
  it("is deterministic: same image twice produces the same hash", () => {
    const image = syntheticImage("left-white");
    expect(computePhash(image)).toBe(computePhash(image));
  });

  it("produces a 64-character hex hash (256-bit, per the P0 spike's bit-length choice)", () => {
    expect(computePhash(syntheticImage("left-white"))).toMatch(PHASH_PATTERN);
  });

  it("produces different hashes for visually different images", () => {
    expect(computePhash(syntheticImage("left-white"))).not.toBe(
      computePhash(syntheticImage("right-white")),
    );
  });
});

describe("decodeImage EXIF-orientation normalization", () => {
  let unrotatedHash: string;
  let physicallyRotatedHash: string;
  let exifRotatedHash: string;

  beforeAll(async () => {
    const width = 64;
    const height = 32;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = x < width / 2 ? 255 : 0; // left half white, right half black
        const i = (y * width + x) * 3;
        raw[i] = value;
        raw[i + 1] = value;
        raw[i + 2] = value;
      }
    }
    const base = sharp(raw, { raw: { width, height, channels: 3 } });

    const unrotatedBytes = await base.clone().png().toBuffer();
    const unrotated = await decodeImage(unrotatedBytes);
    unrotatedHash = computePhash(unrotated);

    // Physically rotate the pixels 90 degrees, no EXIF tag involved.
    const physicallyRotatedBytes = await base
      .clone()
      .rotate(90)
      .png()
      .toBuffer();
    const physicallyRotated = await decodeImage(physicallyRotatedBytes);
    physicallyRotatedHash = computePhash(physicallyRotated);

    // Same unrotated pixels, but stamped with an EXIF orientation tag
    // (6 = "rotate 90 CW to display correctly") instead of being
    // physically rotated. decodeImage()'s .rotate() call (no args) must
    // auto-orient using that tag before hashing.
    const exifRotatedBytes = await base
      .clone()
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const exifRotated = await decodeImage(exifRotatedBytes);
    exifRotatedHash = computePhash(exifRotated);
  });

  it("a physically-rotated image hashes differently from the original", () => {
    expect(physicallyRotatedHash).not.toBe(unrotatedHash);
  });

  it("an EXIF-orientation-tagged image is normalized to match the physically-rotated version, not the raw pixels", () => {
    expect(exifRotatedHash).toBe(physicallyRotatedHash);
    expect(exifRotatedHash).not.toBe(unrotatedHash);
  });
});

function mockFetchSequence(
  responses: Array<() => Promise<Response> | Response>,
) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = responses[Math.min(call, responses.length - 1)];
      call++;
      return next();
    }),
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateCaptionAndTags -- retry budget covers both failure modes", () => {
  it("retries once on a network failure, and returns the retry's result", async () => {
    mockFetchSequence([
      () => Promise.reject(new Error("ECONNREFUSED")),
      () =>
        jsonResponse({
          response: '{"caption": "A trail.", "tags": ["landscape"]}',
        }),
    ]);
    await expect(generateCaptionAndTags(Buffer.from(""))).resolves.toEqual({
      caption: "A trail.",
      tags: ["landscape"],
    });
  });

  it("retries once on a response that parses as invalid JSON, not just on network errors", async () => {
    mockFetchSequence([
      () => jsonResponse({ response: "not valid json" }),
      () =>
        jsonResponse({
          response: '{"caption": "A trail.", "tags": ["landscape"]}',
        }),
    ]);
    await expect(generateCaptionAndTags(Buffer.from(""))).resolves.toEqual({
      caption: "A trail.",
      tags: ["landscape"],
    });
  });

  it("the retry itself is unguarded: a second parse failure is the final (null) result", async () => {
    mockFetchSequence([
      () => jsonResponse({ response: "not valid json" }),
      () => jsonResponse({ response: "still not valid json" }),
    ]);
    await expect(generateCaptionAndTags(Buffer.from(""))).resolves.toBeNull();
  });

  it("the retry itself is unguarded: a second network failure propagates", async () => {
    mockFetchSequence([
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.reject(new Error("ECONNREFUSED again")),
    ]);
    await expect(generateCaptionAndTags(Buffer.from(""))).rejects.toThrow(
      OllamaUnavailableError,
    );
  });
});

// No end-to-end tagPhoto()-level test here: that would need a real
// detectFace() call, and running the real @vladmandic/face-api CPU
// pipeline under vitest currently crashes with
// `TypeError: (0 , util_1.isNullOrUndefined) is not a function` deep
// inside @tensorflow/tfjs-node's kernel backend (confirmed while writing
// this test -- unrelated to this change, a pre-existing gap: no test ever
// exercised detectFace()/tagPhoto() before, only the pure functions
// above). tagPhoto()'s re-throw (`if (err instanceof OllamaUnavailableError)
// throw err;`) is a two-line, directly-reviewable change; the retry-budget
// and error-classification logic it depends on is fully covered by the
// generateCaptionAndTags tests above. Flagged separately, not fixed here --
// see the session's final summary.

function fakeSupabase(opts: {
  updateError?: { message: string } | null;
  updateData?: Array<{ id: string }> | null;
  rpcError?: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const select = vi.fn().mockResolvedValue({
    data: opts.updateData ?? null,
    error: opts.updateError ?? null,
  });
  const eq2 = vi.fn(() => ({ select }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const update = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ update }));
  return {
    rpc,
    from,
    _spies: { rpc, from, update, eq1, eq2, select },
  } as unknown as SupabaseClient & {
    _spies: Record<string, ReturnType<typeof vi.fn>>;
  };
}

describe("applyTagResult -- a genuine write failure still records an attempt", () => {
  it("calls record_photo_tag_failure when the conditional UPDATE itself errors", async () => {
    const supabase = fakeSupabase({
      updateError: { message: "connection reset" },
    });
    const outcome = await applyTagResult(
      supabase,
      "photo-1",
      {
        ok: true,
        caption: "x",
        tags: ["other"],
        hasFace: false,
        phash: "a".repeat(64),
        embedding: [0],
        pipelineVersion: 2,
      },
      3,
    );
    expect(outcome).toBe("failed");
    expect(supabase._spies.rpc).toHaveBeenCalledWith(
      "record_photo_tag_failure",
      {
        p_photo_id: "photo-1",
        p_error: "connection reset",
        p_max_attempts: 3,
      },
    );
  });

  it("does NOT call record_photo_tag_failure on an ordinary already-claimed (zero rows) outcome", async () => {
    const supabase = fakeSupabase({ updateData: [] });
    const outcome = await applyTagResult(
      supabase,
      "photo-1",
      {
        ok: true,
        caption: "x",
        tags: ["other"],
        hasFace: false,
        phash: "a".repeat(64),
        embedding: [0],
        pipelineVersion: 2,
      },
      3,
    );
    expect(outcome).toBe("completed");
    expect(supabase._spies.rpc).not.toHaveBeenCalled();
  });
});

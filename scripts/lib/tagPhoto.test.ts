import { describe, expect, it, beforeAll } from "vitest";
import sharp from "sharp";
import {
  sanitizeTags,
  parseModelResponse,
  inferMediaType,
  computePhash,
  decodeImage,
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

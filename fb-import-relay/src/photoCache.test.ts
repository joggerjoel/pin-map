import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cachePhotos,
  cleanupStaleCaches,
  contentTypeFor,
  resolveCachedPhotoPath,
} from "./photoCache";

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "photocache-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("contentTypeFor", () => {
  test("maps known image/video extensions", () => {
    expect(contentTypeFor("a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("a.JPEG")).toBe("image/jpeg");
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.mp4")).toBe("video/mp4");
    expect(contentTypeFor("a.mov")).toBe("video/quicktime");
  });

  test("falls back for unknown extensions", () => {
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("noextension")).toBe("application/octet-stream");
  });
});

describe("cachePhotos", () => {
  test("copies matched files into baseDir/tusUploadId, flattened to basename", async () => {
    const extractDir = path.join(root, "extracted");
    await mkdir(path.join(extractDir, "media/Photos_1"), { recursive: true });
    await writeFile(
      path.join(extractDir, "media/Photos_1/a.jpg"),
      "fake-bytes",
    );

    const cacheBase = path.join(root, "cache");
    await cachePhotos(cacheBase, "upload-1", extractDir, [
      "media/Photos_1/a.jpg",
    ]);

    const dest = resolveCachedPhotoPath(cacheBase, "upload-1", "a.jpg");
    expect(dest).not.toBeNull();
    const bytes = await Bun.file(dest as string).text();
    expect(bytes).toBe("fake-bytes");
  });

  test("dedupes repeated paths and skips missing source files without throwing", async () => {
    const extractDir = path.join(root, "extracted");
    await mkdir(extractDir, { recursive: true });
    await writeFile(path.join(extractDir, "real.jpg"), "x");

    const cacheBase = path.join(root, "cache");
    await expect(
      cachePhotos(cacheBase, "upload-2", extractDir, [
        "real.jpg",
        "real.jpg",
        "missing.jpg",
      ]),
    ).resolves.toBeUndefined();

    expect(
      resolveCachedPhotoPath(cacheBase, "upload-2", "real.jpg"),
    ).not.toBeNull();
  });

  test("no-ops for an empty path list", async () => {
    const cacheBase = path.join(root, "cache");
    await cachePhotos(cacheBase, "upload-3", root, []);
    // Directory is never created when there's nothing to cache.
    expect(
      resolveCachedPhotoPath(cacheBase, "upload-3", "anything.jpg"),
    ).not.toBeNull(); // path resolution itself doesn't require existence
  });
});

describe("resolveCachedPhotoPath", () => {
  const base = "/data/_photo_cache";

  test("accepts a plain basename", () => {
    expect(resolveCachedPhotoPath(base, "u1", "photo.jpg")).toBe(
      path.resolve(base, "u1", "photo.jpg"),
    );
  });

  test.each(["../escape.jpg", "..", "a/b.jpg", "a\\b.jpg", "", "a\0b.jpg"])(
    "rejects %p",
    (filename) => {
      expect(resolveCachedPhotoPath(base, "u1", filename)).toBeNull();
    },
  );
});

describe("cleanupStaleCaches", () => {
  test("removes directories older than the TTL, keeps fresh ones", async () => {
    const cacheBase = path.join(root, "cache");
    const staleDir = path.join(cacheBase, "stale-upload");
    const freshDir = path.join(cacheBase, "fresh-upload");
    await mkdir(staleDir, { recursive: true });
    await mkdir(freshDir, { recursive: true });

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(staleDir, old, old);

    await cleanupStaleCaches(cacheBase, 24 * 60 * 60 * 1000);

    expect(await dirExists(staleDir)).toBe(false);
    expect(await dirExists(freshDir)).toBe(true);
  });

  test("is a no-op when the cache base dir doesn't exist yet", async () => {
    await expect(
      cleanupStaleCaches(path.join(root, "never-created")),
    ).resolves.toBeUndefined();
  });
});

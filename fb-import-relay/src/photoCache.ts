// Short-lived per-upload cache for photos/videos matched to a check-in
// during /parse. /parse's extraction dir is deleted once it returns (see
// index.ts's finally block), so anything a later GET /photo/:tusUploadId/
// :filename should be able to serve has to be copied out into a directory
// that survives past that request — this is that directory.
//
// TTL sweep runs opportunistically (called once per /parse) rather than on
// a timer — this service has no background-job runtime, and /parse is
// already the only write path into the cache, so checking staleness there
// is sufficient without adding one.

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export function contentTypeFor(filename: string): string {
  return (
    CONTENT_TYPES[path.extname(filename).toLowerCase()] ??
    "application/octet-stream"
  );
}

function cacheDirFor(baseDir: string, tusUploadId: string): string {
  return path.join(baseDir, tusUploadId);
}

// Copies each matched photo/video out of the (about-to-be-deleted) extract
// dir into the persistent cache, keyed by tusUploadId then flattened to the
// file's basename — matches the GET /photo/:tusUploadId/:filename route
// shape. A source file that's missing or fails to copy is skipped (logged,
// not thrown) rather than failing the whole /parse response over one bad
// photo reference.
export async function cachePhotos(
  baseDir: string,
  tusUploadId: string,
  extractDir: string,
  relativePaths: string[],
): Promise<void> {
  const unique = [...new Set(relativePaths)];
  if (unique.length === 0) return;

  const destDir = cacheDirFor(baseDir, tusUploadId);
  await mkdir(destDir, { recursive: true });

  await Promise.all(
    unique.map(async (relPath) => {
      const src = path.join(extractDir, relPath);
      const dest = path.join(destDir, path.basename(relPath));
      try {
        await copyFile(src, dest);
      } catch (err) {
        console.error(`photoCache: failed to cache ${relPath}: ${err}`);
      }
    }),
  );
}

// Rejects any filename that isn't a plain basename (no path separators, no
// ".." segments) before it ever touches the filesystem — same
// defense-in-depth posture as zipExtract.ts's resolvesWithinRoot, applied
// here since this path segment comes straight from the URL rather than a
// zip entry.
export function resolveCachedPhotoPath(
  baseDir: string,
  tusUploadId: string,
  filename: string,
): string | null {
  if (
    filename.length === 0 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === ".." ||
    filename.includes("\0")
  ) {
    return null;
  }
  const destDir = path.resolve(cacheDirFor(baseDir, tusUploadId));
  const resolved = path.resolve(destDir, filename);
  if (resolved !== destDir && !resolved.startsWith(destDir + path.sep)) {
    return null;
  }
  return resolved;
}

export async function cleanupStaleCaches(
  baseDir: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return; // cache dir doesn't exist yet — nothing to clean up
  }

  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      const dirPath = path.join(baseDir, entry);
      try {
        const stats = await stat(dirPath);
        if (stats.isDirectory() && now - stats.mtimeMs > ttlMs) {
          await rm(dirPath, { recursive: true, force: true });
        }
      } catch {
        // Entry vanished between readdir and stat, or isn't a directory —
        // either way, nothing to clean up.
      }
    }),
  );
}

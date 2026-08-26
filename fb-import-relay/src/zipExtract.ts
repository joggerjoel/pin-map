// Selective, zip-slip-safe extraction. Only entries matching the target
// path allow-list are ever written to disk — everything else in a
// Facebook export (ads info, messages, security logs, etc.) is skipped
// without being extracted at all. Path containment is checked
// independently of the allow-list match (defense in depth against a
// crafted entry path escaping the extraction root, e.g. via `../`), per
// the red-team finding this closes.

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

const ALLOWED_EXACT_PATHS = new Set([
  "your_facebook_activity/posts/places_you_have_been_tagged_in.html",
  "your_facebook_activity/posts/your_photos.html",
]);

const ALLOWED_PATTERNS = [
  /^your_facebook_activity\/posts\/your_posts__check_ins__photos_and_videos_.*\.html$/,
  /^your_facebook_activity\/comments_and_reactions\/[^/]+\.html$/,
  /^your_facebook_activity\/posts\/media\/your_posts\//,
  // A post's own photo batch lives in its own "Photos_{album_id}/"
  // subdirectory rather than under "your_posts/" — verified against a real
  // export: the post HTML's <a href> for an attached photo points here,
  // not at the your_posts/ flat layout above (both exist side by side in
  // the same zip).
  /^your_facebook_activity\/posts\/media\/Photos_[^/]+\//,
];

export function isAllowedZipPath(entryPath: string): boolean {
  if (ALLOWED_EXACT_PATHS.has(entryPath)) return true;
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(entryPath));
}

export function resolvesWithinRoot(root: string, entryPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedEntry = path.resolve(resolvedRoot, entryPath);
  return (
    resolvedEntry === resolvedRoot ||
    resolvedEntry.startsWith(resolvedRoot + path.sep)
  );
}

export interface ExtractOptions {
  isAllowed?: (entryPath: string) => boolean;
}

export async function extractZip(
  zipPath: string,
  destDir: string,
  options: ExtractOptions = {},
): Promise<string[]> {
  const isAllowed = options.isAllowed ?? isAllowedZipPath;
  const extracted: string[] = [];

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) {
        reject(openErr ?? new Error("failed to open zip"));
        return;
      }

      zipfile.on("error", reject);
      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        const isDirectory = entry.fileName.endsWith("/");
        if (isDirectory || !isAllowed(entry.fileName)) {
          zipfile.readEntry();
          return;
        }

        if (!resolvesWithinRoot(destDir, entry.fileName)) {
          // Zip-slip attempt: matched the allow-list's regex shape but
          // resolves outside the extraction root (e.g. via `../..`).
          // Skip it — never write outside destDir, no exceptions.
          zipfile.readEntry();
          return;
        }

        const destPath = path.resolve(destDir, entry.fileName);
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zipfile.readEntry();
            return;
          }
          mkdir(path.dirname(destPath), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(destPath)))
            .then(() => {
              extracted.push(entry.fileName);
              zipfile.readEntry();
            })
            .catch(() => {
              zipfile.readEntry();
            });
        });
      });

      zipfile.on("end", () => resolve());
    });
  });

  return extracted;
}

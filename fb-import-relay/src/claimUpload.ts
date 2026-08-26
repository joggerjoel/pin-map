// Client-driven ownership binding for a tusd upload -- see
// facebook-import-multi-tenant.md item 2. The client calls this
// immediately after tusd assigns a tusUploadId (at upload-creation time,
// before any bytes are sent), so there's no dependency on tusd's hook
// payload forwarding anything.

import {
  link,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isValidTusUploadId } from "./tusUploadId";

export type ClaimError = "invalid_id" | "not_found" | "already_claimed";

export interface ClaimResult {
  ok: boolean;
  error?: ClaimError;
}

export function ownerFilePath(ownersDir: string, tusUploadId: string): string {
  return path.join(ownersDir, `${tusUploadId}.owner`);
}

export async function readOwner(
  ownersDir: string,
  tusUploadId: string,
): Promise<string | null> {
  try {
    const content = await readFile(
      ownerFilePath(ownersDir, tusUploadId),
      "utf-8",
    );
    return content.trim();
  } catch {
    return null;
  }
}

async function uploadExists(
  uploadDir: string,
  tusUploadId: string,
): Promise<boolean> {
  try {
    const stats = await stat(path.join(uploadDir, `${tusUploadId}.info`));
    return stats.isFile();
  } catch {
    return false;
  }
}

// Writes {ownersDir}/{tusUploadId}.owner atomically and create-only: the
// full content is written to a uniquely-named temp file first, then
// link()'d into place (fails with EEXIST if the destination already
// exists -- the actual create-only guarantee; a bare exclusive-create on
// the final path would only make *creating the directory entry* atomic,
// not the content, leaving a window where a concurrent reader could see
// an empty/partial file). A per-request-unique temp name is required --
// reusing one would let a concurrent request link() another's
// still-incomplete write.
export async function claimUpload(
  uploadDir: string,
  ownersDir: string,
  tusUploadId: string,
  userId: string,
): Promise<ClaimResult> {
  if (!isValidTusUploadId(tusUploadId)) {
    return { ok: false, error: "invalid_id" };
  }

  if (!(await uploadExists(uploadDir, tusUploadId))) {
    return { ok: false, error: "not_found" };
  }

  await mkdir(ownersDir, { recursive: true });
  const finalPath = ownerFilePath(ownersDir, tusUploadId);
  const tempPath = path.join(
    ownersDir,
    `${tusUploadId}.owner.tmp.${crypto.randomUUID()}`,
  );

  try {
    await writeFile(tempPath, userId, "utf-8");
    try {
      await link(tempPath, finalPath);
    } catch {
      // link() fails (EEXIST) if the destination already exists.
      const existing = await readOwner(ownersDir, tusUploadId);
      if (existing === userId) {
        return { ok: true }; // idempotent retry of the client's own claim
      }
      return { ok: false, error: "already_claimed" };
    }
  } finally {
    await unlink(tempPath).catch(() => {});
  }

  return { ok: true };
}

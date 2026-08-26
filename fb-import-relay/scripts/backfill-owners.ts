// One-time script: writes {UPLOAD_DIR}/_owners/{tusUploadId}.owner for
// every upload tusd already knows about (enumerated from its own *.info
// files, not derived zip/photo-cache artifacts, which miss anything
// uploaded-but-never-parsed) that doesn't already have a binding. Every
// pre-existing upload was created by the owner -- nothing else could have
// uploaded before /claim-upload existed -- so this assigns
// pinmap_owner's user_id to each.
//
// Idempotent: only fills genuinely missing .owner files, never touches an
// existing one. Safe to run repeatedly -- see
// facebook-import-multi-tenant.md's deploy sequence, which runs this
// twice (once after shipping the client's claim call, again immediately
// before enforcement goes live, inside a short upload-freeze window).
//
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... UPLOAD_DIR=/data \
//   bun run scripts/backfill-owners.ts

import { link, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchOwnerUserId } from "../src/ownerGate";
import { readOwner } from "../src/claimUpload";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const uploadDir = process.env.UPLOAD_DIR ?? "/data";
  const ownersDir = path.join(uploadDir, "_owners");

  const ownerUserId = await fetchOwnerUserId({ supabaseUrl, anonKey });
  if (!ownerUserId) {
    throw new Error("Could not resolve pinmap_owner's user_id -- aborting.");
  }
  console.log(`Backfilling as owner: ${ownerUserId}`);

  const entries = await readdir(uploadDir);
  const infoFiles = entries.filter((name) => name.endsWith(".info"));
  const tusUploadIds = infoFiles.map((name) => name.slice(0, -".info".length));
  console.log(`Found ${tusUploadIds.length} upload(s) recorded by tusd.`);

  await mkdir(ownersDir, { recursive: true });

  let written = 0;
  let alreadyPresent = 0;
  let mismatched = 0;

  for (const tusUploadId of tusUploadIds) {
    const existing = await readOwner(ownersDir, tusUploadId);
    if (existing !== null) {
      alreadyPresent++;
      if (existing !== ownerUserId) {
        // A real claim (post-/claim-upload) for a different user -- expected
        // once non-owners can upload; not a backfill target either way.
        mismatched++;
      }
      continue;
    }

    const finalPath = path.join(ownersDir, `${tusUploadId}.owner`);
    const tempPath = path.join(
      ownersDir,
      `${tusUploadId}.owner.tmp.${crypto.randomUUID()}`,
    );
    try {
      await writeFile(tempPath, ownerUserId, "utf-8");
      await link(tempPath, finalPath);
      written++;
    } catch (err) {
      // Lost a race against a concurrent write (e.g. a real claim landing
      // at the same moment) -- fine, something else already claimed it.
      console.warn(`skipped ${tusUploadId}: ${(err as Error).message}`);
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }

  console.log(
    `Done. ${written} written, ${alreadyPresent} already present (${mismatched} claimed by a non-owner).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

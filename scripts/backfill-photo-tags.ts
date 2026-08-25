// Batch-tags every untagged image row in pinmap_place_photos: perceptual
// hash, vision-model caption/tags, face detection, semantic embedding --
// see ai-tagging-plan.md for the full design. Safe to interrupt (Ctrl+C)
// and re-run at any point; picks up exactly where it left off via
// tag_status = 'pending'. Safe to re-run after a fully successful pass --
// resolves to a fast no-op, since nothing is left 'pending'.
//
//   bun run scripts/backfill-photo-tags.ts
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, releaseLock } from "./lib/fileLock";
import { applyTagResult, tagPhoto, DEFAULT_MAX_ATTEMPTS } from "./lib/tagPhoto";

const BUCKET = "pin-photos";
const BATCH_SIZE = 50;
const LOCK_PATH = join(tmpdir(), "pin-map-backfill-photo-tags.lock");

interface PendingRow {
  id: string;
  storage_path: string;
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing VITE_SUPABASE_URL or SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (!acquireLock(LOCK_PATH)) {
    console.error(
      `Another instance is already running (lock held at ${LOCK_PATH}). Exiting.`,
    );
    process.exit(1);
  }

  let stopRequested = false;
  const onSigint = () => {
    if (stopRequested) return; // second Ctrl+C: let the default handler kill it
    stopRequested = true;
    console.log(
      "\nStop requested -- finishing the current photo, then exiting cleanly.",
    );
  };
  process.on("SIGINT", onSigint);

  let completed = 0;
  let failed = 0;

  try {
    while (!stopRequested) {
      const { data: rows, error } = await supabase
        .from("pinmap_place_photos")
        .select("id, storage_path")
        .eq("tag_status", "pending")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        console.error(`Failed to select pending rows: ${error.message}`);
        break;
      }
      const batch = (rows ?? []) as PendingRow[];
      if (batch.length === 0) break;

      for (const row of batch) {
        if (stopRequested) break;

        const { data: blob, error: downloadError } = await supabase.storage
          .from(BUCKET)
          .download(row.storage_path);

        const result =
          downloadError || !blob
            ? {
                ok: false as const,
                error: `download failed: ${downloadError?.message ?? "no data"}`,
              }
            : await tagPhoto(Buffer.from(await blob.arrayBuffer()));

        const outcome = await applyTagResult(
          supabase,
          row.id,
          result,
          DEFAULT_MAX_ATTEMPTS,
        );
        if (outcome === "completed") completed++;
        else failed++;

        console.log(
          `${completed + failed} processed (${completed} complete, ${failed} failed)`,
        );
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    releaseLock(LOCK_PATH);
  }

  console.log(
    `Done. ${completed} complete, ${failed} failed this run.` +
      (stopRequested ? " (stopped early by request)" : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Batch-tags every untagged image row in pinmap_place_photos: perceptual
// hash, vision-model caption/tags, face detection, semantic embedding --
// see ai-tagging-plan.md for the full design. Safe to interrupt (Ctrl+C)
// and re-run at any point; picks up exactly where it left off via
// tag_status = 'pending'. Safe to re-run after a fully successful pass --
// resolves to a fast no-op, since nothing is left 'pending'.
//
//   bun run scripts/backfill-photo-tags.ts
//
// Multiple machines against the same DB: fileLock.ts only stops a second
// instance on the *same* machine -- it does nothing across machines, so
// running this unsharded from two boxes at once means both race the same
// pending rows (wasted, not corrupting -- the write path is guarded by a
// conditional WHERE, confirmed by reading applyTagResult). To split the
// pending queue across N machines with no overlap, pass --index/--of on
// each one (0-indexed, all must agree on the same total):
//
//   bun run scripts/backfill-photo-tags.ts --index=0 --of=3
//   bun run scripts/backfill-photo-tags.ts --index=1 --of=3
//   bun run scripts/backfill-photo-tags.ts --index=2 --of=3
//
// This only removes the *duplicate-work* problem -- every shard still
// calls the same shared Ollama instance, so it doesn't fix contention/
// timeouts there if too many shards run their vision-model calls at once.
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

interface Shard {
  index: number;
  of: number;
}

export function parseShardArgs(argv: string[]): Shard | null {
  const indexArg = argv.find((a) => a.startsWith("--index="));
  const ofArg = argv.find((a) => a.startsWith("--of="));
  if (!indexArg && !ofArg) return null;
  if (!indexArg || !ofArg) {
    throw new Error("--index and --of must be passed together");
  }
  const index = Number(indexArg.slice("--index=".length));
  const of = Number(ofArg.slice("--of=".length));
  if (!Number.isInteger(of) || of < 1) {
    throw new Error(`--of must be a positive integer, got "${ofArg}"`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= of) {
    throw new Error(
      `--index must satisfy 0 <= index < ${of}, got "${indexArg}"`,
    );
  }
  return { index, of };
}

// Deterministic, no DB schema change needed: a UUID's first 8 hex chars are
// already uniformly random, so hashing on them spreads rows evenly across
// shards without needing every shard to agree on anything but `of`.
export function isInShard(id: string, shard: Shard): boolean {
  const n = parseInt(id.replace(/-/g, "").slice(0, 8), 16);
  return n % shard.of === shard.index;
}

async function main() {
  const shard = parseShardArgs(process.argv.slice(2));
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing VITE_SUPABASE_URL or SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (shard) {
    console.error(
      `[${new Date().toISOString()}] Running shard ${shard.index}/${shard.of}.`,
    );
  }

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

  // When sharded, fetch a wider window before filtering client-side --
  // otherwise a shard whose slice is a small fraction of the oldest-N
  // pending rows would keep re-fetching the same BATCH_SIZE rows (mostly
  // not its own) until other shards clear them out. This doesn't remove
  // that possibility (all shards still race the same oldest-first window),
  // just makes each fetch far more likely to contain a full batch's worth
  // of this shard's own rows.
  const fetchLimit = shard ? BATCH_SIZE * shard.of : BATCH_SIZE;

  try {
    while (!stopRequested) {
      const { data: rows, error } = await supabase
        .from("pinmap_place_photos")
        .select("id, storage_path")
        .eq("tag_status", "pending")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(fetchLimit);

      if (error) {
        console.error(`Failed to select pending rows: ${error.message}`);
        break;
      }
      const fetched = (rows ?? []) as PendingRow[];
      if (fetched.length === 0) break;
      const batch = shard
        ? fetched.filter((row) => isInShard(row.id, shard))
        : fetched;
      // Fetched rows exist but none are this shard's -- don't spin hot on
      // an empty slice; give other shards time to clear the window first.
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

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

        // console.error, not console.log: stdout block-buffers when piped to
        // a file (e.g. `nohup ... > file`), so progress silently stops
        // appearing until the buffer fills -- stderr doesn't, so this shows
        // up live. Includes a timestamp + row id since "which photo, when"
        // is exactly what you need to debug a failure after the fact.
        console.error(
          `[${new Date().toISOString()}] ${row.id} (${row.storage_path}): ${outcome}` +
            (result.ok ? "" : ` -- ${result.error}`) +
            ` -- ${completed + failed} processed (${completed} complete, ${failed} failed)`,
        );
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    releaseLock(LOCK_PATH);
  }

  console.error(
    `[${new Date().toISOString()}] Done. ${completed} complete, ${failed} failed this run.` +
      (stopRequested ? " (stopped early by request)" : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

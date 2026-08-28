// Batch-tags every untagged image row in pinmap_place_photos: perceptual
// hash, vision-model caption/tags, face detection, semantic embedding --
// see ai-tagging-plan.md for the full design. Safe to interrupt (Ctrl+C)
// and re-run at any point; picks up exactly where it left off via
// tag_status = 'pending'. Safe to re-run after a fully successful pass --
// resolves to a fast no-op, since nothing is left 'pending'.
//
//   bun run scripts/backfill-photo-tags.ts
//   bun run scripts/backfill-photo-tags.ts --limit=10   # stop after 10 rows
//
// Multiple machines against the same DB: fileLock.ts only stops a second
// instance on the *same* machine -- it does nothing across machines, so
// running this unsharded from two boxes at once means both race the same
// pending rows (wasted, not corrupting -- the write path is guarded by a
// conditional WHERE, confirmed by reading applyTagResult). To split the
// pending queue with no overlap, pass --index on each machine (0-indexed);
// the total shard count is the hardcoded SHARD_OF constant below, not a
// flag -- both machines run the same checked-out source, so the total can
// never drift the way a copied --of value or .env entry could:
//
//   bun run scripts/backfill-photo-tags.ts --index=0   # e.g. aorus (GPU)
//   bun run scripts/backfill-photo-tags.ts --index=1   # e.g. macstudio
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
const STORAGE_DOWNLOAD_TIMEOUT_MS = 60_000;

// Bump in lockstep with the --index range above if a third machine is ever
// added -- see the header comment for why this is a source constant, not a
// flag or .env value.
const SHARD_OF = 2;

interface PendingRow {
  id: string;
  storage_path: string;
}

interface Shard {
  index: number;
  of: number;
}

interface RunArgs {
  shard: Shard | null;
  limit: number | null;
}

export function parseRunArgs(argv: string[]): RunArgs {
  const indexArg = argv.find((a) => a.startsWith("--index="));
  const limitArg = argv.find((a) => a.startsWith("--limit="));

  let shard: Shard | null = null;
  if (indexArg) {
    const index = Number(indexArg.slice("--index=".length));
    if (!Number.isInteger(index) || index < 0 || index >= SHARD_OF) {
      throw new Error(
        `--index must satisfy 0 <= index < ${SHARD_OF}, got "${indexArg}"`,
      );
    }
    shard = { index, of: SHARD_OF };
  }

  let limit: number | null = null;
  if (limitArg) {
    limit = Number(limitArg.slice("--limit=".length));
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer, got "${limitArg}"`);
    }
  }

  return { shard, limit };
}

// Deterministic, no DB schema change needed: a UUID's first 8 hex chars are
// already uniformly random, so hashing on them spreads rows evenly across
// shards.
export function isInShard(id: string, shard: Shard): boolean {
  const n = parseInt(id.replace(/-/g, "").slice(0, 8), 16);
  return n % shard.of === shard.index;
}

function lockPathFor(shard: Shard | null): string {
  const suffix = shard ? `-shard${shard.index}` : "";
  return join(tmpdir(), `pin-map-backfill-photo-tags${suffix}.lock`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}

async function main() {
  const { shard, limit } = parseRunArgs(process.argv.slice(2));
  const lockPath = lockPathFor(shard);
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
  if (limit !== null) {
    console.error(
      `[${new Date().toISOString()}] Limiting this run to ${limit} rows.`,
    );
  }

  if (!acquireLock(lockPath)) {
    console.error(
      `Another instance is already running (lock held at ${lockPath}). Exiting.`,
    );
    process.exit(1);
  }

  let stopRequested = false;
  const onSigint = () => {
    if (stopRequested) {
      // Second Ctrl+C: the operator wants out now, not after the current
      // photo finishes -- exit immediately rather than silently no-op'ing
      // (registering a SIGINT listener suppresses Node's default
      // terminate-on-signal behavior for every subsequent signal, not just
      // the first, so this has to be explicit).
      console.log("\nSecond interrupt -- exiting immediately.");
      process.exit(130);
    }
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
    while (!stopRequested && (limit === null || completed + failed < limit)) {
      const {
        data: rows,
        error,
        count,
      } = await supabase
        .from("pinmap_place_photos")
        .select("id, storage_path", { count: "exact" })
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
      // Total pending across ALL shards, not just this one's slice -- a
      // sharded run's own "done" condition (batch.length === 0 after
      // fetching this window) says nothing about whether every shard is
      // actually converging on zero. Surfacing this every round makes a
      // gap (e.g. a machine accidentally running against a different
      // SHARD_OF) visible immediately instead of silently unnoticed.
      if (shard) {
        console.error(
          `[${new Date().toISOString()}] ${count ?? "?"} pending total (all shards).`,
        );
      }
      // Fetched rows exist but none are this shard's -- don't spin hot on
      // an empty slice; give other shards time to clear the window first.
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      for (const row of batch) {
        if (stopRequested) break;
        if (limit !== null && completed + failed >= limit) break;

        const { data: blob, error: downloadError } = await withTimeout(
          supabase.storage.from(BUCKET).download(row.storage_path),
          STORAGE_DOWNLOAD_TIMEOUT_MS,
          () =>
            new Error(
              `download timed out after ${STORAGE_DOWNLOAD_TIMEOUT_MS}ms`,
            ),
        ).catch((err) => ({
          data: null,
          error: err instanceof Error ? err : new Error(String(err)),
        }));

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
    releaseLock(lockPath);
  }

  console.error(
    `[${new Date().toISOString()}] Done. ${completed} complete, ${failed} failed this run.` +
      (stopRequested ? " (stopped early by request)" : "") +
      (limit !== null && completed + failed >= limit ? " (hit --limit)" : ""),
  );
}

// Guarded so scripts/backfill-photo-tags.test.ts can import parseRunArgs/
// isInShard without triggering a real run (which would exit the test
// process the moment it hit the missing-env-vars check).
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Single-instance guard for scripts/backfill-photo-tags.ts.
//
// The plan originally called for a Postgres advisory lock, but this
// script talks to the database only through PostgREST/supabase-js, which
// pools connections across separate HTTP requests -- a pg_try_advisory_lock
// acquired via one RPC call has no guarantee of surviving to the next
// request on the same underlying session, since PostgREST doesn't give a
// REST client a single persistent connection to hold a session-scoped lock
// on. A local file lock is the correct fit for what this actually is: a
// single-machine, single-operator, manually-run tool -- not a
// distributed-coordination problem.
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempts to atomically create the lock file (fails if it already exists).
 * If a stale lock is found (the PID inside is no longer running -- e.g. a
 * crashed prior run), it's reclaimed automatically rather than blocking
 * forever. Returns false only when another process is genuinely still
 * holding the lock.
 */
export function acquireLock(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existingPid = Number(readFileSync(lockPath, "utf-8").trim());
    if (isProcessAlive(existingPid)) return false;
    unlinkSync(lockPath);
    return acquireLock(lockPath);
  }
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone -- nothing to release
  }
}

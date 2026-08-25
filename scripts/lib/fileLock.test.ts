import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, releaseLock } from "./fileLock";

let dir: string;
function lockPath(): string {
  dir = mkdtempSync(join(tmpdir(), "filelock-test-"));
  return join(dir, "test.lock");
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("acquireLock / releaseLock", () => {
  it("acquires the lock when no lock file exists", () => {
    const path = lockPath();
    expect(acquireLock(path)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("writes this process's own pid into the lock file", () => {
    const path = lockPath();
    acquireLock(path);
    expect(readFileSync(path, "utf-8").trim()).toBe(String(process.pid));
  });

  it("fails to acquire while a live process holds the lock", () => {
    const path = lockPath();
    // process.pid is always alive in this test process -- simulates a
    // real second instance colliding with a genuinely running first one.
    writeFileSync(path, String(process.pid));
    expect(acquireLock(path)).toBe(false);
  });

  it("reclaims a stale lock left by a dead process", () => {
    const path = lockPath();
    // A pid essentially guaranteed not to be a running process.
    writeFileSync(path, "999999");
    expect(acquireLock(path)).toBe(true);
    expect(readFileSync(path, "utf-8").trim()).toBe(String(process.pid));
  });

  it("releaseLock removes the file so a later acquire succeeds", () => {
    const path = lockPath();
    acquireLock(path);
    releaseLock(path);
    expect(existsSync(path)).toBe(false);
    expect(acquireLock(path)).toBe(true);
  });

  it("releaseLock is a no-op, not an error, when there's nothing to release", () => {
    const path = lockPath();
    expect(() => releaseLock(path)).not.toThrow();
  });
});

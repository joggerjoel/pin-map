import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimUpload, ownerFilePath, readOwner } from "./claimUpload";

const REAL_ID = "6978e95d42c08815618d3bd8a9688e19";
const OTHER_ID = "d364a396498101f11c3869dea8d1f148";

let root: string;
let uploadDir: string;
let ownersDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "claim-test-"));
  uploadDir = path.join(root, "uploads");
  ownersDir = path.join(root, "owners");
  await mkdir(uploadDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedUpload(id: string) {
  await writeFile(path.join(uploadDir, `${id}.info`), "{}");
}

describe("claimUpload", () => {
  test("rejects a malformed tusUploadId before touching the filesystem", async () => {
    const result = await claimUpload(
      uploadDir,
      ownersDir,
      "../escape",
      "user-a",
    );
    expect(result).toEqual({ ok: false, error: "invalid_id" });
  });

  test("rejects an id with no corresponding .info file", async () => {
    const result = await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  test("claims a real, unclaimed upload", async () => {
    await seedUpload(REAL_ID);
    const result = await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    expect(result).toEqual({ ok: true });
    expect(await readOwner(ownersDir, REAL_ID)).toBe("user-a");
  });

  test("a second claim by the same user is idempotent", async () => {
    await seedUpload(REAL_ID);
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    const second = await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    expect(second).toEqual({ ok: true });
  });

  test("a claim by a different user for an already-claimed id is rejected", async () => {
    await seedUpload(REAL_ID);
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    const hijack = await claimUpload(uploadDir, ownersDir, REAL_ID, "user-b");
    expect(hijack).toEqual({ ok: false, error: "already_claimed" });
    // The original claim is untouched.
    expect(await readOwner(ownersDir, REAL_ID)).toBe("user-a");
  });

  test("claiming one id doesn't affect another", async () => {
    await seedUpload(REAL_ID);
    await seedUpload(OTHER_ID);
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    const result = await claimUpload(uploadDir, ownersDir, OTHER_ID, "user-b");
    expect(result).toEqual({ ok: true });
  });

  test("no temp files are left behind after a successful claim", async () => {
    await seedUpload(REAL_ID);
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(ownersDir);
    expect(entries).toEqual([`${REAL_ID}.owner`]);
  });

  test("no temp files are left behind after a rejected (hijack) claim", async () => {
    await seedUpload(REAL_ID);
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-a");
    await claimUpload(uploadDir, ownersDir, REAL_ID, "user-b");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(ownersDir);
    expect(entries).toEqual([`${REAL_ID}.owner`]);
  });
});

describe("readOwner", () => {
  test("returns null when no .owner file exists", async () => {
    expect(await readOwner(ownersDir, REAL_ID)).toBeNull();
  });
});

describe("ownerFilePath", () => {
  test("builds the expected path", () => {
    expect(ownerFilePath("/data/_owners", REAL_ID)).toBe(
      `/data/_owners/${REAL_ID}.owner`,
    );
  });
});

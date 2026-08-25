import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { extractZip, isAllowedZipPath, resolvesWithinRoot } from "./zipExtract";

const execFileAsync = promisify(execFile);

describe("isAllowedZipPath", () => {
  test("allows the known exact target files", () => {
    expect(
      isAllowedZipPath(
        "your_facebook_activity/posts/places_you_have_been_tagged_in.html",
      ),
    ).toBe(true);
    expect(
      isAllowedZipPath("your_facebook_activity/posts/your_photos.html"),
    ).toBe(true);
  });

  test("allows the your_posts__check_ins pattern with any numeric suffix", () => {
    expect(
      isAllowedZipPath(
        "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.html",
      ),
    ).toBe(true);
  });

  test("allows comments_and_reactions files directly inside the folder", () => {
    expect(
      isAllowedZipPath(
        "your_facebook_activity/comments_and_reactions/likes_and_reactions.html",
      ),
    ).toBe(true);
  });

  test("allows anything under media/your_posts/", () => {
    expect(
      isAllowedZipPath("your_facebook_activity/posts/media/your_posts/123.jpg"),
    ).toBe(true);
  });

  test("rejects everything else in the export", () => {
    expect(isAllowedZipPath("ads_information/ad_preferences.html")).toBe(false);
    expect(
      isAllowedZipPath("your_facebook_activity/messages/inbox/secret.html"),
    ).toBe(false);
    expect(
      isAllowedZipPath("personal_information/profile_information.html"),
    ).toBe(false);
  });
});

describe("resolvesWithinRoot", () => {
  const root = "/data/uploads/abc123";

  test("allows a plain nested relative path", () => {
    expect(
      resolvesWithinRoot(root, "your_facebook_activity/posts/x.html"),
    ).toBe(true);
  });

  test("rejects a path that escapes the root via ../", () => {
    // 4 directory levels deep (your_facebook_activity/posts/media/your_posts),
    // so 4 "../" only cancels back to root itself (still safe) — a 5th is
    // what actually escapes past root into its parent.
    expect(
      resolvesWithinRoot(
        root,
        "your_facebook_activity/posts/media/your_posts/../../../../../etc/cron.d/evil",
      ),
    ).toBe(false);
  });

  test("still resolves within root when ../ exactly cancels back to it", () => {
    expect(
      resolvesWithinRoot(
        root,
        "your_facebook_activity/posts/media/your_posts/../../../../etc/cron.d/evil",
      ),
    ).toBe(true);
  });

  test("rejects an absolute path entry", () => {
    expect(resolvesWithinRoot(root, "/etc/passwd")).toBe(false);
  });

  test("rejects a sibling-directory escape that merely shares a prefix", () => {
    // /data/uploads/abc123-evil is NOT inside /data/uploads/abc123, even
    // though the string starts with the same characters — this is why the
    // check appends path.sep rather than doing a plain startsWith.
    expect(resolvesWithinRoot(root, "../abc123-evil/x")).toBe(false);
  });
});

describe("extractZip (integration, real zip file via the `zip` CLI)", () => {
  let workDir: string;
  let zipPath: string;
  let destDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "fb-import-relay-ziptest-"));
    const srcDir = path.join(workDir, "src");
    destDir = path.join(workDir, "dest");
    await mkdir(destDir, { recursive: true });

    // Build a small tree mirroring a real export's shape: one allowed
    // exact file, one allowed-pattern file, one disallowed file, and a
    // directory entry (which real zips include and must be skipped, not
    // treated as a 0-byte file).
    await mkdir(path.join(srcDir, "your_facebook_activity/posts"), {
      recursive: true,
    });
    await mkdir(
      path.join(srcDir, "your_facebook_activity/posts/media/your_posts"),
      { recursive: true },
    );
    await mkdir(path.join(srcDir, "your_facebook_activity/messages/inbox"), {
      recursive: true,
    });

    await writeFile(
      path.join(
        srcDir,
        "your_facebook_activity/posts/places_you_have_been_tagged_in.html",
      ),
      "<html>allowed exact</html>",
    );
    await writeFile(
      path.join(
        srcDir,
        "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.html",
      ),
      "<html>allowed pattern</html>",
    );
    await writeFile(
      path.join(
        srcDir,
        "your_facebook_activity/posts/media/your_posts/photo.jpg",
      ),
      "fake-jpg-bytes",
    );
    await writeFile(
      path.join(srcDir, "your_facebook_activity/messages/inbox/secret.html"),
      "<html>should never be extracted</html>",
    );

    zipPath = path.join(workDir, "export.zip");
    await execFileAsync("zip", ["-r", zipPath, "."], { cwd: srcDir });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("extracts only allow-listed files, skipping everything else", async () => {
    const extracted = await extractZip(zipPath, destDir);
    expect(extracted.sort()).toEqual(
      [
        "your_facebook_activity/posts/places_you_have_been_tagged_in.html",
        "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.html",
        "your_facebook_activity/posts/media/your_posts/photo.jpg",
      ].sort(),
    );
  });

  test("extracted file contents match the originals", async () => {
    await extractZip(zipPath, destDir);
    const content = await readFile(
      path.join(
        destDir,
        "your_facebook_activity/posts/places_you_have_been_tagged_in.html",
      ),
      "utf-8",
    );
    expect(content).toBe("<html>allowed exact</html>");
  });

  test("never writes the disallowed file to disk", async () => {
    await extractZip(zipPath, destDir);
    const disallowedPath = path.join(
      destDir,
      "your_facebook_activity/messages/inbox/secret.html",
    );
    await expect(readFile(disallowedPath, "utf-8")).rejects.toThrow();
  });
});

// One-off script: bulk-import photos/videos recovered via the mitm-proxy
// Facebook capture into pinmap_place_photos as "unsorted" (place_query =
// null). Facebook strips EXIF/location from the files themselves, so there's
// no place to associate them with yet -- that happens later via manual
// triage in the app. Uses the service-role key (bypasses RLS), same as
// seed-owner-places.ts.
//
// Also tags each newly-inserted image row immediately via tagPhoto.ts, as
// a latency optimization for this specific import path -- not the sole
// coverage mechanism for tagging. See ai-tagging-plan.md "Future-insert
// coverage": this script can't be the only way tagged rows get created,
// since the app's own uploadPhoto() (photosRepository.ts) inserts rows
// too, from the visitor's browser, with no access to a local Ollama
// instance. Periodic re-runs of backfill-photo-tags.ts are what actually
// give that second path coverage; a tagging failure here never blocks or
// rolls back the photo import itself -- the row is left tag_status =
// 'pending' either way, and backfill-photo-tags.ts picks it up later.
import { createClient } from "@supabase/supabase-js";
import { applyTagResult, tagPhoto } from "./lib/tagPhoto";

const OWNER_USER_ID = "eb4c96e4-849a-45f4-a0de-1a7df130df31";
const ARTIFACTS_DIR =
  process.env.MITM_ARTIFACTS_DIR ??
  `${process.env.HOME}/Developer/mitm-proxy/artifacts`;
const BUCKET = "pin-photos";

interface CaptureRecord {
  filename: string;
  content_type: string;
  sha256: string;
  subdir: "images" | "videos";
}

async function readIndex(
  name: string,
  subdir: CaptureRecord["subdir"],
): Promise<CaptureRecord[]> {
  const path = `${ARTIFACTS_DIR}/${name}`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }
  const text = await file.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ ...JSON.parse(line), subdir }) as CaptureRecord);
}

function extFor(record: CaptureRecord): string {
  const fromFilename = record.filename.split(".").pop();
  return fromFilename && fromFilename.length <= 4 ? fromFilename : "bin";
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing VITE_SUPABASE_URL or SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const [images, videos] = await Promise.all([
    readIndex("images.jsonl", "images"),
    readIndex("videos.jsonl", "videos"),
  ]);
  const records = [...images, ...videos];
  console.log(
    `${records.length} captured files (${images.length} images, ${videos.length} videos)`,
  );

  const { data: existingRows, error: existingError } = await supabase
    .from("pinmap_place_photos")
    .select("storage_path")
    .eq("user_id", OWNER_USER_ID);
  if (existingError) {
    throw new Error(`Failed to read existing rows: ${existingError.message}`);
  }
  const alreadyImported = new Set(
    (existingRows as { storage_path: string }[]).map((r) => r.storage_path),
  );

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    const ext = extFor(record);
    const storagePath = `${OWNER_USER_ID}/${record.sha256}.${ext}`;
    if (alreadyImported.has(storagePath)) {
      skipped++;
      continue;
    }

    const localPath = `${ARTIFACTS_DIR}/${record.subdir}/${record.filename}`;
    const bytes = await Bun.file(localPath).arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: record.content_type,
        upsert: true,
      });
    if (uploadError) {
      console.error(
        `upload failed for ${record.filename}: ${uploadError.message}`,
      );
      failed++;
      continue;
    }

    const mediaType = record.subdir === "videos" ? "video" : "image";
    const { data: inserted, error: insertError } = await supabase
      .from("pinmap_place_photos")
      .insert({
        user_id: OWNER_USER_ID,
        place_query: null,
        storage_path: storagePath,
        media_type: mediaType,
        // Videos are never sent to the vision model (see ai-tagging-plan.md
        // "Videos are out of scope for v1") -- skip them at insert time
        // rather than leaving them 'pending' for a backfill run that would
        // just fail on them.
        tag_status: mediaType === "video" ? "skipped" : "pending",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error(
        `insert failed for ${record.filename}: ${insertError?.message}`,
      );
      failed++;
      continue;
    }

    uploaded++;

    if (mediaType === "image") {
      const result = await tagPhoto(Buffer.from(bytes));
      await applyTagResult(supabase, (inserted as { id: string }).id, result);
    }
  }

  console.log(
    `Done. ${uploaded} uploaded, ${skipped} already present, ${failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-off script: bulk-import photos/videos recovered via the mitm-proxy
// Facebook capture into pinmap_place_photos as "unsorted" (place_query =
// null). Facebook strips EXIF/location from the files themselves, so there's
// no place to associate them with yet -- that happens later via manual
// triage in the app. Uses the service-role key (bypasses RLS), same as
// seed-owner-places.ts.
import { createClient } from "@supabase/supabase-js";

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

    const { error: insertError } = await supabase
      .from("pinmap_place_photos")
      .insert({
        user_id: OWNER_USER_ID,
        place_query: null,
        storage_path: storagePath,
      });
    if (insertError) {
      console.error(
        `insert failed for ${record.filename}: ${insertError.message}`,
      );
      failed++;
      continue;
    }

    uploaded++;
  }

  console.log(
    `Done. ${uploaded} uploaded, ${skipped} already present, ${failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

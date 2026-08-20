// One-off script: seed pinmap_class_roster from the generated portrait
// manifest. Run with the Supabase service-role key set in the environment
// (bypasses RLS, since this runs outside a signed-in browser session).
import { createClient } from "@supabase/supabase-js";

interface PortraitRecord {
  id: number;
  filename: string;
  imageUrl: string;
  highSchoolName: string;
  currentName: string;
}

const CLASS_SLUG = "belding1989";
const HOMETOWN = "Belding, Michigan";
const MANIFEST_PATH =
  "/Users/joggerjoel/Documents/Codex/2026-08-20/cu/outputs/class1989-portrait-urls.json";

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing VITE_SUPABASE_URL or SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const manifest: PortraitRecord[] = JSON.parse(
    await Bun.file(MANIFEST_PATH).text(),
  );
  console.log(`Loaded ${manifest.length} portraits from manifest`);

  const rows = manifest.map((portrait) => ({
    class_slug: CLASS_SLUG,
    id: portrait.id,
    filename: portrait.filename,
    image_url: portrait.imageUrl,
    high_school_name: portrait.highSchoolName,
    current_name: portrait.currentName,
    hometown: HOMETOWN,
    current_location: "",
  }));

  const { error } = await supabase
    .from("pinmap_class_roster")
    .upsert(rows, { onConflict: "class_slug,id" });

  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }
  console.log(`Seeded ${rows.length} roster rows for class_slug=${CLASS_SLUG}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

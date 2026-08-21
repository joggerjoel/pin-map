// One-off script: geocode the "living" values that were already saved on
// pinmap_class_roster before the avatar-pin feature existed. New saves
// through ClassRosterEditor geocode on change; this backfills the rows
// that predate that logic and would otherwise never get coordinates
// (re-saving with the same text doesn't trigger a re-geocode).
import { createClient } from "@supabase/supabase-js";
import { geocodeLine } from "../src/lib/geocoder";

const CLASS_SLUG = "belding1989";
const COUNTRY_BIAS = "us";

async function main() {
  const mapboxToken = process.env.VITE_MAPBOX_TOKEN;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!mapboxToken || !supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing VITE_MAPBOX_TOKEN, VITE_SUPABASE_URL, or SERVICE_ROLE_KEY in .env",
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase
    .from("pinmap_class_roster")
    .select("id, living")
    .eq("class_slug", CLASS_SLUG)
    .neq("living", "")
    .is("living_lat", null);
  if (error) throw error;

  console.log(`${data.length} roster rows need geocoding`);

  for (const row of data) {
    const geocoded = await geocodeLine(row.living, mapboxToken, COUNTRY_BIAS);
    if (geocoded === null) {
      console.log(`FAILED to geocode: id=${row.id} living="${row.living}"`);
      continue;
    }
    const { error: updateError } = await supabase
      .from("pinmap_class_roster")
      .update({ living_lat: geocoded.lat, living_lng: geocoded.lng })
      .eq("class_slug", CLASS_SLUG)
      .eq("id", row.id);
    if (updateError) {
      console.log(`FAILED to update: id=${row.id}`, updateError);
      continue;
    }
    console.log(
      `OK: id=${row.id} "${row.living}" -> ${geocoded.lat}, ${geocoded.lng}`,
    );
  }
}

main();

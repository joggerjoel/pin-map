// One-off script: import the owner's location list into pinmap_pinned_places.
// Reuses the exact same line-parsing pipeline as useGeocoder's processLine,
// then geocodes and upserts via the service-role key (bypasses RLS since
// this runs outside a signed-in browser session).
import { createClient } from "@supabase/supabase-js";
import { geocodeBatch } from "../src/lib/geocoder";
import type { GeocodeQuery } from "../src/lib/geocoder";
import {
  looksLikeChecklistRow,
  parseChecklistLine,
} from "../src/lib/checklist";
import type { PlaceCategory } from "../src/lib/checklist";
import { detectCountryFromLine } from "../src/lib/countryNames";
import type { PlaceIcon } from "../src/lib/placeTags";
import { extractDatePrefix } from "../src/lib/datePrefix";
import { resolvePlainLineName } from "../src/lib/plainLineName";
import { parseLines } from "../src/lib/geocoder";

const OWNER_USER_ID = "eb4c96e4-849a-45f4-a0de-1a7df130df31";
const RAW_LIST_PATH =
  "/private/tmp/claude-501/-Users-joggerjoel-Developer-Git-ai-dotfiles--claude-worktrees-cloudflare-email-alias-0f6977/3ccf4b3a-c0b4-42e7-b479-ccf93ddf6aba/scratchpad/owner-places-raw.txt";

interface ProcessedLine {
  query: string;
  category?: PlaceCategory;
  icon?: PlaceIcon;
  country?: string;
  explicitCoords?: { lat: number; lng: number };
  date?: string;
}

// Mirrors processLine in src/hooks/useGeocoder.ts exactly (that function is
// unexported, so it's reproduced here rather than imported).
function processLine(line: string): ProcessedLine | null {
  const dateMatch = extractDatePrefix(line);
  const workingLine = dateMatch ? dateMatch.rest : line;
  const date = dateMatch?.date;

  if (looksLikeChecklistRow(workingLine)) {
    const parsed = parseChecklistLine(workingLine);
    if (parsed === null) {
      return null;
    }
    return {
      query: parsed.name,
      category: parsed.category,
      country: "us",
      date,
    };
  }
  const plain = resolvePlainLineName(workingLine);
  if (plain.explicitCoords !== undefined) {
    return {
      query: plain.name,
      icon: plain.icon,
      explicitCoords: plain.explicitCoords,
      date,
    };
  }
  return {
    query: plain.name,
    icon: plain.icon,
    country: detectCountryFromLine(plain.name),
    date,
  };
}

function hasExplicitCoords(
  p: ProcessedLine,
): p is ProcessedLine & { explicitCoords: { lat: number; lng: number } } {
  return p.explicitCoords !== undefined;
}

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

  const raw = await Bun.file(RAW_LIST_PATH).text();
  const lines = parseLines(raw);
  const processed = lines
    .map(processLine)
    .filter((p): p is ProcessedLine => p !== null);

  const explicit = processed.filter(hasExplicitCoords);
  const toGeocode = processed.filter((p) => !hasExplicitCoords(p));

  console.log(
    `${lines.length} lines -> ${explicit.length} explicit-coord, ${toGeocode.length} to geocode`,
  );

  const entries: GeocodeQuery[] = toGeocode.map((p) => ({
    query: p.query,
    country: p.country,
  }));
  const batch = await geocodeBatch(entries, mapboxToken);

  console.log(
    `Geocoded: ${batch.pinned.length} succeeded, ${batch.failed.length} failed`,
  );
  if (batch.failed.length > 0) {
    console.log("Failed lines:", batch.failed);
  }

  const geocodedRows = batch.pinned.map((place) => {
    const p = toGeocode.find(
      (c) => c.query.toLowerCase() === place.query.toLowerCase(),
    );
    return {
      user_id: OWNER_USER_ID,
      query: place.query,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      category: p?.category ?? null,
      icon: p?.icon ?? null,
      custom_tag_id: null,
      date: p?.date ?? null,
    };
  });

  const explicitRows = explicit.map((p) => ({
    user_id: OWNER_USER_ID,
    query: p.query,
    name: p.query,
    lat: p.explicitCoords.lat,
    lng: p.explicitCoords.lng,
    category: p.category ?? null,
    icon: p.icon ?? null,
    custom_tag_id: null,
    date: p.date ?? null,
  }));

  const rows = [...explicitRows, ...geocodedRows];
  console.log(`Upserting ${rows.length} rows for owner ${OWNER_USER_ID}`);

  const { error } = await supabase
    .from("pinmap_pinned_places")
    .upsert(rows, { onConflict: "user_id,query" });

  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

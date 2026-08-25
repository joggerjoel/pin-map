import type { PinnedPlace } from "../hooks/useGeocoder";
import { CONTINENTS } from "./continents";
import { classifyPlace } from "./legendClassification";
import type { BuiltinTagKey, IconShape, TagAppearance } from "./tagAppearance";

export interface GeoTreeNode {
  label: string;
  children: Map<string, GeoTreeNode>;
  places: PinnedPlace[];
}

function pointInBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
): boolean {
  const [west, south, east, north] = bbox;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

function continentLabelForPlace(place: PinnedPlace): string {
  const match = CONTINENTS.find((continent) =>
    pointInBbox(place.lat, place.lng, continent.bbox),
  );
  return match?.label ?? "Other";
}

function createNode(label: string): GeoTreeNode {
  return { label, children: new Map(), places: [] };
}

// A trailing US zip (or zip+4) sometimes rides along in the same
// comma-delimited segment as a state name in Mapbox's place_name — e.g.
// "Vermont 05149" instead of a clean "Vermont" — which otherwise splits
// what should be one state bucket into two ("Vermont" and "Vermont
// 05149"). Stripped so both collapse into the same node.
const TRAILING_ZIP_RE = /\s+\d{5}(-\d{4})?$/;

function cleanSegment(segment: string): string {
  return segment.replace(TRAILING_ZIP_RE, "").trim();
}

/** A single place's continent → country → [state] → city chain, broadest
 * first — the same walk `buildGeoTree` inserts into the tree, extracted so
 * a caller can locate one specific place in the hierarchy (e.g. to sync
 * the browse tray to whatever pin the legend just flew to) without
 * rebuilding or re-walking the whole tree. */
export function getPlaceChain(place: PinnedPlace): string[] {
  const continentLabel = continentLabelForPlace(place);
  const nameSegments = place.name
    .split(",")
    .map((segment) => cleanSegment(segment))
    .filter((segment) => segment.length > 0);
  // nameSegments is narrow-to-broad (city, ..., country) as Mapbox formats
  // it — reverse to broad-to-narrow to match continent → country → state →
  // city order.
  return [continentLabel, ...nameSegments.reverse()];
}

/** Builds a continent → country → [state] → city tree by splitting each
 * pin's display name on commas, broadest segment (country) first — e.g.
 * "Rutland, Vermont, United States" walks continent → United States →
 * Vermont → Rutland; "Paris, France" walks continent → France → Paris (no
 * state level, since there's no middle segment). No stored geo fields are
 * needed; this derives the whole hierarchy from `name` + `lat`/`lng`, which
 * every existing pin already has. Fragile for unusual name formats (a name
 * with no country suffix lands one level shallower than expected) — a
 * pragmatic tradeoff to work on all pins immediately, no migration/backfill
 * needed, per the design decision in this feature's brainstorming. */
export function buildGeoTree(places: PinnedPlace[]): GeoTreeNode {
  const root = createNode("root");

  for (const place of places) {
    const chain = getPlaceChain(place);

    let node = root;
    for (const segment of chain) {
      let child = node.children.get(segment);
      if (!child) {
        child = createNode(segment);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.places.push(place);
  }

  return root;
}

/** Every place attached anywhere at or below `node`, not just places
 * attached directly to it — used so a mid-tree node (e.g. a country with
 * both direct city pins and state-grouped ones) can report a total count. */
export function countPlacesUnder(node: GeoTreeNode): number {
  let count = node.places.length;
  for (const child of node.children.values()) {
    count += countPlacesUnder(child);
  }
  return count;
}

/** Every place attached anywhere at or below `node`, flattened — used both
 * for the dominant-tag tally below and to focus/fit the map to a browsed
 * level's full extent (see MapView's onFocusPlaces). */
export function collectPlacesUnder(node: GeoTreeNode): PinnedPlace[] {
  const places = [...node.places];
  for (const child of node.children.values()) {
    places.push(...collectPlacesUnder(child));
  }
  return places;
}

export interface DominantAppearance {
  color: string;
  iconShape: IconShape;
  count: number;
}

/** The most common tag among every place at or below `node` — e.g. a
 * "Rutland" city node whose 3 pins are 2 Ironman + 1 Airport reports
 * Ironman's color/icon. Ties break on whichever tag was encountered
 * first while walking the places (stable, not meaningfully arbitrary —
 * real ties are rare). Returns undefined when no place under the node
 * carries any tag at all. */
export function getDominantAppearance(
  node: GeoTreeNode,
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>,
): DominantAppearance | undefined {
  const tally = new Map<
    string,
    { color: string; iconShape: IconShape; count: number }
  >();

  for (const place of collectPlacesUnder(node)) {
    const classified = classifyPlace(place, builtinAppearance);
    if (!classified) continue;
    const existing = tally.get(classified.legendKey);
    if (existing) existing.count += 1;
    else
      tally.set(classified.legendKey, {
        color: classified.color,
        iconShape: classified.iconShape,
        count: 1,
      });
  }

  let best: DominantAppearance | undefined;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best;
}

export type LngLatBoundsTuple = [[number, number], [number, number]];

/** [[west, south], [east, north]] covering every place — the shape
 * mapboxgl.Map#fitBounds accepts directly. Returns null for an empty
 * array (nothing to fit to). */
export function getPlacesBounds(
  places: PinnedPlace[],
): LngLatBoundsTuple | null {
  if (places.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const place of places) {
    minLat = Math.min(minLat, place.lat);
    maxLat = Math.max(maxLat, place.lat);
    minLng = Math.min(minLng, place.lng);
    maxLng = Math.max(maxLng, place.lng);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

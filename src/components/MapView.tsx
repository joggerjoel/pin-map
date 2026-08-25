import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { ExpressionSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlacePhoto } from "../lib/photosRepository";
import { openPhotoLightbox } from "../lib/photoLightbox";
import type { PlaceCategory } from "../lib/checklist";
import { buildGoogleMapsUrl } from "../lib/googleMaps";
import { resolveLocationInput } from "../lib/locationInput";
import { toGeoJsonStateName } from "../lib/stateNames";
import {
  AIRPLANE_ICON_PATH,
  HOUSE_ICON_PATH,
  RUN_ICON_PATH,
  SKI_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";
import { BUILTIN_TAG_KEYS, BUILTIN_TAG_LABELS } from "../lib/tagAppearance";
import type {
  BuiltinTagKey,
  IconShape,
  TagAppearance,
} from "../lib/tagAppearance";
import { computeDeclutterOffsets } from "../lib/markerDeclutter";
import type { ScreenPoint } from "../lib/markerDeclutter";
import { renderIconGlyph } from "../lib/iconGlyph";
import { useLegendLayout } from "../hooks/useLegendLayout";
import { GeoDrillDownTray } from "./GeoDrillDownTray";
import { resolveBuiltinKey } from "../lib/legendClassification";
import { getPlacesBounds } from "../lib/geoHierarchy";

const SVG_NS = "http://www.w3.org/2000/svg";

// A stable reference for the default, rather than a fresh `{}` literal in
// the destructuring default — an inline literal default is re-created on
// every render, which would change identity every time and defeat the
// marker-rebuild effect's dependency check below.
const EMPTY_PHOTOS_BY_QUERY: Record<string, PlacePhoto[]> = {};
const NOOP_ADD_PHOTO = (): void => {};

function createTriathleteIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");

  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", String(TRIATHLETE_ICON_HEAD.cx));
  head.setAttribute("cy", String(TRIATHLETE_ICON_HEAD.cy));
  head.setAttribute("r", String(TRIATHLETE_ICON_HEAD.r));
  head.setAttribute("fill", "#ffffff");
  head.setAttribute("fill-opacity", "1");

  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("d", TRIATHLETE_ICON_BODY_PATH);
  body.setAttribute("fill", "#ffffff");
  body.setAttribute("fill-opacity", "1");

  svg.appendChild(head);
  svg.appendChild(body);
  return svg;
}

function createHouseIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", HOUSE_ICON_PATH);
  path.setAttribute("fill", "#ffffff");
  path.setAttribute("fill-opacity", "1");

  svg.appendChild(path);
  return svg;
}

function createAirplaneIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", AIRPLANE_ICON_PATH);
  path.setAttribute("fill", "#ffffff");
  path.setAttribute("fill-opacity", "1");

  svg.appendChild(path);
  return svg;
}

function createSkiIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", SKI_ICON_PATH);
  path.setAttribute("fill", "#ffffff");
  path.setAttribute("fill-opacity", "1");

  svg.appendChild(path);
  return svg;
}

function createRunIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", RUN_ICON_PATH);
  path.setAttribute("fill", "#ffffff");
  path.setAttribute("fill-opacity", "1");

  svg.appendChild(path);
  return svg;
}

function createPopupContent(
  place: PinnedPlace,
  onRelocate: (query: string, searchText: string) => void,
  onSetLocation: (query: string, lat: number, lng: number) => void,
  canEdit: boolean,
  photos: PlacePhoto[],
  onAddPhoto: (query: string, file: File) => void,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "map-popup";

  const nameEl = document.createElement("div");
  nameEl.textContent = place.name;
  container.appendChild(nameEl);

  const link = document.createElement("a");
  link.href = buildGoogleMapsUrl(place.lat, place.lng);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View on Google Maps";
  container.appendChild(link);

  if (photos.length > 0) {
    const gallery = document.createElement("div");
    gallery.className = "map-popup__photos";
    for (const photo of photos) {
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = `Photo of ${place.name}`;
      img.addEventListener("click", () => {
        openPhotoLightbox(photo.url, img.alt);
      });
      gallery.appendChild(img);
    }
    container.appendChild(gallery);
  }

  // The relocate form triggers a live Mapbox search-API call on submit
  // (see resolveLocationInput/geocodeLine) — omitted entirely for viewers
  // who can't sign in and persist a change anyway, so an anonymous visitor
  // can never burn the shared Mapbox quota just by clicking a pin.
  if (!canEdit) {
    return container;
  }

  const form = document.createElement("form");
  form.className = "map-popup__relocate";

  const input = document.createElement("input");
  input.type = "text";
  input.name = "location";
  input.placeholder = "Paste a Google Maps link, lat,lng, or a new search";
  input.setAttribute("aria-label", `Fix location for ${place.name}`);
  form.appendChild(input);

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.textContent = "Update location";
  form.appendChild(submitButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text === "") return;
    resolveLocationInput(place.query, text, onRelocate, onSetLocation);
    input.value = "";
  });

  container.appendChild(form);

  const photoLabel = document.createElement("label");
  photoLabel.className = "map-popup__photo-upload";
  photoLabel.textContent = "Add photo";

  const photoInput = document.createElement("input");
  photoInput.type = "file";
  photoInput.accept = "image/*";
  photoInput.setAttribute("aria-label", `Add a photo for ${place.name}`);
  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (file) {
      onAddPhoto(place.query, file);
    }
    photoInput.value = "";
  });
  photoLabel.appendChild(photoInput);
  container.appendChild(photoLabel);

  return container;
}

function createIconBadgeElement(
  backgroundColor: string,
  icon: SVGSVGElement,
): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "32px";
  el.style.height = "32px";
  el.style.borderRadius = "50%";
  el.style.background = backgroundColor;
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.border = "2px solid white";
  el.style.boxShadow = "0 1px 4px rgba(0, 0, 0, 0.3)";
  el.appendChild(icon);
  return el;
}

/**
 * A one-shot request to fly the map to a place. `nonce` must change on every
 * selection (even reselecting the same query) so the fly-to effect below can
 * treat it as a distinct trigger rather than bailing out on an unchanged
 * value.
 */
export interface MapSelection {
  query: string;
  nonce: number;
}

export interface MapViewProps {
  token: string;
  places: PinnedPlace[];
  selection: MapSelection | null;
  onMarkerClick: (query: string) => void;
  onRelocate: (query: string, searchText: string) => void;
  onSetLocation: (query: string, lat: number, lng: number) => void;
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>;
  declutterEnabled: boolean;
  canEdit: boolean;
  photosByQuery?: Record<string, PlacePhoto[]>;
  onAddPhoto?: (query: string, file: File) => void;
}

function buildMarkerOptionsFromAppearance(
  appearance: TagAppearance,
): { element: HTMLDivElement } | { color: string } {
  if (appearance.iconShape === "house") {
    return {
      element: createIconBadgeElement(appearance.color, createHouseIconSvg()),
    };
  }
  if (appearance.iconShape === "triathlete") {
    return {
      element: createIconBadgeElement(
        appearance.color,
        createTriathleteIconSvg(),
      ),
    };
  }
  if (appearance.iconShape === "airplane") {
    return {
      element: createIconBadgeElement(
        appearance.color,
        createAirplaneIconSvg(),
      ),
    };
  }
  if (appearance.iconShape === "ski") {
    return {
      element: createIconBadgeElement(appearance.color, createSkiIconSvg()),
    };
  }
  if (appearance.iconShape === "run") {
    return {
      element: createIconBadgeElement(appearance.color, createRunIconSvg()),
    };
  }
  return { color: appearance.color };
}

function createMarkerOptions(
  place: PinnedPlace,
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>,
): { element: HTMLDivElement } | { color: string } | undefined {
  if (place.customTag) {
    return buildMarkerOptionsFromAppearance({
      color: place.customTag.color,
      iconShape: place.customTag.iconShape,
    });
  }
  const builtinKey = resolveBuiltinKey(place);
  if (builtinKey === undefined) {
    return undefined;
  }
  return buildMarkerOptionsFromAppearance(builtinAppearance[builtinKey]);
}

interface LegendEntry {
  key: string;
  label: string;
  color: string;
  iconShape: IconShape;
  places: PinnedPlace[];
}

// Every distinct pin type actually present among `places` — every builtin
// category/icon (not just visited/lived/hometown, the old hardcoded list)
// plus every custom tag in use. Order: builtins in their canonical
// BUILTIN_TAG_KEYS order, then custom tags in first-seen order. Each entry
// also carries the places it groups, so a click can cycle through them.
function getPresentLegendEntries(
  places: PinnedPlace[],
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>,
): LegendEntry[] {
  const placesByBuiltinKey = new Map<BuiltinTagKey, PinnedPlace[]>();
  const presentCustomTagsById = new Map<string, PinnedPlace["customTag"]>();
  const placesByCustomTagId = new Map<string, PinnedPlace[]>();

  for (const place of places) {
    if (place.customTag) {
      presentCustomTagsById.set(place.customTag.id, place.customTag);
      const group = placesByCustomTagId.get(place.customTag.id);
      if (group) group.push(place);
      else placesByCustomTagId.set(place.customTag.id, [place]);
      continue;
    }
    const builtinKey = resolveBuiltinKey(place);
    if (builtinKey !== undefined) {
      const group = placesByBuiltinKey.get(builtinKey);
      if (group) group.push(place);
      else placesByBuiltinKey.set(builtinKey, [place]);
    }
  }

  const entries: LegendEntry[] = [];
  for (const key of BUILTIN_TAG_KEYS) {
    const group = placesByBuiltinKey.get(key);
    if (group) {
      entries.push({
        key,
        label: BUILTIN_TAG_LABELS[key],
        color: builtinAppearance[key].color,
        iconShape: builtinAppearance[key].iconShape,
        places: group,
      });
    }
  }
  for (const tag of presentCustomTagsById.values()) {
    if (!tag) continue;
    entries.push({
      key: `custom:${tag.id}`,
      label: tag.label,
      color: tag.color,
      iconShape: tag.iconShape,
      places: placesByCustomTagId.get(tag.id) ?? [],
    });
  }
  return entries;
}

const LEGEND_FOCUS_ZOOM = 12;
const LEGEND_ZOOM_OUT_LEVEL = 1.5;
// Mapbox's default flyTo/easeTo duration scales with distance — a
// cross-continent hop can take many seconds. Left uncapped, a normal click
// cadence outpaces that: each click interrupts the still-flying previous
// one before it lands, so the camera perpetually chases the newest target
// and never actually arrives anywhere (reads as "stuck"). Fixing the
// duration keeps every transition snappy and predictable regardless of how
// far apart the two pins are.
const ZOOM_OUT_DURATION_MS = 450;
const FOCUS_FLY_DURATION_MS = 600;

// Zooms out just far enough to reveal both `current` and `target`, then
// flies in to `target` once the zoom-out settles — a deliberate two-stage
// transition (not just flyTo's own easing curve) so cycling through a
// legend entry's pins always reads as "zoom out, then zoom to the next
// one." Bounding to the current↔target pair (rather than always zooming to
// a fixed world-level) means a sibling in the same city stays close, while
// Miami → Tokyo genuinely earns a world view. `current` is null when there's
// no known prior pin to bound against (e.g. the first click for a given
// cycle key), which falls back to the old fixed zoom-out.
//
// `skipAnimation` is for re-selecting the *same* entry in a cycle (e.g. a
// legend key with only one matching pin, clicked again) — deliberately NOT
// inferred by comparing current/target coordinates: two genuinely different
// pins can share identical geocoded coordinates (e.g. the same Ironman
// venue in different years), and skipping on coordinate equality made
// cycling between them look stuck, since it silently did nothing on every
// other click.
//
// `navGenerationRef` guards against clicking faster than the two-stage
// animation can settle. Each call bumps the counter and captures its own
// value; a `moveend` handler that fires after a *later* call has already
// started is stale (a rapid click on this same legend/tray entry
// interrupted the in-flight zoom-out, which itself fires a `moveend` and
// would otherwise trigger this call's queued flyTo late, fighting the
// newer click's own transition and leaving the camera stuck mid-zoom-out
// instead of landing on the most recent target) — so it's a no-op instead
// of firing flyTo/onComplete out of turn.
function zoomOutThenFlyTo(
  map: mapboxgl.Map,
  current: { lat: number; lng: number } | null,
  target: { lat: number; lng: number },
  skipAnimation: boolean,
  navGenerationRef: { current: number },
  onComplete?: () => void,
): void {
  const generation = ++navGenerationRef.current;
  const isStale = () => navGenerationRef.current !== generation;

  if (skipAnimation) {
    // Camera is already sitting on this pin — a zoom-out/zoom-in round
    // trip back to the exact same point would just flicker, not transition.
    if (onComplete) onComplete();
    return;
  }

  map.once("moveend", () => {
    if (isStale()) return;
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: LEGEND_FOCUS_ZOOM,
      duration: FOCUS_FLY_DURATION_MS,
    });
    if (onComplete) {
      map.once("moveend", () => {
        if (isStale()) return;
        onComplete();
      });
    }
  });

  if (current === null) {
    map.easeTo({
      zoom: Math.min(map.getZoom(), LEGEND_ZOOM_OUT_LEVEL),
      duration: ZOOM_OUT_DURATION_MS,
    });
    return;
  }

  const bounds: mapboxgl.LngLatBoundsLike = [
    [Math.min(current.lng, target.lng), Math.min(current.lat, target.lat)],
    [Math.max(current.lng, target.lng), Math.max(current.lat, target.lat)],
  ];
  // Capped at the current zoom so this stage never zooms IN — zooming out
  // is the whole point, even when the bounding pair would otherwise fit
  // tighter than where the camera already is.
  map.fitBounds(bounds, {
    padding: 80,
    maxZoom: map.getZoom(),
    duration: ZOOM_OUT_DURATION_MS,
  });
}

function getPinTypeLabel(place: PinnedPlace): string | undefined {
  if (place.customTag) return place.customTag.label;
  const builtinKey = resolveBuiltinKey(place);
  return builtinKey ? BUILTIN_TAG_LABELS[builtinKey] : undefined;
}

type MapboxMatchExpression = ExpressionSpecification;

// mapbox-gl's own .d.ts types `GeoJSONSource.setData` in terms of the
// ambient `GeoJSON` namespace (from the `@types/geojson` package), which
// isn't installed in this project — referencing that namespace by name
// ourselves (e.g. `GeoJSON.Feature`) fails to resolve. `setData`'s own
// signature is still fully typed, though, so deriving the feature type from
// it structurally avoids needing the ambient namespace at all.
type DeclutterLineData = Parameters<mapboxgl.GeoJSONSource["setData"]>[0];
type DeclutterLineFeature = Extract<
  DeclutterLineData,
  { type: "FeatureCollection" }
>["features"][number];

function applyStateColors(
  map: mapboxgl.Map,
  places: PinnedPlace[],
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>,
): void {
  if (!map.getLayer("us-states-fill")) return;

  const categorizedByState = new Map<string, PlaceCategory>();
  places.forEach((place) => {
    if (place.category) {
      categorizedByState.set(toGeoJsonStateName(place.query), place.category);
    }
  });

  if (categorizedByState.size === 0) {
    map.setPaintProperty("us-states-fill", "fill-color", "rgba(0, 0, 0, 0)");
    map.setPaintProperty("us-states-outline", "line-color", "rgba(0, 0, 0, 0)");
    return;
  }

  const fillMatch: MapboxMatchExpression = ["match", ["get", "name"]];
  const outlineMatch: MapboxMatchExpression = ["match", ["get", "name"]];
  categorizedByState.forEach((category, stateName) => {
    fillMatch.push(stateName, builtinAppearance[category].color);
    outlineMatch.push(stateName, "#1f2937");
  });
  fillMatch.push("rgba(0, 0, 0, 0)");
  outlineMatch.push("rgba(0, 0, 0, 0)");

  map.setPaintProperty("us-states-fill", "fill-color", fillMatch);
  map.setPaintProperty("us-states-outline", "line-color", outlineMatch);
}

export function MapView({
  token,
  places,
  selection,
  onMarkerClick,
  onRelocate,
  onSetLocation,
  builtinAppearance,
  declutterEnabled,
  canEdit,
  photosByQuery = EMPTY_PHOTOS_BY_QUERY,
  onAddPhoto = NOOP_ADD_PHOTO,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const placesRef = useRef<PinnedPlace[]>(places);
  placesRef.current = places;
  const builtinAppearanceRef =
    useRef<Record<BuiltinTagKey, TagAppearance>>(builtinAppearance);
  builtinAppearanceRef.current = builtinAppearance;

  const legendEntries = getPresentLegendEntries(places, builtinAppearance);
  const legend = useLegendLayout();
  // Which place within a given group (a legend entry, or a geo-tray leaf)
  // was shown last, keyed by an arbitrary caller-chosen string, so repeated
  // clicks on the same group cycle forward (wrapping around) instead of
  // always jumping to the first match. Shared by the legend and the
  // continent/country/state/city browse tray below.
  const cycleIndexRef = useRef<Record<string, number>>({});
  // Bumped on every zoomOutThenFlyTo call (legend click, tray leaf click, or
  // tray breadcrumb/drill navigation) so a stale chained `moveend` handler
  // from an interrupted, superseded navigation can recognize itself as
  // stale and no-op — see zoomOutThenFlyTo's comment for why this is
  // needed to avoid the camera getting stuck when clicks land faster than
  // the two-stage zoom-out/fly-in animation can settle.
  const navGenerationRef = useRef(0);

  // Opens a pin's popup (its photo gallery, if any) once the camera lands on
  // it via legend/tray navigation — a no-op for pins with no photos, so
  // browsing a photo-free pin doesn't pop open an empty popup unprompted.
  const revealPhotosFor = useCallback(
    (place: PinnedPlace) => {
      if ((photosByQuery[place.query]?.length ?? 0) === 0) return;
      const marker = markersRef.current.get(place.query);
      const popup = marker?.getPopup();
      if (popup != null && !popup.isOpen()) {
        marker?.togglePopup();
      }
    },
    [photosByQuery],
  );

  const handleCyclePlacesClick = useCallback(
    (cycleKey: string, cyclePlaces: PinnedPlace[]): PinnedPlace | null => {
      const map = mapRef.current;
      if (map === null || cyclePlaces.length === 0) return null;
      const previousIndex = cycleIndexRef.current[cycleKey] ?? -1;
      const nextIndex = (previousIndex + 1) % cyclePlaces.length;
      const current = previousIndex >= 0 ? cyclePlaces[previousIndex] : null;
      // Only true when there's exactly one candidate to cycle through (so
      // every click re-selects index 0) — NOT when two distinct pins just
      // happen to share coordinates, which still needs its own flyTo.
      const isReselectingOnlyMatch = previousIndex === nextIndex;
      cycleIndexRef.current[cycleKey] = nextIndex;
      const target = cyclePlaces[nextIndex];
      zoomOutThenFlyTo(
        map,
        current,
        target,
        isReselectingOnlyMatch,
        navGenerationRef,
        () => revealPhotosFor(target),
      );
      return target;
    },
    [revealPhotosFor],
  );

  // Browsing to a level in the geo tray (via breadcrumb or drilling into a
  // non-leaf node) fits the map to that level's full extent — a single
  // place still gets the zoom-out/zoom-in treatment (a fitBounds on one
  // point is a degenerate, not-very-meaningful bbox). No "current" place is
  // tracked for this flow, so it always falls back to the fixed zoom-out —
  // unlike legend/tray cycling, breadcrumb navigation doesn't have a
  // meaningful "previous pin" to bound against.
  const handleFocusPlaces = useCallback(
    (focusPlaces: PinnedPlace[]) => {
      const map = mapRef.current;
      if (map === null) return;
      if (focusPlaces.length === 1) {
        zoomOutThenFlyTo(
          map,
          null,
          focusPlaces[0],
          false,
          navGenerationRef,
          () => revealPhotosFor(focusPlaces[0]),
        );
        return;
      }
      // Invalidates any still-pending chained `moveend` handler from a
      // previous zoomOutThenFlyTo call — this fitBounds doesn't start one
      // of its own, but without bumping the generation here a late-firing
      // stale handler could still flyTo an old target and undo this move.
      navGenerationRef.current += 1;
      const bounds = getPlacesBounds(focusPlaces);
      if (bounds === null) return;
      map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
    },
    [revealPhotosFor],
  );

  // The place the legend most recently flew to — handed down to the geo
  // browse tray so it can drill to and highlight that same place, keeping
  // the two navigation surfaces in sync. Deliberately NOT set from the
  // tray's own leaf clicks (handleCyclePlacesClick is shared, but this
  // state is legend-only) — the tray already reflects wherever the user
  // just clicked inside it; re-syncing it to itself would only risk an
  // unwanted auto-expand on every one of its own clicks.
  const [legendFocusedPlace, setLegendFocusedPlace] =
    useState<PinnedPlace | null>(null);

  const handleLegendEntryClick = useCallback(
    (entry: LegendEntry) => {
      const target = handleCyclePlacesClick(
        `legend:${entry.key}`,
        entry.places,
      );
      if (target !== null) setLegendFocusedPlace(target);
    },
    [handleCyclePlacesClick],
  );

  const [displayZoom, setDisplayZoom] = useState<number | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [0, 20],
      zoom: 1.5,
    });
    mapRef.current = map;
    setDisplayZoom(map.getZoom());
    const handleZoom = () => setDisplayZoom(map.getZoom());
    map.on("zoom", handleZoom);
    // Mapbox GL doesn't notice when its own container element is resized by
    // something else — collapsing the sidebar, dragging the splitter, or
    // just resizing the browser window all leave its canvas at its old
    // pixel size, showing as blank space until map.resize() is called (the
    // library has no way to detect this on its own; only a full page
    // reload used to "fix" it, by recreating the map at the new size).
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);
    map.on("load", () => {
      map.addSource("us-states", {
        type: "geojson",
        data: "/us-states.geo.json",
      });
      map.addLayer({
        id: "us-states-fill",
        type: "fill",
        source: "us-states",
        paint: {
          "fill-color": "rgba(0, 0, 0, 0)",
          "fill-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "us-states-outline",
        type: "line",
        source: "us-states",
        paint: {
          "line-color": "rgba(0, 0, 0, 0)",
          "line-width": 1.5,
        },
      });
      map.addSource("declutter-lines", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "declutter-lines",
        type: "line",
        source: "declutter-lines",
        paint: {
          "line-color": "#9ca3af",
          "line-width": 1,
          "line-opacity": 0.8,
        },
      });
      applyStateColors(map, placesRef.current, builtinAppearanceRef.current);
    });
    return () => {
      map.off("zoom", handleZoom);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    // Mapbox GL JS recalculates each marker's z-index on every render based on
    // its own screen-space position, silently overwriting any z-index we set
    // — so for pins that share (or nearly share) a location, stacking order
    // instead falls back to DOM source order. Adding markers west-to-east
    // (ascending longitude) means an easterly pin is appended after, and so
    // renders on top of, a westerly one at the same spot.
    const orderedPlaces = [...places].sort((a, b) => a.lng - b.lng);

    orderedPlaces.forEach((place) => {
      const marker = new mapboxgl.Marker(
        createMarkerOptions(place, builtinAppearance),
      );
      marker
        .setLngLat([place.lng, place.lat])
        .setPopup(
          new mapboxgl.Popup().setDOMContent(
            createPopupContent(
              place,
              onRelocate,
              onSetLocation,
              canEdit,
              photosByQuery[place.query] ?? [],
              onAddPhoto,
            ),
          ),
        )
        .addTo(map);
      marker.getElement().addEventListener("click", () => {
        onMarkerClick(place.query);
      });
      const typeLabel = getPinTypeLabel(place);
      if (typeLabel !== undefined) {
        marker.getElement().title = typeLabel;
      }
      if ((photosByQuery[place.query]?.length ?? 0) > 0) {
        marker.getElement().classList.add("map-marker--has-photos");
      }
      markersRef.current.set(place.query, marker);
    });

    if (places.length === 1) {
      map.flyTo({ center: [places[0].lng, places[0].lat], zoom: 10 });
    } else if (places.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      places.forEach((place) => bounds.extend([place.lng, place.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
    }

    if (map.isStyleLoaded()) {
      applyStateColors(map, places, builtinAppearance);
    } else {
      map.once("load", () => applyStateColors(map, places, builtinAppearance));
    }

    let declutterFrame: number | null = null;

    function clearDeclutter(currentMap: mapboxgl.Map) {
      orderedPlaces.forEach((place) => {
        markersRef.current.get(place.query)?.setLngLat([place.lng, place.lat]);
      });
      const lineSource = currentMap.getSource("declutter-lines");
      if (lineSource !== undefined && "setData" in lineSource) {
        (lineSource as mapboxgl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [],
        });
      }
    }

    // Pins geographically far outside the current view (a different
    // continent, or just off the edge of the map) shouldn't be visible or
    // factor into decluttering — hide their markers entirely and exclude
    // them from the collision math, rather than relying on it happening to
    // project somewhere off-canvas.
    function updateMarkerVisibility(currentMap: mapboxgl.Map): PinnedPlace[] {
      const bounds = currentMap.getBounds();
      const visible: PinnedPlace[] = [];
      orderedPlaces.forEach((place) => {
        const marker = markersRef.current.get(place.query);
        if (marker === undefined) {
          return;
        }
        const inBounds =
          bounds === null || bounds.contains([place.lng, place.lat]);
        marker.getElement().style.display = inBounds ? "" : "none";
        if (inBounds) {
          visible.push(place);
        }
      });
      return visible;
    }

    function updateDeclutter() {
      const currentMap = mapRef.current;
      if (currentMap === null) {
        return;
      }
      const visiblePlaces = updateMarkerVisibility(currentMap);
      if (!declutterEnabled) {
        clearDeclutter(currentMap);
        return;
      }
      const points: ScreenPoint[] = visiblePlaces.map((place) => {
        const pixel = currentMap.project([place.lng, place.lat]);
        return { key: place.query, x: pixel.x, y: pixel.y };
      });
      const offsets = computeDeclutterOffsets(points);
      const lineFeatures: DeclutterLineFeature[] = [];
      offsets.forEach((offset) => {
        const marker = markersRef.current.get(offset.key);
        const place = visiblePlaces.find(
          (candidate) => candidate.query === offset.key,
        );
        if (marker === undefined || place === undefined) {
          return;
        }
        if (offset.dx === 0 && offset.dy === 0) {
          marker.setLngLat([place.lng, place.lat]);
          return;
        }
        const truePixel = currentMap.project([place.lng, place.lat]);
        const adjusted = currentMap.unproject([
          truePixel.x + offset.dx,
          truePixel.y + offset.dy,
        ]);
        marker.setLngLat([adjusted.lng, adjusted.lat]);
        lineFeatures.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [place.lng, place.lat],
              [adjusted.lng, adjusted.lat],
            ],
          },
        });
      });
      const lineSource = currentMap.getSource("declutter-lines");
      if (lineSource !== undefined && "setData" in lineSource) {
        (lineSource as mapboxgl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: lineFeatures,
        });
      }
    }

    function scheduleDeclutterUpdate() {
      if (declutterFrame !== null) {
        return;
      }
      declutterFrame = requestAnimationFrame(() => {
        declutterFrame = null;
        updateDeclutter();
      });
    }

    if (map.isStyleLoaded()) {
      updateDeclutter();
    } else {
      map.once("load", updateDeclutter);
    }
    map.on("move", scheduleDeclutterUpdate);

    return () => {
      map.off("move", scheduleDeclutterUpdate);
      if (declutterFrame !== null) {
        cancelAnimationFrame(declutterFrame);
      }
    };
  }, [places, builtinAppearance, declutterEnabled, canEdit, photosByQuery]);

  // Depends only on `selection`, never on `places` — otherwise pinning a new
  // place would re-fire this effect and fly back to the last selection,
  // stomping the fit-bounds effect above. Coordinates are resolved from
  // placesRef so they're always current without making `places` a dependency.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || selection === null) return;
    const place = placesRef.current.find(
      (candidate) => candidate.query === selection.query,
    );
    if (place === undefined) return;
    map.flyTo({ center: [place.lng, place.lat], zoom: 12 });
  }, [selection]);

  return (
    <>
      <div ref={containerRef} className="map-view" />
      {displayZoom !== null && (
        <div className="map-zoom-indicator">Zoom: {displayZoom.toFixed(1)}</div>
      )}
      {legendEntries.length > 0 && (
        <div
          className={
            legend.collapsed
              ? "map-legend-drawer map-legend-drawer--collapsed"
              : "map-legend-drawer"
          }
        >
          <button
            type="button"
            className="map-legend-drawer__toggle"
            onClick={legend.toggleCollapsed}
            aria-expanded={!legend.collapsed}
            aria-label={legend.collapsed ? "Show map key" : "Hide map key"}
          >
            {legend.collapsed ? "‹" : "›"}
            <span className="map-legend-drawer__toggle-label">Key</span>
          </button>
          {!legend.collapsed && (
            <div className="map-legend" role="list" aria-label="Map key">
              {legendEntries.map((entry) => (
                <button
                  type="button"
                  className="map-legend__item"
                  key={entry.key}
                  role="listitem"
                  onClick={() => handleLegendEntryClick(entry)}
                  aria-label={`Zoom to next ${entry.label} pin (${entry.places.length} total)`}
                >
                  <span
                    className="map-legend__swatch"
                    style={{ backgroundColor: entry.color }}
                  >
                    {renderIconGlyph(entry.iconShape)}
                  </span>
                  <span>{entry.label}</span>
                  {entry.places.length > 1 && (
                    <span className="map-legend__count">
                      {entry.places.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <GeoDrillDownTray
        places={places}
        builtinAppearance={builtinAppearance}
        onSelectPlaces={(key, cyclePlaces) =>
          handleCyclePlacesClick(`tray:${key}`, cyclePlaces)
        }
        onFocusPlaces={handleFocusPlaces}
        focusedPlace={legendFocusedPlace}
      />
    </>
  );
}

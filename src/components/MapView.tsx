import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { ExpressionSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";
import { buildGoogleMapsUrl } from "../lib/googleMaps";
import { resolveLocationInput } from "../lib/locationInput";
import { toGeoJsonStateName } from "../lib/stateNames";
import {
  AIRPLANE_ICON_PATH,
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";
import { BUILTIN_TAG_LABELS } from "../lib/tagAppearance";
import type { BuiltinTagKey, TagAppearance } from "../lib/tagAppearance";

const SVG_NS = "http://www.w3.org/2000/svg";

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

function createPopupContent(
  place: PinnedPlace,
  onRelocate: (query: string, searchText: string) => void,
  onSetLocation: (query: string, lat: number, lng: number) => void,
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
}

function resolveBuiltinKey(place: PinnedPlace): BuiltinTagKey | undefined {
  if (place.icon === "triathlete") return "ironman";
  if (place.icon === "house-home") return "hometown";
  if (place.icon === "house-live") return "lived";
  if (place.icon === "airplane") return "airport";
  if (place.category) return place.category;
  return undefined;
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

const CATEGORY_ORDER: PlaceCategory[] = ["visited", "lived", "hometown"];

function getPinTypeLabel(place: PinnedPlace): string | undefined {
  if (place.customTag) return place.customTag.label;
  const builtinKey = resolveBuiltinKey(place);
  return builtinKey ? BUILTIN_TAG_LABELS[builtinKey] : undefined;
}

type MapboxMatchExpression = ExpressionSpecification;

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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const placesRef = useRef<PinnedPlace[]>(places);
  placesRef.current = places;
  const builtinAppearanceRef =
    useRef<Record<BuiltinTagKey, TagAppearance>>(builtinAppearance);
  builtinAppearanceRef.current = builtinAppearance;

  const presentCategories = CATEGORY_ORDER.filter((category) =>
    places.some((place) => place.category === category),
  );

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
      applyStateColors(map, placesRef.current, builtinAppearanceRef.current);
    });
    return () => {
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
            createPopupContent(place, onRelocate, onSetLocation),
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
  }, [places, builtinAppearance]);

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
      {presentCategories.length > 0 && (
        <div className="map-legend">
          {presentCategories.map((category) => (
            <div className="map-legend__item" key={category}>
              <span
                className="map-legend__swatch"
                style={{ backgroundColor: builtinAppearance[category].color }}
              />
              <span>{BUILTIN_TAG_LABELS[category]}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

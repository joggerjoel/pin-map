import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { ExpressionSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";
import { toGeoJsonStateName } from "../lib/stateNames";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";

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
}

const CATEGORY_COLORS: Record<PlaceCategory, string> = {
  visited: "#3b82f6",
  lived: "#f97316",
  hometown: "#eab308",
};

function createMarkerOptions(
  place: PinnedPlace,
): { element: HTMLDivElement } | { color: string } | undefined {
  if (place.icon === "triathlete") {
    return {
      element: createIconBadgeElement("#dc2626", createTriathleteIconSvg()),
    };
  }
  if (place.icon === "house-live") {
    return {
      element: createIconBadgeElement(
        CATEGORY_COLORS.visited,
        createHouseIconSvg(),
      ),
    };
  }
  if (place.icon === "house-home" || place.category === "hometown") {
    return {
      element: createIconBadgeElement(
        CATEGORY_COLORS.hometown,
        createHouseIconSvg(),
      ),
    };
  }
  if (place.customTag) {
    return { color: place.customTag.color };
  }
  return place.category
    ? { color: CATEGORY_COLORS[place.category] }
    : undefined;
}

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  visited: "Visited",
  lived: "Lived",
  hometown: "Hometown",
};

const CATEGORY_ORDER: PlaceCategory[] = ["visited", "lived", "hometown"];

function getPinTypeLabel(place: PinnedPlace): string | undefined {
  if (place.customTag) return place.customTag.label;
  if (place.icon === "triathlete") return "Ironman";
  if (place.icon === "house-home") return "Hometown";
  if (place.icon === "house-live") return "Lived";
  if (place.category) return CATEGORY_LABELS[place.category];
  return undefined;
}

type MapboxMatchExpression = ExpressionSpecification;

function applyStateColors(map: mapboxgl.Map, places: PinnedPlace[]): void {
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
    fillMatch.push(stateName, CATEGORY_COLORS[category]);
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const placesRef = useRef<PinnedPlace[]>(places);
  placesRef.current = places;

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
      applyStateColors(map, placesRef.current);
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

    places.forEach((place) => {
      const marker = new mapboxgl.Marker(createMarkerOptions(place));
      marker
        .setLngLat([place.lng, place.lat])
        .setPopup(new mapboxgl.Popup().setText(place.name))
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
      applyStateColors(map, places);
    } else {
      map.once("load", () => applyStateColors(map, places));
    }
  }, [places]);

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
                style={{ backgroundColor: CATEGORY_COLORS[category] }}
              />
              <span>{CATEGORY_LABELS[category]}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

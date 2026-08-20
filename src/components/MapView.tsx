import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";

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

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  visited: "Visited",
  lived: "Lived",
  hometown: "Hometown",
};

const CATEGORY_ORDER: PlaceCategory[] = ["visited", "lived", "hometown"];

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
      const marker = new mapboxgl.Marker(
        place.category ? { color: CATEGORY_COLORS[place.category] } : undefined,
      )
        .setLngLat([place.lng, place.lat])
        .setPopup(new mapboxgl.Popup().setText(place.name))
        .addTo(map);
      marker.getElement().addEventListener("click", () => {
        onMarkerClick(place.query);
      });
      markersRef.current.set(place.query, marker);
    });

    if (places.length === 1) {
      map.flyTo({ center: [places[0].lng, places[0].lat], zoom: 10 });
    } else if (places.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      places.forEach((place) => bounds.extend([place.lng, place.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
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

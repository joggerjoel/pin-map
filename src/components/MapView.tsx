import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { GeocodeResult } from "../lib/geocoder";

export interface MapViewProps {
  token: string;
  places: GeocodeResult[];
  selectedQuery: string | null;
}

export function MapView({ token, places, selectedQuery }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

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
      const marker = new mapboxgl.Marker()
        .setLngLat([place.lng, place.lat])
        .setPopup(new mapboxgl.Popup().setText(place.name))
        .addTo(map);
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

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || selectedQuery === null) return;
    const place = places.find((candidate) => candidate.query === selectedQuery);
    if (place === undefined) return;
    map.flyTo({ center: [place.lng, place.lat], zoom: 12 });
  }, [selectedQuery, places]);

  return <div ref={containerRef} className="map-view" />;
}

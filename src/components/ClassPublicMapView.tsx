import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";

export interface ClassPublicMapViewProps {
  token: string;
  people: PublicRosterLocation[];
}

function createAvatarMarkerElement(
  person: PublicRosterLocation,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "class-meetup-map__avatar-marker";
  const img = document.createElement("img");
  img.src = person.imageUrl;
  img.alt = "";
  el.appendChild(img);
  return el;
}

function createAvatarPopupContent(
  person: PublicRosterLocation,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "class-public-map__popup";
  const img = document.createElement("img");
  img.src = person.imageUrl;
  img.alt = "";
  container.appendChild(img);
  return container;
}

export function ClassPublicMapView({ token, people }: ClassPublicMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

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
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = people.map((person) =>
      new mapboxgl.Marker({ element: createAvatarMarkerElement(person) })
        .setLngLat([person.livingLng, person.livingLat])
        .setPopup(
          new mapboxgl.Popup().setDOMContent(createAvatarPopupContent(person)),
        )
        .addTo(map),
    );
  }, [people]);

  return <div ref={containerRef} className="class-meetup-map__canvas" />;
}

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";
import {
  CLASS_MAP_INITIAL_CENTER,
  CLASS_MAP_INITIAL_ZOOM,
} from "../lib/classMapDefaults";
import {
  getClassDeclutterEnabled,
  saveClassDeclutterEnabled,
} from "../lib/declutterSettings";
import { useMarkerDeclutter } from "../hooks/useMarkerDeclutter";
import type { DeclutterPoint } from "../hooks/useMarkerDeclutter";
import { formatClassDisplayName } from "../lib/classNavigation";

export interface ClassPublicMapViewProps {
  classSlug: string;
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

export function ClassPublicMapView({
  classSlug,
  token,
  people,
}: ClassPublicMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [declutterEnabled, setDeclutterEnabled] = useState(() =>
    getClassDeclutterEnabled(),
  );

  useEffect(() => {
    if (containerRef.current === null) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: CLASS_MAP_INITIAL_CENTER,
      zoom: CLASS_MAP_INITIAL_ZOOM,
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
    const next = new Map<string, mapboxgl.Marker>();
    people.forEach((person) => {
      const marker = new mapboxgl.Marker({
        element: createAvatarMarkerElement(person),
      })
        .setLngLat([person.livingLng, person.livingLat])
        .setPopup(
          new mapboxgl.Popup().setDOMContent(createAvatarPopupContent(person)),
        )
        .addTo(map);
      next.set(String(person.id), marker);
    });
    markersRef.current = next;
  }, [people]);

  const declutterPoints: DeclutterPoint[] = people.map((person) => ({
    key: String(person.id),
    lng: person.livingLng,
    lat: person.livingLat,
  }));
  useMarkerDeclutter(mapRef, markersRef, declutterPoints, declutterEnabled);

  function toggleDeclutter() {
    setDeclutterEnabled((prev) => {
      const next = !prev;
      saveClassDeclutterEnabled(next);
      return next;
    });
  }

  return (
    <>
      <div className="class-map__toggles">
        <button
          type="button"
          className="class-map__declutter-toggle"
          aria-pressed={declutterEnabled}
          onClick={toggleDeclutter}
        >
          {declutterEnabled ? "Spider: On" : "Spider: Off"}
        </button>
        <a href="/" className="class-map__declutter-toggle">
          {formatClassDisplayName(classSlug)}
        </a>
      </div>
      <div ref={containerRef} className="class-meetup-map__canvas" />
    </>
  );
}

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ClassMeetup } from "../lib/classMeetupsRepository";

export interface ClassMeetupMapViewProps {
  token: string;
  meetups: ClassMeetup[];
}

function createPopupContent(meetup: ClassMeetup): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "map-popup";

  const nameEl = document.createElement("div");
  nameEl.textContent = meetup.name;
  container.appendChild(nameEl);

  const metEl = document.createElement("div");
  metEl.textContent = `Met: ${meetup.metPersonName}`;
  container.appendChild(metEl);

  if (meetup.metDate !== "") {
    const dateEl = document.createElement("div");
    dateEl.textContent = meetup.metDate;
    container.appendChild(dateEl);
  }

  const byEl = document.createElement("div");
  byEl.className = "map-popup__submitted-by";
  byEl.textContent = `Added by ${meetup.submittedByEmail}`;
  container.appendChild(byEl);

  return container;
}

export function ClassMeetupMapView({
  token,
  meetups,
}: ClassMeetupMapViewProps) {
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
    markersRef.current = meetups.map((meetup) =>
      new mapboxgl.Marker()
        .setLngLat([meetup.lng, meetup.lat])
        .setPopup(
          new mapboxgl.Popup().setDOMContent(createPopupContent(meetup)),
        )
        .addTo(map),
    );
  }, [meetups]);

  return <div ref={containerRef} className="class-meetup-map__canvas" />;
}

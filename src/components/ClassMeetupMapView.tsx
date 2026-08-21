import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ClassMeetup } from "../lib/classMeetupsRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import { displayName } from "../lib/rosterName";
import {
  CLASS_MAP_INITIAL_CENTER,
  CLASS_MAP_INITIAL_ZOOM,
} from "../lib/classMapDefaults";

export interface ClassMeetupMapViewProps {
  token: string;
  meetups: ClassMeetup[];
  people: RosterPerson[];
  activePersonId?: number | null;
  onAvatarClick?: (person: RosterPerson | null) => void;
}

type PersonWithLivingLocation = RosterPerson & {
  livingLat: number;
  livingLng: number;
};

function hasLivingLocation(
  person: RosterPerson,
): person is PersonWithLivingLocation {
  return person.livingLat !== null && person.livingLng !== null;
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

function createAvatarMarkerElement(
  person: RosterPerson,
  isActive: boolean,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = isActive
    ? "class-meetup-map__avatar-marker class-meetup-map__avatar-marker--active"
    : "class-meetup-map__avatar-marker";
  const img = document.createElement("img");
  img.src = person.imageUrl;
  img.alt = displayName(person);
  el.appendChild(img);
  return el;
}

function createAvatarPopupContent(person: RosterPerson): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "map-popup";

  const nameEl = document.createElement("div");
  nameEl.textContent = displayName(person);
  container.appendChild(nameEl);

  const livingEl = document.createElement("div");
  livingEl.textContent = person.living;
  container.appendChild(livingEl);

  return container;
}

export function ClassMeetupMapView({
  token,
  meetups,
  people,
  activePersonId = null,
  onAvatarClick,
}: ClassMeetupMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const avatarMarkersRef = useRef<mapboxgl.Marker[]>([]);

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

    // Clicking a marker doesn't bubble to the map's own click handler (the
    // markers live outside the canvas element), so this only fires for a
    // genuine click on open map background — the "click away to deselect"
    // gesture.
    function handleBackgroundClick() {
      onAvatarClick?.(null);
    }
    map.on("click", handleBackgroundClick);
    return () => {
      map.off("click", handleBackgroundClick);
    };
  }, [onAvatarClick]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    avatarMarkersRef.current.forEach((marker) => marker.remove());
    avatarMarkersRef.current = people
      .filter(hasLivingLocation)
      .map((person) => {
        const element = createAvatarMarkerElement(
          person,
          person.id === activePersonId,
        );
        const marker = new mapboxgl.Marker({ element })
          .setLngLat([person.livingLng, person.livingLat])
          .setPopup(
            new mapboxgl.Popup().setDOMContent(
              createAvatarPopupContent(person),
            ),
          )
          .addTo(map);
        element.addEventListener("click", () => {
          onAvatarClick?.(person);
        });
        return marker;
      });
  }, [people, activePersonId, onAvatarClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || activePersonId === null) return;
    const person = people.find((p) => p.id === activePersonId);
    if (person === undefined || !hasLivingLocation(person)) return;
    map.flyTo({ center: [person.livingLng, person.livingLat], zoom: 8 });
  }, [activePersonId, people]);

  return <div ref={containerRef} className="class-meetup-map__canvas" />;
}

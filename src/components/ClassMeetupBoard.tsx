import { useEffect, useState } from "react";
import { fetchRoster } from "../lib/classRosterRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";
import { addMeetup, fetchMeetups } from "../lib/classMeetupsRepository";
import type { ClassMeetup } from "../lib/classMeetupsRepository";
import { geocodeLine } from "../lib/geocoder";
import { CLASS_GEOCODE_COUNTRY_BIAS } from "../lib/classGeocodeBias";
import { displayName } from "../lib/rosterName";
import { ClassMeetupMapView } from "./ClassMeetupMapView";
import { RosterGrid } from "./RosterGrid";

export interface ClassMeetupBoardProps {
  classSlug: string;
  token: string;
  userId: string;
  userEmail: string;
  readOnly?: boolean;
  photosByPersonId?: Record<number, RosterPersonPhoto[]>;
  onAddPhoto?: (personId: number, file: File, year: number | null) => void;
}

export function ClassMeetupBoard({
  classSlug,
  token,
  userId,
  userEmail,
  readOnly = false,
  photosByPersonId,
  onAddPhoto,
}: ClassMeetupBoardProps) {
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [meetups, setMeetups] = useState<ClassMeetup[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeMapPersonId, setActiveMapPersonId] = useState<number | null>(
    null,
  );
  const [cityText, setCityText] = useState("");
  const [dateText, setDateText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRoster(classSlug).then((fetched) => {
      if (!cancelled) setPeople(fetched);
    });
    fetchMeetups(classSlug).then((fetched) => {
      if (!cancelled) setMeetups(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  const selectedPerson = people.find((p) => p.id === selectedId) ?? null;

  function handleAvatarClick(person: RosterPerson | null) {
    if (person === null || person.id === activeMapPersonId) {
      setActiveMapPersonId(null);
      setSearchText("");
      return;
    }
    setActiveMapPersonId(person.id);
    setSearchText(displayName(person));
  }

  function handleGridSelect(person: RosterPerson) {
    setSelectedId(person.id);
    if (person.livingLat !== null && person.livingLng !== null) {
      setActiveMapPersonId(person.id);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) {
      return;
    }
    if (selectedPerson === null) {
      setSubmitError("Pick who you met first.");
      return;
    }
    const trimmedCity = cityText.trim();
    if (trimmedCity === "") {
      setSubmitError("Enter a city.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const geocoded = await geocodeLine(
      trimmedCity,
      token,
      CLASS_GEOCODE_COUNTRY_BIAS,
    );
    if (geocoded === null) {
      setIsSubmitting(false);
      setSubmitError(`Couldn't find "${trimmedCity}".`);
      return;
    }
    const created = await addMeetup(classSlug, {
      submittedBy: userId,
      submittedByEmail: userEmail,
      metPersonId: selectedPerson.id,
      metPersonName: displayName(selectedPerson),
      query: geocoded.query,
      name: geocoded.name,
      lat: geocoded.lat,
      lng: geocoded.lng,
      metDate: dateText.trim(),
    });
    setIsSubmitting(false);
    if (created === null) {
      setSubmitError("Couldn't save that meetup — try again.");
      return;
    }
    setMeetups((prev) => [...prev, created]);
    setCityText("");
    setDateText("");
  }

  return (
    <div className="class-meetup-board">
      <ClassMeetupMapView
        classSlug={classSlug}
        token={token}
        meetups={meetups}
        people={people}
        activePersonId={activeMapPersonId}
        onAvatarClick={handleAvatarClick}
        photosByPersonId={photosByPersonId}
      />
      <div className="class-meetup-board__drawer">
        <RosterGrid
          people={people}
          selectedId={selectedId}
          searchText={searchText}
          onSearchChange={setSearchText}
          onSelect={handleGridSelect}
          photosByPersonId={photosByPersonId}
          onAddPhoto={
            onAddPhoto &&
            ((person, file, year) => onAddPhoto(person.id, file, year))
          }
        />
        <form
          className="class-meetup-board__form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <p>
            {selectedPerson
              ? `Met ${displayName(selectedPerson)}`
              : "Pick who you met above"}
          </p>
          <label>
            City
            <input
              type="text"
              value={cityText}
              onChange={(event) => setCityText(event.target.value)}
              placeholder="Where did you meet?"
            />
          </label>
          <label>
            Date (MM/YYYY)
            <input
              type="text"
              value={dateText}
              onChange={(event) => setDateText(event.target.value)}
              placeholder="MM/YYYY"
            />
          </label>
          <button type="submit" disabled={isSubmitting || readOnly}>
            {isSubmitting ? "Saving…" : "Log meetup"}
          </button>
          {submitError !== null && <span role="alert">{submitError}</span>}
        </form>
      </div>
    </div>
  );
}

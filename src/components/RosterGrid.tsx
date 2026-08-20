import { useState } from "react";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";
import { displayName, isDeceased, matchesSearch } from "../lib/rosterName";
import { PersonPhotoModal } from "./PersonPhotoModal";

const EMPTY_PHOTOS: RosterPersonPhoto[] = [];

export interface RosterGridProps {
  people: RosterPerson[];
  selectedId: number | null;
  searchText: string;
  onSearchChange: (text: string) => void;
  onSelect: (person: RosterPerson) => void;
  isLoading?: boolean;
  photosByPersonId?: Record<number, RosterPersonPhoto[]>;
  onAddPhoto?: (person: RosterPerson, file: File, year: number | null) => void;
}

export function RosterGrid({
  people,
  selectedId,
  searchText,
  onSearchChange,
  onSelect,
  isLoading = false,
  photosByPersonId = {},
  onAddPhoto,
}: RosterGridProps) {
  const [brokenImageIds, setBrokenImageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [modalPersonId, setModalPersonId] = useState<number | null>(null);
  const visiblePeople = people.filter((person) =>
    matchesSearch(person, searchText),
  );
  const modalPerson = people.find((p) => p.id === modalPersonId) ?? null;

  return (
    <div className="class-roster__grid-area">
      <input
        type="text"
        className="class-roster__search"
        aria-label="Search classmates"
        placeholder="Search by name..."
        value={searchText}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {isLoading && <p>Loading…</p>}
      <ul className="class-roster__grid">
        {visiblePeople.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className={[
                "class-roster__portrait",
                person.id === selectedId
                  ? "class-roster__portrait--selected"
                  : null,
                isDeceased(person) ? "class-roster__portrait--deceased" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={`Select ${displayName(person)}`}
              onClick={() => onSelect(person)}
              onDoubleClick={() => setModalPersonId(person.id)}
            >
              {brokenImageIds.has(person.id) ? (
                <span className="class-roster__portrait-placeholder">
                  {displayName(person).slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <img
                  src={person.imageUrl}
                  alt={displayName(person)}
                  onError={() =>
                    setBrokenImageIds((prev) => new Set(prev).add(person.id))
                  }
                />
              )}
              <span className="class-roster__portrait-name">
                {displayName(person)}
              </span>
              {isDeceased(person) && (
                <span className="class-roster__in-memoriam">In Memoriam</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {modalPerson !== null && (
        <PersonPhotoModal
          person={modalPerson}
          photos={photosByPersonId[modalPerson.id] ?? EMPTY_PHOTOS}
          onAddPhoto={(file, year) => onAddPhoto?.(modalPerson, file, year)}
          onClose={() => setModalPersonId(null)}
        />
      )}
    </div>
  );
}

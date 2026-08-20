import { useState } from "react";
import type { RosterPerson } from "../lib/classRosterRepository";
import { displayName, matchesSearch } from "../lib/rosterName";

export interface RosterGridProps {
  people: RosterPerson[];
  selectedId: number | null;
  searchText: string;
  onSearchChange: (text: string) => void;
  onSelect: (person: RosterPerson) => void;
  isLoading?: boolean;
}

export function RosterGrid({
  people,
  selectedId,
  searchText,
  onSearchChange,
  onSelect,
  isLoading = false,
}: RosterGridProps) {
  const [brokenImageIds, setBrokenImageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const visiblePeople = people.filter((person) =>
    matchesSearch(person, searchText),
  );

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
              className={
                person.id === selectedId
                  ? "class-roster__portrait class-roster__portrait--selected"
                  : "class-roster__portrait"
              }
              aria-label={`Select ${displayName(person)}`}
              onClick={() => onSelect(person)}
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
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

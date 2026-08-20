import type { GeocodeResult } from "../lib/geocoder";

export interface PlaceListProps {
  pinnedPlaces: GeocodeResult[];
  failedLines: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
}

export function PlaceList({
  pinnedPlaces,
  failedLines,
  onSelect,
  onRemove,
}: PlaceListProps) {
  return (
    <div className="place-list">
      <ul>
        {pinnedPlaces.map((place) => (
          <li key={place.query}>
            <button
              type="button"
              className="place-list__select"
              onClick={() => onSelect(place.query)}
            >
              {place.name}
            </button>
            <button
              type="button"
              aria-label={`Remove ${place.name}`}
              onClick={() => onRemove(place.query)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {failedLines.length > 0 && (
        <div className="place-list__failed">
          <h2>Couldn't find</h2>
          <ul>
            {failedLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

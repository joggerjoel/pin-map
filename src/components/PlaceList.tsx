import { useEffect, useRef } from "react";
import type { GeocodeResult } from "../lib/geocoder";

export interface PlaceListProps {
  pinnedPlaces: GeocodeResult[];
  failedLines: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  highlightedQuery: string | null;
}

export function PlaceList({
  pinnedPlaces,
  failedLines,
  onSelect,
  onRemove,
  highlightedQuery,
}: PlaceListProps) {
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  useEffect(() => {
    if (highlightedQuery === null) return;
    const el = itemRefs.current.get(highlightedQuery);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlightedQuery]);

  return (
    <div className="place-list">
      <ul>
        {pinnedPlaces.map((place) => (
          <li
            key={place.query}
            ref={(el) => {
              if (el) itemRefs.current.set(place.query, el);
              else itemRefs.current.delete(place.query);
            }}
            className={
              place.query === highlightedQuery
                ? "place-list__item--highlighted"
                : undefined
            }
          >
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

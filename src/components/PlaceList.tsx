import { useEffect, useRef, useState } from "react";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import { TagPicker } from "./TagPicker";

export interface PlaceListProps {
  pinnedPlaces: PinnedPlace[];
  failedLines: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onChangeTag: (
    query: string,
    tag: { category?: PlaceCategory; icon?: PlaceIcon },
  ) => void;
  highlightedQuery: string | null;
}

export function PlaceList({
  pinnedPlaces,
  failedLines,
  onSelect,
  onRemove,
  onChangeTag,
  highlightedQuery,
}: PlaceListProps) {
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);

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
            <div className="place-list__row">
              <button
                type="button"
                className="place-list__select"
                onClick={() => {
                  onSelect(place.query);
                  setExpandedQuery((prev) =>
                    prev === place.query ? null : place.query,
                  );
                }}
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
            </div>
            {expandedQuery === place.query && (
              <TagPicker
                selectedTag={
                  place.category
                    ? { kind: "category", value: place.category }
                    : place.icon
                      ? { kind: "icon", value: place.icon }
                      : null
                }
                onSelect={(tag) => {
                  onChangeTag(
                    place.query,
                    tag.kind === "category"
                      ? { category: tag.value }
                      : { icon: tag.value },
                  );
                  setExpandedQuery(null);
                }}
              />
            )}
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

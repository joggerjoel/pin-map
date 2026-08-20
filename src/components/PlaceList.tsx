import { useEffect, useRef, useState } from "react";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import { TagPicker } from "./TagPicker";

export interface PlaceListProps {
  pinnedPlaces: PinnedPlace[];
  failedLines: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onChangeTag: (
    query: string,
    tag: { category?: PlaceCategory; icon?: PlaceIcon; customTag?: CustomTag },
  ) => void;
  highlightedQuery: string | null;
  customTags: CustomTag[];
  onCreateCustomTag: (label: string, color: string) => void;
}

export function PlaceList({
  pinnedPlaces,
  failedLines,
  onSelect,
  onRemove,
  onChangeTag,
  highlightedQuery,
  customTags,
  onCreateCustomTag,
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
                  place.customTag
                    ? { kind: "custom", value: place.customTag }
                    : place.category
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
                      : tag.kind === "icon"
                        ? { icon: tag.value }
                        : { customTag: tag.value },
                  );
                  setExpandedQuery(null);
                }}
                customTags={customTags}
                onCreateCustomTag={onCreateCustomTag}
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

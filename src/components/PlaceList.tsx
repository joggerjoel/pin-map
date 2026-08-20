import { useEffect, useRef, useState } from "react";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import { buildGoogleMapsUrl } from "../lib/googleMaps";
import { resolveLocationInput } from "../lib/locationInput";
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
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRelocate: (query: string, searchText: string) => void;
  onSetLocation: (query: string, lat: number, lng: number) => void;
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
  onReorder,
  onRelocate,
  onSetLocation,
}: PlaceListProps) {
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  // Drag-and-drop handlers fire in rapid succession (dragstart then drop)
  // with no guarantee React has re-rendered in between, so onDrop can't rely
  // on `draggedIndex` from the closure without risking a stale read. A ref
  // mirrors the same value for synchronous, always-current access.
  const draggedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (highlightedQuery === null) return;
    const el = itemRefs.current.get(highlightedQuery);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setExpandedQuery(highlightedQuery);
  }, [highlightedQuery]);

  const indexedPlaces = pinnedPlaces.map((place, index) => ({ place, index }));
  const visiblePlaces =
    filterText.trim() === ""
      ? indexedPlaces
      : indexedPlaces.filter(({ place }) =>
          place.name.toLowerCase().includes(filterText.trim().toLowerCase()),
        );

  return (
    <div className="place-list">
      <input
        type="text"
        className="place-list__filter"
        aria-label="Filter places"
        placeholder="Filter places..."
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
      />
      <ul>
        {visiblePlaces.map(({ place, index }) => (
          <li
            key={place.query}
            ref={(el) => {
              if (el) itemRefs.current.set(place.query, el);
              else itemRefs.current.delete(place.query);
            }}
            className={
              [
                place.query === highlightedQuery
                  ? "place-list__item--highlighted"
                  : null,
                index === draggedIndex ? "place-list__item--dragging" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            <div className="place-list__row">
              <span
                className="place-list__drag-handle"
                draggable
                aria-label={`Reorder ${place.name}`}
                onDragStart={() => {
                  draggedIndexRef.current = index;
                  setDraggedIndex(index);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const fromIndex = draggedIndexRef.current;
                  if (fromIndex !== null && fromIndex !== index) {
                    onReorder(fromIndex, index);
                  }
                  draggedIndexRef.current = null;
                  setDraggedIndex(null);
                }}
                onDragEnd={() => {
                  draggedIndexRef.current = null;
                  setDraggedIndex(null);
                }}
              >
                ≡
              </span>
              {place.date && (
                <span className="place-list__date">{place.date}</span>
              )}
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
              <a
                href={buildGoogleMapsUrl(place.lat, place.lng)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${place.name} on Google Maps`}
                className="place-list__map-link"
              >
                ↗
              </a>
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
            {expandedQuery === place.query && (
              <form
                className="place-list__relocate"
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const text = String(formData.get("location") ?? "").trim();
                  if (text === "") return;
                  resolveLocationInput(
                    place.query,
                    text,
                    onRelocate,
                    onSetLocation,
                  );
                  event.currentTarget.reset();
                }}
              >
                <input
                  type="text"
                  name="location"
                  aria-label={`Fix location for ${place.name}`}
                  placeholder="Paste a Google Maps link, lat,lng, or a new search"
                />
                <button type="submit">Update location</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {visiblePlaces.length === 0 && pinnedPlaces.length > 0 && (
        <p className="place-list__no-matches">
          No places match "{filterText.trim()}"
        </p>
      )}
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

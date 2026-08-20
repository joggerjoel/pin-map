import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TagPicker, TAG_OPTIONS } from "./TagPicker";
import type { PinTag } from "./TagPicker";
import { searchPlaces } from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";
import { getMapboxToken } from "../lib/mapboxToken";

export type { PinTag };

export interface AddPinProps {
  onAdd: (city: string, tag: PinTag) => void;
  isLoading: boolean;
}

export function AddPin({ onAdd, isLoading }: AddPinProps) {
  const [city, setCity] = useState("");
  const [selectedTag, setSelectedTag] = useState<PinTag>(TAG_OPTIONS[0].tag);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const latestQueryRef = useRef("");

  useEffect(() => {
    const trimmed = city.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const token = getMapboxToken();
    if (token === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      latestQueryRef.current = trimmed;
      searchPlaces(trimmed, token)
        .then((results) => {
          if (latestQueryRef.current === trimmed) {
            setSuggestions(results);
          }
        })
        .catch(() => {
          if (latestQueryRef.current === trimmed) {
            setSuggestions([]);
          }
        });
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [city]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (city.trim() === "") return;
    onAdd(city, selectedTag);
    setCity("");
    setSuggestions([]);
  }

  return (
    <form className="add-pin" onSubmit={handleSubmit}>
      <label htmlFor="add-pin-city">Add a pin</label>
      <input
        id="add-pin-city"
        type="text"
        value={city}
        onChange={(event) => setCity(event.target.value)}
        placeholder="City name"
      />
      {suggestions.length > 0 && (
        <ul
          className="add-pin__suggestions"
          role="listbox"
          aria-label="City suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.name}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setCity(suggestion.name);
                  setSuggestions([]);
                }}
              >
                {suggestion.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <TagPicker selectedTag={selectedTag} onSelect={setSelectedTag} />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Pinning..." : "Pin it"}
      </button>
    </form>
  );
}

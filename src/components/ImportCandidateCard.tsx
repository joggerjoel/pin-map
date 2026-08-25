import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

export interface ImportCandidateCardProps {
  candidate: ImportCandidate;
  mapboxToken: string;
  onApprove: () => void;
  onReject: () => void;
  onDefer: () => void;
  onUpdate: (
    updates: Partial<{
      placeName: string;
      suggestedLat: number;
      suggestedLng: number;
    }>,
  ) => void;
}

export function ImportCandidateCard({
  candidate,
  mapboxToken,
  onApprove,
  onReject,
  onDefer,
  onUpdate,
}: ImportCandidateCardProps) {
  const [name, setName] = useState(candidate.placeName);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const latestQueryRef = useRef("");
  const suppressNextFetchRef = useRef(false);

  useEffect(() => {
    setName(candidate.placeName);
  }, [candidate.placeName]);

  useEffect(() => {
    if (suppressNextFetchRef.current) {
      suppressNextFetchRef.current = false;
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length < 2 || !mapboxToken) {
      setSuggestions([]);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      latestQueryRef.current = trimmed;
      searchPlaces(trimmed, mapboxToken)
        .then((results) => {
          if (latestQueryRef.current === trimmed) setSuggestions(results);
        })
        .catch(() => {
          if (latestQueryRef.current === trimmed) setSuggestions([]);
        });
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [name, mapboxToken]);

  function handleSelectSuggestion(suggestion: GeocodeResult) {
    suppressNextFetchRef.current = true;
    setName(suggestion.name);
    setSuggestions([]);
    onUpdate({
      placeName: suggestion.name,
      suggestedLat: suggestion.lat,
      suggestedLng: suggestion.lng,
    });
  }

  function handleNameBlur() {
    const trimmed = name.trim();
    if (trimmed !== "" && trimmed !== candidate.placeName) {
      onUpdate({ placeName: trimmed });
    }
  }

  const hasCoordinates =
    candidate.suggestedLat !== null && candidate.suggestedLng !== null;
  const visitDate = new Date(candidate.visitTime).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <li className="import-candidate-card">
      <div className="import-candidate-card__header">
        <input
          type="text"
          className="import-candidate-card__name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={handleNameBlur}
          aria-label="Place name"
        />
        <span className="import-candidate-card__date">{visitDate}</span>
      </div>

      {suggestions.length > 0 && (
        <ul
          className="import-candidate-card__suggestions"
          role="listbox"
          aria-label="Place suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.name}-${index}`}>
              <button
                type="button"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                {suggestion.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="import-candidate-card__status">
        {candidate.geocodeConfidence === null && "geocoding…"}
        {candidate.geocodeConfidence === "high" && (
          <span className="import-candidate-card__badge import-candidate-card__badge--high">
            located
          </span>
        )}
        {(candidate.geocodeConfidence === "low" ||
          candidate.geocodeConfidence === "failed") && (
          <span className="import-candidate-card__badge import-candidate-card__badge--low">
            needs a location — search above
          </span>
        )}
      </div>

      {candidate.note && (
        <p className="import-candidate-card__note">{candidate.note}</p>
      )}

      <div className="import-candidate-card__actions">
        <button type="button" onClick={onReject}>
          Reject
        </button>
        <button type="button" onClick={onDefer}>
          Later
        </button>
        <button type="button" onClick={onApprove} disabled={!hasCoordinates}>
          Approve
        </button>
      </div>
    </li>
  );
}

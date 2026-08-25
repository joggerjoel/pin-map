import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { searchPlaces } from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";
import {
  buildGoogleMapsSearchUrl,
  parseGoogleMapsUrl,
  parseLatLngPair,
} from "../lib/googleMaps";
import type {
  CandidateFieldUpdate,
  ImportCandidate,
  SplitPart,
} from "../lib/importCandidatesRepository";

export interface ImportCandidateCardProps {
  candidate: ImportCandidate;
  mapboxToken: string;
  onApprove: () => void;
  onReject: () => void;
  onDefer: () => void;
  onUpdate: (updates: CandidateFieldUpdate) => void;
  /** Omit to hide the "Split into separate pins" action entirely — swipe
   * mode never edits, so it never passes this. */
  onSplit?: (parts: SplitPart[]) => void;
  /** Omit (together with onToggleMergeSelect) to hide the merge checkbox —
   * only grid view offers multi-select-to-merge. */
  isSelectedForMerge?: boolean;
  onToggleMergeSelect?: () => void;
}

export function ImportCandidateCard({
  candidate,
  mapboxToken,
  onApprove,
  onReject,
  onDefer,
  onUpdate,
  onSplit,
  isSelectedForMerge = false,
  onToggleMergeSelect,
}: ImportCandidateCardProps) {
  const [name, setName] = useState(candidate.placeName);
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitParts, setSplitParts] = useState<string[]>(["", ""]);
  const [justSetLocation, setJustSetLocation] = useState(false);
  const latestQueryRef = useRef("");

  useEffect(() => {
    setName(candidate.placeName);
  }, [candidate.placeName]);

  // A dedicated search/paste field, separate from the editable name display
  // above — the name field is just text; this is the "fix a wrong or
  // missing location" action, and always visible rather than hidden inside
  // an editable field's live-search side effect.
  useEffect(() => {
    const trimmed = searchText.trim();
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
  }, [searchText, mapboxToken]);

  // Checking on every keystroke would misfire: "22.35, 114.15" typed
  // character by character passes through "22.35, 1", which itself already
  // matches the lat,lng pattern — applying that prematurely. A paste
  // delivers the whole string atomically (correct by construction), so
  // that's the primary path; blur is a fallback for someone who types
  // coordinates out by hand instead of pasting them.
  function tryApplyCoords(text: string): boolean {
    const trimmed = text.trim();
    const coords = parseGoogleMapsUrl(trimmed) ?? parseLatLngPair(trimmed);
    if (!coords) return false;
    // A manually-supplied coordinate is unambiguous — mark it "high"
    // confidence outright rather than leaving whatever Mapbox's forward
    // geocode had guessed, so the badge visibly confirms the paste/entry
    // took effect instead of silently clearing the field with no feedback.
    onUpdate({
      suggestedLat: coords.lat,
      suggestedLng: coords.lng,
      geocodeConfidence: "high",
    });
    setSearchText("");
    setSuggestions([]);
    setJustSetLocation(true);
    window.setTimeout(() => setJustSetLocation(false), 2500);
    return true;
  }

  function handleSearchTextPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    if (tryApplyCoords(pasted)) {
      event.preventDefault();
    }
  }

  function handleSearchTextBlur() {
    tryApplyCoords(searchText);
  }

  function handleSelectSuggestion(suggestion: GeocodeResult) {
    setName(suggestion.name);
    setSearchText("");
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

  function handleSplitPartChange(index: number, value: string) {
    setSplitParts((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function handleAddSplitPart() {
    setSplitParts((prev) => [...prev, ""]);
  }

  function handleConfirmSplit() {
    const parts = splitParts
      .map((placeName) => placeName.trim())
      .filter((placeName) => placeName !== "")
      .map((placeName) => ({ placeName }));
    if (parts.length < 2) return;
    onSplit?.(parts);
    setShowSplitForm(false);
    setSplitParts(["", ""]);
  }

  function handleCancelSplit() {
    setShowSplitForm(false);
    setSplitParts(["", ""]);
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
        {onToggleMergeSelect && (
          <input
            type="checkbox"
            className="import-candidate-card__merge-select"
            checked={isSelectedForMerge}
            onChange={onToggleMergeSelect}
            aria-label={`Select ${candidate.placeName} for merge`}
          />
        )}
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

      <div className="import-candidate-card__search">
        <input
          type="text"
          className="import-candidate-card__search-input"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onPaste={handleSearchTextPaste}
          onBlur={handleSearchTextBlur}
          placeholder="Search for the right place, or paste a Google Maps link / lat,lng"
          aria-label="Search or paste a map link for this place"
        />
        <a
          className="import-candidate-card__maps-link"
          href={buildGoogleMapsSearchUrl(name)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Google Maps
        </a>
      </div>

      {justSetLocation && (
        <p className="import-candidate-card__location-confirmed" role="status">
          ✓ Location set
        </p>
      )}

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
            needs a location — search below
          </span>
        )}
      </div>

      {candidate.note && (
        <p className="import-candidate-card__note">{candidate.note}</p>
      )}

      {onSplit && !showSplitForm && (
        <button
          type="button"
          className="import-candidate-card__split-toggle"
          onClick={() => setShowSplitForm(true)}
        >
          Split into separate pins
        </button>
      )}

      {onSplit && showSplitForm && (
        <div className="import-candidate-card__split-form">
          {splitParts.map((part, index) => (
            <input
              key={index}
              type="text"
              value={part}
              placeholder={`Part ${index + 1} place name`}
              onChange={(event) =>
                handleSplitPartChange(index, event.target.value)
              }
              aria-label={`Split part ${index + 1} place name`}
            />
          ))}
          <div className="import-candidate-card__split-form-actions">
            <button type="button" onClick={handleAddSplitPart}>
              Add another part
            </button>
            <button type="button" onClick={handleCancelSplit}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSplit}
              disabled={splitParts.filter((p) => p.trim() !== "").length < 2}
            >
              Confirm split
            </button>
          </div>
        </div>
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

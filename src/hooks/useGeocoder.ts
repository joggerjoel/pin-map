import { useCallback, useRef, useState } from "react";
import {
  GeocodeAllFailedError,
  geocodeBatch,
  parseLines,
} from "../lib/geocoder";
import type { GeocodeQuery, GeocodeResult } from "../lib/geocoder";
import { parseChecklist } from "../lib/checklist";
import type { PlaceCategory } from "../lib/checklist";
import { getContinentBbox } from "../lib/continents";
import type { Continent } from "../lib/continents";
import { detectCountryFromLine } from "../lib/countryNames";
import { extractPlaceIcon } from "../lib/placeTags";
import type { PlaceIcon } from "../lib/placeTags";

export interface PinnedPlace extends GeocodeResult {
  category?: PlaceCategory;
  icon?: PlaceIcon;
}

export interface UseGeocoderResult {
  pinnedPlaces: PinnedPlace[];
  failedLines: string[];
  isLoading: boolean;
  error: string | null;
  pinPlaces: (
    raw: string,
    checklistMode?: boolean,
    continent?: Continent | null,
  ) => Promise<void>;
  removePlace: (query: string) => void;
  retry: () => void;
}

export function useGeocoder(token: string): UseGeocoderResult {
  const [pinnedPlaces, setPinnedPlaces] = useState<PinnedPlace[]>([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinnedPlacesRef = useRef<PinnedPlace[]>([]);
  const failedLinesRef = useRef<string[]>([]);
  const lastRawInput = useRef<string>("");
  const lastChecklistMode = useRef<boolean>(false);
  const lastContinent = useRef<Continent | null>(null);

  pinnedPlacesRef.current = pinnedPlaces;
  failedLinesRef.current = failedLines;

  // Shared by pinPlaces (normal submission) and retry (re-attempts failures).
  // `isRetry` controls whether lines already in failedLines are skipped:
  // a normal re-submission of the same text must not re-append duplicates,
  // but retry() must still be able to re-attempt them.
  const runPinPlaces = useCallback(
    async (
      raw: string,
      checklistMode: boolean,
      continent: Continent | null,
      isRetry: boolean,
    ) => {
      lastRawInput.current = raw;
      lastChecklistMode.current = checklistMode;
      lastContinent.current = continent;

      const checklistEntries = checklistMode ? parseChecklist(raw) : [];
      const taggedLines = checklistMode
        ? []
        : parseLines(raw).map((line) => extractPlaceIcon(line));
      const lines = checklistMode
        ? checklistEntries.map((entry) => entry.name)
        : taggedLines.map((tagged) => tagged.query);

      const pinnedKeys = new Set(
        pinnedPlacesRef.current.map((place) => place.query.toLowerCase()),
      );
      const failedKeys = new Set(
        failedLinesRef.current.map((line) => line.toLowerCase()),
      );
      const newLines = lines.filter((line) => {
        const key = line.toLowerCase();
        if (pinnedKeys.has(key)) return false;
        if (!isRetry && failedKeys.has(key)) return false;
        return true;
      });
      if (newLines.length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const bbox =
          !checklistMode && continent ? getContinentBbox(continent) : undefined;
        const entries: GeocodeQuery[] = newLines.map((line) => ({
          query: line,
          country: checklistMode ? "us" : detectCountryFromLine(line),
        }));
        const batch = await geocodeBatch(entries, token, bbox);
        const succeededKeys = new Set(
          batch.pinned.map((place) => place.query.toLowerCase()),
        );
        const newlyPinned: PinnedPlace[] = checklistMode
          ? batch.pinned.map((place) => {
              const entry = checklistEntries.find(
                (candidate) =>
                  candidate.name.toLowerCase() === place.query.toLowerCase(),
              );
              return entry ? { ...place, category: entry.category } : place;
            })
          : batch.pinned.map((place) => {
              const tagged = taggedLines.find(
                (candidate) =>
                  candidate.query.toLowerCase() === place.query.toLowerCase(),
              );
              return tagged?.icon ? { ...place, icon: tagged.icon } : place;
            });
        setPinnedPlaces((prev) => [...prev, ...newlyPinned]);
        setFailedLines((prev) => {
          const survivors = prev.filter(
            (line) => !succeededKeys.has(line.toLowerCase()),
          );
          const survivorKeys = new Set(
            survivors.map((line) => line.toLowerCase()),
          );
          const additions = batch.failed.filter(
            (line) => !survivorKeys.has(line.toLowerCase()),
          );
          return [...survivors, ...additions];
        });
      } catch (err) {
        if (err instanceof GeocodeAllFailedError && err.isAuthError) {
          setError("That Mapbox token was rejected — check it and try again.");
        } else {
          setError(
            "Couldn't reach Mapbox. Check your connection and try again.",
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  const pinPlaces = useCallback(
    (raw: string, checklistMode = false, continent: Continent | null = null) =>
      runPinPlaces(raw, checklistMode, continent, false),
    [runPinPlaces],
  );

  const removePlace = useCallback((query: string) => {
    setPinnedPlaces((prev) => prev.filter((place) => place.query !== query));
  }, []);

  const retry = useCallback(() => {
    void runPinPlaces(
      lastRawInput.current,
      lastChecklistMode.current,
      lastContinent.current,
      true,
    );
  }, [runPinPlaces]);

  return {
    pinnedPlaces,
    failedLines,
    isLoading,
    error,
    pinPlaces,
    removePlace,
    retry,
  };
}

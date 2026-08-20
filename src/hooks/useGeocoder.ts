import { useCallback, useRef, useState } from "react";
import {
  GeocodeAllFailedError,
  geocodeBatch,
  geocodeLine,
  parseLines,
} from "../lib/geocoder";
import type { GeocodeQuery, GeocodeResult } from "../lib/geocoder";
import { looksLikeChecklistRow, parseChecklistLine } from "../lib/checklist";
import type { PlaceCategory } from "../lib/checklist";
import { getContinentBbox } from "../lib/continents";
import type { Continent } from "../lib/continents";
import { detectCountryFromLine } from "../lib/countryNames";
import { extractPlaceIcon } from "../lib/placeTags";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import { extractExplicitCoords } from "../lib/explicitCoords";

export interface PinnedPlace extends GeocodeResult {
  category?: PlaceCategory;
  icon?: PlaceIcon;
  customTag?: CustomTag;
}

interface ProcessedLine {
  query: string;
  category?: PlaceCategory;
  icon?: PlaceIcon;
  country?: string;
  explicitCoords?: { lat: number; lng: number };
}

// Every pasted line is independently checked for checklist shape ("9 Florida
// X") rather than branching a whole submission between checklist/plain
// modes — this is what lets a single paste mix state-checklist rows with
// plain free-form addresses.
function processLine(line: string): ProcessedLine | null {
  if (looksLikeChecklistRow(line)) {
    const parsed = parseChecklistLine(line);
    if (parsed === null) {
      return null; // unmarked checklist row — intentionally skipped
    }
    return { query: parsed.name, category: parsed.category, country: "us" };
  }
  const { query, icon } = extractPlaceIcon(line);
  const explicit = extractExplicitCoords(query);
  if (explicit !== null) {
    return {
      query: explicit.name,
      icon,
      explicitCoords: { lat: explicit.lat, lng: explicit.lng },
    };
  }
  return { query, icon, country: detectCountryFromLine(query) };
}

function hasExplicitCoords(
  processed: ProcessedLine,
): processed is ProcessedLine & {
  explicitCoords: { lat: number; lng: number };
} {
  return processed.explicitCoords !== undefined;
}

export interface UseGeocoderResult {
  pinnedPlaces: PinnedPlace[];
  failedLines: string[];
  isLoading: boolean;
  error: string | null;
  pinPlaces: (raw: string, continent?: Continent | null) => Promise<void>;
  pinPlace: (
    query: string,
    tag: { category?: PlaceCategory; icon?: PlaceIcon; customTag?: CustomTag },
  ) => Promise<void>;
  removePlace: (query: string) => void;
  changeTag: (
    query: string,
    tag: { category?: PlaceCategory; icon?: PlaceIcon; customTag?: CustomTag },
  ) => void;
  reorderPlaces: (fromIndex: number, toIndex: number) => void;
  retry: () => void;
  relocatePlace: (query: string, searchText: string) => Promise<void>;
  setLocation: (query: string, lat: number, lng: number) => void;
}

export function useGeocoder(token: string): UseGeocoderResult {
  const [pinnedPlaces, setPinnedPlaces] = useState<PinnedPlace[]>([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinnedPlacesRef = useRef<PinnedPlace[]>([]);
  const failedLinesRef = useRef<string[]>([]);
  const lastRawInput = useRef<string>("");
  const lastContinent = useRef<Continent | null>(null);

  pinnedPlacesRef.current = pinnedPlaces;
  failedLinesRef.current = failedLines;

  // Shared by pinPlaces (normal submission) and retry (re-attempts failures).
  // `isRetry` controls whether lines already in failedLines are skipped:
  // a normal re-submission of the same text must not re-append duplicates,
  // but retry() must still be able to re-attempt them.
  const runPinPlaces = useCallback(
    async (raw: string, continent: Continent | null, isRetry: boolean) => {
      lastRawInput.current = raw;
      lastContinent.current = continent;

      const processedLines = parseLines(raw)
        .map((line) => processLine(line))
        .filter((processed): processed is ProcessedLine => processed !== null);

      const pinnedKeys = new Set(
        pinnedPlacesRef.current.map((place) => place.query.toLowerCase()),
      );
      const failedKeys = new Set(
        failedLinesRef.current.map((line) => line.toLowerCase()),
      );
      const newProcessedLines = processedLines.filter((processed) => {
        const key = processed.query.toLowerCase();
        if (pinnedKeys.has(key)) return false;
        if (!isRetry && failedKeys.has(key)) return false;
        return true;
      });
      if (newProcessedLines.length === 0) {
        return;
      }

      const explicitLines = newProcessedLines.filter(hasExplicitCoords);
      const linesToGeocode = newProcessedLines.filter(
        (processed) => !hasExplicitCoords(processed),
      );

      if (explicitLines.length > 0) {
        const explicitlyPinned: PinnedPlace[] = explicitLines.map(
          (processed) => ({
            query: processed.query,
            name: processed.query,
            lat: processed.explicitCoords.lat,
            lng: processed.explicitCoords.lng,
            category: processed.category,
            icon: processed.icon,
          }),
        );
        setPinnedPlaces((prev) => [...prev, ...explicitlyPinned]);
      }

      if (linesToGeocode.length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const bbox = continent ? getContinentBbox(continent) : undefined;
        const entries: GeocodeQuery[] = linesToGeocode.map((processed) => ({
          query: processed.query,
          country: processed.country,
        }));
        const batch = await geocodeBatch(entries, token, bbox);
        const succeededKeys = new Set(
          batch.pinned.map((place) => place.query.toLowerCase()),
        );
        const newlyPinned: PinnedPlace[] = batch.pinned.map((place) => {
          const processed = linesToGeocode.find(
            (candidate) =>
              candidate.query.toLowerCase() === place.query.toLowerCase(),
          );
          if (processed === undefined) {
            return place;
          }
          return {
            ...place,
            category: processed.category,
            icon: processed.icon,
          };
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
    (raw: string, continent: Continent | null = null) =>
      runPinPlaces(raw, continent, false),
    [runPinPlaces],
  );

  const pinPlace = useCallback(
    async (
      query: string,
      tag: {
        category?: PlaceCategory;
        icon?: PlaceIcon;
        customTag?: CustomTag;
      },
    ) => {
      const trimmed = query.trim();
      if (trimmed === "") {
        return;
      }
      const key = trimmed.toLowerCase();
      if (
        pinnedPlacesRef.current.some(
          (place) => place.query.toLowerCase() === key,
        )
      ) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await geocodeLine(trimmed, token);
        if (result === null) {
          setFailedLines((prev) =>
            prev.some((line) => line.toLowerCase() === key)
              ? prev
              : [...prev, trimmed],
          );
          return;
        }
        setPinnedPlaces((prev) => [...prev, { ...result, ...tag }]);
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

  const removePlace = useCallback((query: string) => {
    setPinnedPlaces((prev) => prev.filter((place) => place.query !== query));
  }, []);

  const changeTag = useCallback(
    (
      query: string,
      tag: {
        category?: PlaceCategory;
        icon?: PlaceIcon;
        customTag?: CustomTag;
      },
    ) => {
      setPinnedPlaces((prev) =>
        prev.map((place) =>
          place.query === query
            ? {
                ...place,
                category: tag.category,
                icon: tag.icon,
                customTag: tag.customTag,
              }
            : place,
        ),
      );
    },
    [],
  );

  const reorderPlaces = useCallback((fromIndex: number, toIndex: number) => {
    setPinnedPlaces((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  const retry = useCallback(() => {
    void runPinPlaces(lastRawInput.current, lastContinent.current, true);
  }, [runPinPlaces]);

  const setLocation = useCallback((query: string, lat: number, lng: number) => {
    setPinnedPlaces((prev) =>
      prev.map((place) =>
        place.query === query ? { ...place, lat, lng } : place,
      ),
    );
  }, []);

  const relocatePlace = useCallback(
    async (query: string, searchText: string) => {
      const trimmed = searchText.trim();
      if (trimmed === "") {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const result = await geocodeLine(trimmed, token);
        if (result === null) {
          setError(`Couldn't find "${trimmed}".`);
          return;
        }
        setPinnedPlaces((prev) =>
          prev.map((place) =>
            place.query === query
              ? {
                  ...place,
                  name: result.name,
                  lat: result.lat,
                  lng: result.lng,
                }
              : place,
          ),
        );
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

  return {
    pinnedPlaces,
    failedLines,
    isLoading,
    error,
    pinPlaces,
    pinPlace,
    removePlace,
    changeTag,
    reorderPlaces,
    retry,
    relocatePlace,
    setLocation,
  };
}

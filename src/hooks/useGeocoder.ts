import { useCallback, useRef, useState } from "react";
import {
  GeocodeAllFailedError,
  geocodeBatch,
  parseLines,
} from "../lib/geocoder";
import type { GeocodeResult } from "../lib/geocoder";

export interface UseGeocoderResult {
  pinnedPlaces: GeocodeResult[];
  failedLines: string[];
  isLoading: boolean;
  error: string | null;
  pinPlaces: (raw: string) => Promise<void>;
  removePlace: (query: string) => void;
  retry: () => void;
}

export function useGeocoder(token: string): UseGeocoderResult {
  const [pinnedPlaces, setPinnedPlaces] = useState<GeocodeResult[]>([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinnedPlacesRef = useRef<GeocodeResult[]>([]);
  const failedLinesRef = useRef<string[]>([]);
  const lastRawInput = useRef<string>("");

  pinnedPlacesRef.current = pinnedPlaces;
  failedLinesRef.current = failedLines;

  // Shared by pinPlaces (normal submission) and retry (re-attempts failures).
  // `isRetry` controls whether lines already in failedLines are skipped:
  // a normal re-submission of the same text must not re-append duplicates,
  // but retry() must still be able to re-attempt them.
  const runPinPlaces = useCallback(
    async (raw: string, isRetry: boolean) => {
      lastRawInput.current = raw;
      const lines = parseLines(raw);
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
        const batch = await geocodeBatch(newLines, token);
        const succeededKeys = new Set(
          batch.pinned.map((place) => place.query.toLowerCase()),
        );
        setPinnedPlaces((prev) => [...prev, ...batch.pinned]);
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
    (raw: string) => runPinPlaces(raw, false),
    [runPinPlaces],
  );

  const removePlace = useCallback((query: string) => {
    setPinnedPlaces((prev) => prev.filter((place) => place.query !== query));
  }, []);

  const retry = useCallback(() => {
    void runPinPlaces(lastRawInput.current, true);
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

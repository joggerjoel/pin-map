import { useCallback, useRef, useState } from "react";
import { geocodeBatch, parseLines } from "../lib/geocoder";
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
  const lastRawInput = useRef<string>("");

  pinnedPlacesRef.current = pinnedPlaces;

  const pinPlaces = useCallback(
    async (raw: string) => {
      lastRawInput.current = raw;
      const lines = parseLines(raw);
      const existingKeys = new Set(
        pinnedPlacesRef.current.map((place) => place.query.toLowerCase()),
      );
      const newLines = lines.filter(
        (line) => !existingKeys.has(line.toLowerCase()),
      );
      if (newLines.length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const batch = await geocodeBatch(newLines, token);
        setPinnedPlaces((prev) => [...prev, ...batch.pinned]);
        setFailedLines((prev) => [...prev, ...batch.failed]);
      } catch {
        setError("Couldn't reach Mapbox. Check your connection and try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  const removePlace = useCallback((query: string) => {
    setPinnedPlaces((prev) => prev.filter((place) => place.query !== query));
  }, []);

  const retry = useCallback(() => {
    void pinPlaces(lastRawInput.current);
  }, [pinPlaces]);

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

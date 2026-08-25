import { useCallback, useEffect, useRef, useState } from "react";
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
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import { extractDatePrefix } from "../lib/datePrefix";
import { resolvePlainLineName } from "../lib/plainLineName";
import {
  fetchPins,
  upsertPins,
  updatePinFields,
  deletePin,
} from "../lib/pinsRepository";
import { incrementPlacesPinned } from "../lib/tokenUsage";

export interface PinnedPlace extends GeocodeResult {
  category?: PlaceCategory;
  icon?: PlaceIcon;
  customTag?: CustomTag;
  date?: string;
}

export type PinPlaceResult =
  | { status: "ok"; query: string }
  | { status: "invalid" }
  | { status: "geocode-error" }
  | { status: "persistence-error" };

interface ProcessedLine {
  query: string;
  category?: PlaceCategory;
  icon?: PlaceIcon;
  country?: string;
  explicitCoords?: { lat: number; lng: number };
  date?: string;
}

// Every pasted line is independently checked for checklist shape ("9 Florida
// X") rather than branching a whole submission between checklist/plain
// modes — this is what lets a single paste mix state-checklist rows with
// plain free-form addresses.
function processLine(line: string): ProcessedLine | null {
  const dateMatch = extractDatePrefix(line);
  const workingLine = dateMatch ? dateMatch.rest : line;
  const date = dateMatch?.date;

  if (looksLikeChecklistRow(workingLine)) {
    const parsed = parseChecklistLine(workingLine);
    if (parsed === null) {
      return null; // unmarked checklist row — intentionally skipped
    }
    return {
      query: parsed.name,
      category: parsed.category,
      country: "us",
      date,
    };
  }
  const plain = resolvePlainLineName(workingLine);
  if (plain.explicitCoords !== undefined) {
    return {
      query: plain.name,
      icon: plain.icon,
      explicitCoords: plain.explicitCoords,
      date,
    };
  }
  return {
    query: plain.name,
    icon: plain.icon,
    country: detectCountryFromLine(plain.name),
    date,
  };
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
  pinPlaceSilent: (
    query: string,
    tag: { category?: PlaceCategory; icon?: PlaceIcon; customTag?: CustomTag },
  ) => Promise<PinPlaceResult>;
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

export interface UseGeocoderOptions {
  userId?: string | null;
  ownerUserId?: string | null;
  customTags?: CustomTag[];
}

export function useGeocoder(
  token: string,
  options: UseGeocoderOptions = {},
): UseGeocoderResult {
  const { userId = null, ownerUserId = null, customTags = [] } = options;
  const [pinnedPlaces, setPinnedPlaces] = useState<PinnedPlace[]>([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinnedPlacesRef = useRef<PinnedPlace[]>([]);
  const failedLinesRef = useRef<string[]>([]);
  const pendingPinsRef = useRef<Map<string, Promise<PinPlaceResult>>>(
    new Map(),
  );
  const lastRawInput = useRef<string>("");
  const lastContinent = useRef<Continent | null>(null);

  pinnedPlacesRef.current = pinnedPlaces;
  failedLinesRef.current = failedLines;

  useEffect(() => {
    const targetUserId = userId ?? ownerUserId;
    if (targetUserId === null) {
      setPinnedPlaces([]);
      return;
    }
    let cancelled = false;
    fetchPins(targetUserId, customTags).then((fetched) => {
      if (!cancelled) {
        setPinnedPlaces(fetched);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ownerUserId]);

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

      const pinnedByKey = new Map(
        pinnedPlacesRef.current.map((place) => [
          place.query.toLowerCase(),
          place,
        ]),
      );
      const failedKeys = new Set(
        failedLinesRef.current.map((line) => line.toLowerCase()),
      );
      // A re-pasted line for an already-pinned place is normally a no-op
      // (avoids re-geocoding on every resubmit of the same text), but if it
      // carries a *different* tag than the place currently has, that's a
      // deliberate re-tag request (e.g. adding "(ski)" to a place pinned
      // before that tag existed) — apply it without re-geocoding, since the
      // coordinates are already known.
      const tagUpdates: { existingQuery: string; processed: ProcessedLine }[] =
        [];
      const newProcessedLines = processedLines.filter((processed) => {
        if (processed.explicitCoords !== undefined) {
          return true;
        }
        const key = processed.query.toLowerCase();
        const existing = pinnedByKey.get(key);
        if (existing !== undefined) {
          const hasTag =
            processed.category !== undefined || processed.icon !== undefined;
          if (
            hasTag &&
            (existing.category !== processed.category ||
              existing.icon !== processed.icon)
          ) {
            tagUpdates.push({ existingQuery: existing.query, processed });
          }
          return false;
        }
        if (!isRetry && failedKeys.has(key)) return false;
        return true;
      });

      if (tagUpdates.length > 0) {
        setPinnedPlaces((prev) =>
          prev.map((place) => {
            const match = tagUpdates.find(
              (update) => update.existingQuery === place.query,
            );
            if (match === undefined) {
              return place;
            }
            return {
              ...place,
              category: match.processed.category,
              icon: match.processed.icon,
              customTag: undefined,
            };
          }),
        );
        if (userId !== null) {
          for (const { existingQuery, processed } of tagUpdates) {
            void updatePinFields(userId, existingQuery, {
              category: processed.category ?? null,
              icon: processed.icon ?? null,
              custom_tag_id: null,
            });
          }
        }
      }

      if (newProcessedLines.length === 0) {
        return;
      }

      const explicitLines = newProcessedLines.filter(hasExplicitCoords);
      const linesToGeocode = newProcessedLines.filter(
        (processed) => !hasExplicitCoords(processed),
      );

      if (explicitLines.length > 0) {
        const explicitKeys = new Set(
          explicitLines.map((processed) => processed.query.toLowerCase()),
        );
        setPinnedPlaces((prev) => {
          const updated = prev.map((place) => {
            const match = explicitLines.find(
              (processed) =>
                processed.query.toLowerCase() === place.query.toLowerCase(),
            );
            if (match === undefined) {
              return place;
            }
            return {
              ...place,
              query: match.query,
              name: match.query,
              lat: match.explicitCoords.lat,
              lng: match.explicitCoords.lng,
              category: match.category,
              icon: match.icon,
              date: match.date,
            };
          });
          const alreadyPinnedKeys = new Set(
            prev.map((place) => place.query.toLowerCase()),
          );
          const newlyAdded: PinnedPlace[] = explicitLines
            .filter(
              (processed) =>
                !alreadyPinnedKeys.has(processed.query.toLowerCase()),
            )
            .map((processed) => ({
              query: processed.query,
              name: processed.query,
              lat: processed.explicitCoords.lat,
              lng: processed.explicitCoords.lng,
              category: processed.category,
              icon: processed.icon,
              date: processed.date,
            }));
          return [...updated, ...newlyAdded];
        });
        setFailedLines((prev) =>
          prev.filter((line) => !explicitKeys.has(line.toLowerCase())),
        );
        if (userId !== null) {
          void upsertPins(
            userId,
            explicitLines.map((processed) => ({
              query: processed.query,
              name: processed.query,
              lat: processed.explicitCoords.lat,
              lng: processed.explicitCoords.lng,
              category: processed.category,
              icon: processed.icon,
              date: processed.date,
            })),
          );
          void incrementPlacesPinned(explicitLines.length);
        }
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
            date: processed.date,
          };
        });
        setPinnedPlaces((prev) => [...prev, ...newlyPinned]);
        if (userId !== null) {
          void upsertPins(userId, newlyPinned);
          void incrementPlacesPinned(newlyPinned.length);
        }
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
    [token, userId],
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
        if (userId !== null) {
          void upsertPins(userId, [{ ...result, ...tag }]);
          void incrementPlacesPinned(1);
        }
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
    [token, userId],
  );

  // A pure sibling to pinPlace, for the unsorted-photo triage panel: it
  // shares the same geocode-then-persist mechanics but never mutates
  // `error`/`failedLines`, since the panel replaces AddPin/PlaceInput while
  // open and has no surface for that shared state to appear on. Returns a
  // discriminated result instead so the caller decides what to do.
  const pinPlaceSilent = useCallback(
    async (
      query: string,
      tag: {
        category?: PlaceCategory;
        icon?: PlaceIcon;
        customTag?: CustomTag;
      },
    ): Promise<PinPlaceResult> => {
      const trimmed = query.trim();
      if (trimmed === "") {
        return { status: "invalid" };
      }
      const key = trimmed.toLowerCase();

      const existing = pinnedPlacesRef.current.find(
        (place) => place.query.toLowerCase() === key,
      );
      if (existing !== undefined) {
        return { status: "ok", query: existing.query };
      }

      const pending = pendingPinsRef.current.get(key);
      if (pending !== undefined) {
        return pending;
      }

      const attempt = (async (): Promise<PinPlaceResult> => {
        let result: GeocodeResult | null;
        try {
          result = await geocodeLine(trimmed, token);
        } catch {
          return { status: "geocode-error" };
        }
        if (result === null) {
          return { status: "geocode-error" };
        }
        const newPlace = { ...result, ...tag };
        setPinnedPlaces((prev) => [...prev, newPlace]);
        if (userId === null) {
          return { status: "ok", query: trimmed };
        }
        const upsertResult = await upsertPins(userId, [newPlace]);
        if (upsertResult === "error") {
          setPinnedPlaces((prev) =>
            prev.filter((place) => place.query !== trimmed),
          );
          return { status: "persistence-error" };
        }
        void incrementPlacesPinned(1);
        return { status: "ok", query: trimmed };
      })();
      pendingPinsRef.current.set(key, attempt);
      attempt.finally(() => pendingPinsRef.current.delete(key));
      return attempt;
    },
    [token, userId],
  );

  const removePlace = useCallback(
    (query: string) => {
      setPinnedPlaces((prev) => prev.filter((place) => place.query !== query));
      if (userId !== null) {
        void deletePin(userId, query);
      }
    },
    [userId],
  );

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
      if (userId !== null) {
        void updatePinFields(userId, query, {
          category: tag.category ?? null,
          icon: tag.icon ?? null,
          custom_tag_id: tag.customTag?.id ?? null,
        });
      }
    },
    [userId],
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

  const setLocation = useCallback(
    (query: string, lat: number, lng: number) => {
      setPinnedPlaces((prev) =>
        prev.map((place) =>
          place.query === query ? { ...place, lat, lng } : place,
        ),
      );
      if (userId !== null) {
        void updatePinFields(userId, query, { lat, lng });
      }
    },
    [userId],
  );

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
        if (userId !== null) {
          void updatePinFields(userId, query, {
            name: result.name,
            lat: result.lat,
            lng: result.lng,
          });
        }
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
    [token, userId],
  );

  return {
    pinnedPlaces,
    failedLines,
    isLoading,
    error,
    pinPlaces,
    pinPlace,
    pinPlaceSilent,
    removePlace,
    changeTag,
    reorderPlaces,
    retry,
    relocatePlace,
    setLocation,
  };
}

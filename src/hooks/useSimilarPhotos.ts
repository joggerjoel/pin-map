import { useCallback, useRef, useState } from "react";
import { findSimilarPhotos } from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";

// A fixed UI cap, separate from the RPC's own 100-row request
// (image-group-plan.md, "More like this").
export const SIMILAR_PHOTOS_DISPLAY_LIMIT = 24;

export interface UseSimilarPhotosResult {
  isActive: boolean;
  sourcePhoto: UnsortedPhoto | null;
  isLoading: boolean;
  // Already status-filtered (if a filter was given) and capped to the
  // display limit -- this is "N" in "showing N of M".
  results: UnsortedPhoto[];
  // The RPC's actual returned row count, before status-filtering or the
  // display cap -- this is "M". Not the same as results.length once a
  // status filter drops some of the raw candidates.
  totalReturned: number;
  enter: (photo: UnsortedPhoto) => void;
  exit: () => void;
}

// The client-side triage-status filter (undefined on status-agnostic
// surfaces like the Browse view or a group's member view, since neither is
// scoped to one status).
export function useSimilarPhotos(
  statusFilter?: (photo: UnsortedPhoto) => boolean,
): UseSimilarPhotosResult {
  const [sourcePhoto, setSourcePhoto] = useState<UnsortedPhoto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [allResults, setAllResults] = useState<UnsortedPhoto[]>([]);
  const generationRef = useRef(0);

  const enter = useCallback((photo: UnsortedPhoto) => {
    const generation = ++generationRef.current;
    setSourcePhoto(photo);
    setIsLoading(true);
    setAllResults([]);
    findSimilarPhotos(photo.id).then((result) => {
      if (generationRef.current !== generation) return;
      setIsLoading(false);
      setAllResults(result ?? []);
    });
  }, []);

  const exit = useCallback(() => {
    generationRef.current += 1;
    setSourcePhoto(null);
    setAllResults([]);
    setIsLoading(false);
  }, []);

  const filtered = statusFilter ? allResults.filter(statusFilter) : allResults;

  return {
    isActive: sourcePhoto !== null,
    sourcePhoto,
    isLoading,
    results: filtered.slice(0, SIMILAR_PHOTOS_DISPLAY_LIMIT),
    totalReturned: allResults.length,
    enter,
    exit,
  };
}

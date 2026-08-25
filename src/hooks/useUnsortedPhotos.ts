import { useCallback, useEffect, useRef, useState } from "react";
import { assignPhotoPlace, fetchUnsortedPhotos } from "../lib/photosRepository";
import type {
  UnsortedPhoto,
  UnsortedPhotoCursor,
} from "../lib/photosRepository";

const PAGE_SIZE = 60;

export interface UseUnsortedPhotosResult {
  photos: UnsortedPhoto[];
  isInitialLoading: boolean;
  photosLoadError: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
  assign: (
    photo: UnsortedPhoto,
    placeQuery: string,
  ) => Promise<"ok" | "conflict" | "error">;
}

export function useUnsortedPhotos(userId: string): UseUnsortedPhotosResult {
  const [photos, setPhotos] = useState<UnsortedPhoto[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [photosLoadError, setPhotosLoadError] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<UnsortedPhotoCursor | null>(null);
  const generationRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isInitialLoadingRef = useRef(true);
  // The count backing the "did this assign drain the grid?" check in
  // `assign`, updated synchronously and independent of React's state/render
  // timing — `photos` (state) is the source of truth for what renders, but
  // reading it back via a ref synced during render is unreliable here: a
  // setState updater's side effect can't safely live inside the updater,
  // and calling something right after `setPhotos()` can't assume the
  // updater has already run (React doesn't guarantee that). A dedicated
  // counter, incremented on every successful page fetch and decremented on
  // every successful assign, has no such timing dependency.
  const remainingRef = useRef(0);

  const loadInitial = useCallback(() => {
    const generation = ++generationRef.current;
    isInitialLoadingRef.current = true;
    setIsInitialLoading(true);
    setPhotosLoadError(false);
    fetchUnsortedPhotos(userId, { limit: PAGE_SIZE, after: null }).then(
      (result) => {
        if (generationRef.current !== generation) return;
        isInitialLoadingRef.current = false;
        setIsInitialLoading(false);
        if (result === null) {
          setPhotosLoadError(true);
          return;
        }
        setPhotos(result);
        remainingRef.current = result.length;
        setHasMore(result.length === PAGE_SIZE);
        const last = result[result.length - 1];
        cursorRef.current = last
          ? { createdAt: last.createdAt, id: last.id }
          : null;
      },
    );
  }, [userId]);

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || isInitialLoadingRef.current) {
      return;
    }
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const generation = generationRef.current;
    fetchUnsortedPhotos(userId, {
      limit: PAGE_SIZE,
      after: cursorRef.current,
    }).then((result) => {
      isLoadingMoreRef.current = false;
      if (generationRef.current !== generation) return;
      setIsLoadingMore(false);
      if (result === null) {
        setLoadMoreError(true);
        return;
      }
      setLoadMoreError(false);
      setHasMore(result.length === PAGE_SIZE);
      if (result.length > 0) {
        const last = result[result.length - 1];
        cursorRef.current = { createdAt: last.createdAt, id: last.id };
        remainingRef.current += result.length;
        setPhotos((prev) => [...prev, ...result]);
      }
    });
  }, [userId]);

  const retry = useCallback(() => {
    if (isInitialLoadingRef.current) {
      return;
    }
    loadInitial();
  }, [loadInitial]);

  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const assign = useCallback(
    async (photo: UnsortedPhoto, placeQuery: string) => {
      const result = await assignPhotoPlace(photo.id, placeQuery);
      if (result === "ok" || result === "conflict") {
        // The functional updater form is required for correctness — several
        // `assign` calls can be in flight close together (assigning several
        // photos in quick succession), and each must filter against the
        // *actual* latest `photos`, not a value captured at call time.
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
        remainingRef.current -= 1;
        if (remainingRef.current <= 0 && hasMoreRef.current) {
          loadMore();
        }
      }
      return result;
    },
    [loadMore],
  );

  return {
    photos,
    isInitialLoading,
    photosLoadError,
    isLoadingMore,
    loadMoreError,
    hasMore,
    loadMore,
    retry,
    assign,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAllPhotos } from "../lib/photosRepository";
import type {
  PhotoTagFilter,
  UnsortedPhoto,
  UnsortedPhotoCursor,
} from "../lib/photosRepository";

const PAGE_SIZE = 60;

export interface UseAllPhotosResult {
  photos: UnsortedPhoto[];
  isInitialLoading: boolean;
  photosLoadError: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

// Sibling to useUnsortedPhotos, not a variant of it -- serves the Browse
// view and a group's member view (via `groupId`), neither of which is
// scoped to a single triage status, so there's no assign/skip/unskip/
// unassign surface here the way there is in useUnsortedPhotos.
export function useAllPhotos(
  userId: string,
  { tag, groupId }: { tag?: PhotoTagFilter; groupId?: string } = {},
): UseAllPhotosResult {
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
  const tagRef = useRef(tag);
  tagRef.current = tag;
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const loadInitial = useCallback(() => {
    const generation = ++generationRef.current;
    isInitialLoadingRef.current = true;
    setIsInitialLoading(true);
    setPhotosLoadError(false);
    fetchAllPhotos(userId, {
      limit: PAGE_SIZE,
      after: null,
      tag: tagRef.current,
      groupId: groupIdRef.current,
    }).then((result) => {
      if (generationRef.current !== generation) return;
      isInitialLoadingRef.current = false;
      setIsInitialLoading(false);
      if (result === null) {
        setPhotosLoadError(true);
        return;
      }
      setPhotos(result);
      setHasMore(result.length === PAGE_SIZE);
      const last = result[result.length - 1];
      cursorRef.current = last
        ? { createdAt: last.createdAt, id: last.id }
        : null;
    });
  }, [userId]);

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tag, groupId]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || isInitialLoadingRef.current) {
      return;
    }
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const generation = generationRef.current;
    fetchAllPhotos(userId, {
      limit: PAGE_SIZE,
      after: cursorRef.current,
      tag: tagRef.current,
      groupId: groupIdRef.current,
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

  return {
    photos,
    isInitialLoading,
    photosLoadError,
    isLoadingMore,
    loadMoreError,
    hasMore,
    loadMore,
    retry,
  };
}

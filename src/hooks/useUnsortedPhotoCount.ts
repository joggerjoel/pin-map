import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUnsortedPhotoCount } from "../lib/photosRepository";

export interface UseUnsortedPhotoCountResult {
  totalCount: number | null;
  refetch: () => void;
  decrement: () => void;
  markEmpty: () => void;
}

export function useUnsortedPhotoCount(
  userId: string | null,
): UseUnsortedPhotoCountResult {
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const generationRef = useRef(0);

  const fetchCount = useCallback(() => {
    if (userId === null) {
      return;
    }
    const generation = ++generationRef.current;
    fetchUnsortedPhotoCount(userId).then((count) => {
      if (generationRef.current === generation) {
        setTotalCount(count);
      }
    });
  }, [userId]);

  useEffect(() => {
    generationRef.current += 1; // invalidate any in-flight fetch for a prior userId
    if (userId === null) {
      setTotalCount(null);
      return;
    }
    setTotalCount(null);
    fetchCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      return;
    }
    const onFocus = () => fetchCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [userId, fetchCount]);

  const decrement = useCallback(() => {
    setTotalCount((prev) => (prev === null ? null : Math.max(0, prev - 1)));
  }, []);

  const markEmpty = useCallback(() => {
    setTotalCount(0);
  }, []);

  return { totalCount, refetch: fetchCount, decrement, markEmpty };
}

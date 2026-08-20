import { useCallback, useEffect, useMemo, useState } from "react";
import { deletePhoto, fetchPhotos, uploadPhoto } from "../lib/photosRepository";
import type { PlacePhoto } from "../lib/photosRepository";

export interface UsePhotosResult {
  photosByQuery: Record<string, PlacePhoto[]>;
  addPhoto: (placeQuery: string, file: File) => Promise<void>;
  removePhoto: (photo: PlacePhoto) => void;
}

export function usePhotos(
  userId: string | null,
  ownerUserId: string | null,
): UsePhotosResult {
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);

  useEffect(() => {
    const targetUserId = userId ?? ownerUserId;
    if (targetUserId === null) {
      setPhotos([]);
      return;
    }
    let cancelled = false;
    fetchPhotos(targetUserId).then((fetched) => {
      if (!cancelled) {
        setPhotos(fetched);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, ownerUserId]);

  const addPhoto = useCallback(
    async (placeQuery: string, file: File) => {
      if (userId === null) {
        return;
      }
      const uploaded = await uploadPhoto(userId, placeQuery, file);
      if (uploaded !== null) {
        setPhotos((prev) => [...prev, uploaded]);
      }
    },
    [userId],
  );

  const removePhoto = useCallback(
    (photo: PlacePhoto) => {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      if (userId !== null) {
        void deletePhoto(userId, photo);
      }
    },
    [userId],
  );

  // Memoized so the returned object keeps a stable identity across renders
  // that don't actually change `photos` — MapView's marker-rebuild effect
  // depends on this reference, and an identity change on every render
  // (regardless of content) would tear down and recreate every marker on
  // every App re-render, including mid-click while a popup is opening.
  const photosByQuery = useMemo(() => {
    const result: Record<string, PlacePhoto[]> = {};
    for (const photo of photos) {
      (result[photo.placeQuery] ??= []).push(photo);
    }
    return result;
  }, [photos]);

  return { photosByQuery, addPhoto, removePhoto };
}

import { useCallback, useEffect, useState } from "react";
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

  const photosByQuery: Record<string, PlacePhoto[]> = {};
  for (const photo of photos) {
    (photosByQuery[photo.placeQuery] ??= []).push(photo);
  }

  return { photosByQuery, addPhoto, removePhoto };
}

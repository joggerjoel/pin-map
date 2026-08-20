import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchRosterPhotos,
  uploadRosterPhoto,
} from "../lib/classRosterPhotosRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";

export interface UseRosterPhotosResult {
  photosByPersonId: Record<number, RosterPersonPhoto[]>;
  addPhoto: (
    personId: number,
    file: File,
    year: number | null,
  ) => Promise<void>;
}

export function useRosterPhotos(
  classSlug: string,
  userId: string,
): UseRosterPhotosResult {
  const [photos, setPhotos] = useState<RosterPersonPhoto[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchRosterPhotos(classSlug).then((fetched) => {
      if (!cancelled) {
        setPhotos(fetched);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  const addPhoto = useCallback(
    async (personId: number, file: File, year: number | null) => {
      if (userId === "") {
        return;
      }
      const uploaded = await uploadRosterPhoto(
        userId,
        classSlug,
        personId,
        year,
        file,
      );
      if (uploaded !== null) {
        setPhotos((prev) => [...prev, uploaded]);
      }
    },
    [classSlug, userId],
  );

  const photosByPersonId = useMemo(() => {
    const result: Record<number, RosterPersonPhoto[]> = {};
    for (const photo of photos) {
      (result[photo.personId] ??= []).push(photo);
    }
    return result;
  }, [photos]);

  return { photosByPersonId, addPhoto };
}

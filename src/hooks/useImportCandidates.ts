import { useCallback, useEffect, useState } from "react";
import {
  approveCandidate,
  deferCandidate,
  fetchReviewableCandidates,
  insertCandidates,
  rejectCandidate,
  updateCandidateFields,
  updateCandidateGeocode,
  type ImportCandidate,
} from "../lib/importCandidatesRepository";
import {
  geocodeCandidates,
  parseExport,
  uploadExportFile,
  type UploadProgress,
} from "../lib/fbImportRelayClient";

export type UploadState =
  "idle" | "uploading" | "parsing" | "geocoding" | "done" | "error";

export interface UseImportCandidatesResult {
  candidates: ImportCandidate[];
  isLoadingCandidates: boolean;
  uploadState: UploadState;
  uploadProgress: number | null;
  uploadStatusMessage: string | null;
  uploadError: string | null;
  startUpload: (file: File) => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  defer: (id: string) => Promise<void>;
  updateCandidate: (
    id: string,
    updates: Partial<{
      placeName: string;
      suggestedLat: number;
      suggestedLng: number;
    }>,
  ) => Promise<void>;
  refresh: () => void;
}

export function useImportCandidates(
  userId: string | null,
  accessToken: string | null,
): UseImportCandidatesResult {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(
    null,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    if (userId === null) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setIsLoadingCandidates(true);
    fetchReviewableCandidates(userId).then((result) => {
      if (!cancelled) {
        setCandidates(result);
        setIsLoadingCandidates(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshNonce]);

  const startUpload = useCallback(
    (file: File) => {
      if (userId === null || accessToken === null) return;

      setUploadState("uploading");
      setUploadProgress(0);
      setUploadError(null);
      setUploadStatusMessage(`Uploading ${file.name}…`);

      uploadExportFile(file, accessToken, (progress: UploadProgress) => {
        setUploadProgress(
          progress.bytesTotal > 0
            ? progress.bytesUploaded / progress.bytesTotal
            : null,
        );
      })
        .then(async (tusUploadId) => {
          setUploadState("parsing");
          setUploadProgress(null);
          setUploadStatusMessage("Parsing export…");

          const parsed = await parseExport(tusUploadId, accessToken);
          setUploadStatusMessage(`Found ${parsed.length} check-ins`);

          await insertCandidates(
            userId,
            parsed.map((c) => ({
              externalKey: c.externalKey,
              placeName: c.placeName,
              visitTime: c.visitTime,
              note: c.note,
            })),
          );

          const reviewable = await fetchReviewableCandidates(userId);
          setCandidates(reviewable);

          const needsGeocoding = reviewable.filter(
            (c) => c.suggestedLat === null || c.suggestedLng === null,
          );

          if (needsGeocoding.length > 0) {
            setUploadState("geocoding");
            setUploadStatusMessage(
              `Geocoding ${needsGeocoding.length} new places…`,
            );

            const { results } = await geocodeCandidates(
              needsGeocoding.map((c) => ({
                externalKey: c.externalKey,
                placeName: c.placeName,
              })),
              accessToken,
            );

            await Promise.all(
              needsGeocoding.map((c) => {
                const result = results[c.externalKey];
                if (!result) return Promise.resolve();
                return updateCandidateGeocode(c.id, {
                  suggestedLat: result.lat,
                  suggestedLng: result.lng,
                  geocodeConfidence: result.confidence,
                });
              }),
            );

            const final = await fetchReviewableCandidates(userId);
            setCandidates(final);
          }

          setUploadState("done");
          setUploadStatusMessage(`${parsed.length} candidates ready to review`);
        })
        .catch((err: Error) => {
          setUploadState("error");
          setUploadError(err.message);
        });
    },
    [userId, accessToken],
  );

  const approve = useCallback(async (id: string) => {
    const { error } = await approveCandidate(id);
    if (error) {
      setUploadError(error);
      return;
    }
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const reject = useCallback(async (id: string) => {
    await rejectCandidate(id);
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const defer = useCallback(async (id: string) => {
    await deferCandidate(id);
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "later" } : c)),
    );
  }, []);

  const updateCandidate = useCallback(
    async (
      id: string,
      updates: Partial<{
        placeName: string;
        suggestedLat: number;
        suggestedLng: number;
      }>,
    ) => {
      setCandidates((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );
      await updateCandidateFields(id, updates);
    },
    [],
  );

  return {
    candidates,
    isLoadingCandidates,
    uploadState,
    uploadProgress,
    uploadStatusMessage,
    uploadError,
    startUpload,
    approve,
    reject,
    defer,
    updateCandidate,
    refresh,
  };
}

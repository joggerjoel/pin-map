import { useCallback, useEffect, useState } from "react";
import {
  approveCandidate,
  deferCandidate,
  fetchProgressCounts,
  fetchReviewableCandidates,
  insertCandidates,
  mergeCandidates,
  rejectCandidate,
  splitCandidate,
  updateCandidateFields,
  updateCandidateGeocode,
  type CandidateFieldUpdate,
  type ImportCandidate,
  type ProgressCounts,
  type SplitPart,
} from "../lib/importCandidatesRepository";
import {
  geocodeCandidates,
  parseExport,
  uploadExportFile,
  type UploadProgress,
} from "../lib/fbImportRelayClient";
import type { ReviewOrder } from "../lib/importCandidateOrder";

export type UploadState =
  "idle" | "uploading" | "parsing" | "geocoding" | "done" | "error";

const ZERO_PROGRESS: ProgressCounts = { total: 0, reviewed: 0 };

function needsGeocodingFilter(c: ImportCandidate): boolean {
  return c.suggestedLat === null || c.suggestedLng === null;
}

/** Geocodes one batch and writes every result the relay actually returned.
 * The relay caps unique names per request (see geocode.ts) and reports
 * `truncated` when it did — candidates beyond the cap get no result entry
 * at all, and are silently left alone here rather than guessed at. Callers
 * loop this against whatever's still ungeocoded until nothing's left or a
 * batch makes zero progress (a `truncated` response with 0 applied would
 * otherwise spin forever). */
async function geocodeBatchAndApply(
  batch: ImportCandidate[],
  accessToken: string,
): Promise<{ appliedCount: number }> {
  const { results } = await geocodeCandidates(
    batch.map((c) => ({ externalKey: c.externalKey, placeName: c.placeName })),
    accessToken,
  );
  const applied = await Promise.all(
    batch.map((c) => {
      const result = results[c.externalKey];
      if (!result) return Promise.resolve(false);
      return updateCandidateGeocode(c.id, {
        suggestedLat: result.lat,
        suggestedLng: result.lng,
        geocodeConfidence: result.confidence,
      }).then(() => true);
    }),
  );
  return { appliedCount: applied.filter(Boolean).length };
}

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
  updateCandidate: (id: string, updates: CandidateFieldUpdate) => Promise<void>;
  refresh: () => void;
  order: ReviewOrder;
  setOrder: (order: ReviewOrder) => void;
  progress: ProgressCounts;
  split: (candidate: ImportCandidate, parts: SplitPart[]) => Promise<void>;
  merge: (survivorId: string, loserIds: string[]) => Promise<void>;
  bulkApproveHighConfidence: () => Promise<void>;
  /** Resumes geocoding for every currently-loaded candidate still missing
   * coordinates — needed because the relay's per-request cap can leave a
   * chunk of a large import permanently ungeocoded otherwise (the upload
   * pipeline only geocodes once, right after insert). Safe to call anytime,
   * not just right after an upload. */
  geocodeRemaining: () => Promise<void>;
  isGeocodingRemaining: boolean;
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
  const [order, setOrder] = useState<ReviewOrder>("newest");
  const [progress, setProgress] = useState<ProgressCounts>(ZERO_PROGRESS);
  const [isGeocodingRemaining, setIsGeocodingRemaining] = useState(false);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const refreshProgress = useCallback(() => {
    if (userId === null) return;
    fetchProgressCounts(userId).then(setProgress);
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      setCandidates([]);
      setProgress(ZERO_PROGRESS);
      return;
    }
    let cancelled = false;
    setIsLoadingCandidates(true);
    Promise.all([
      fetchReviewableCandidates(userId),
      fetchProgressCounts(userId),
    ]).then(([reviewable, counts]) => {
      if (!cancelled) {
        setCandidates(reviewable);
        setProgress(counts);
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
          refreshProgress();

          let remaining = reviewable.filter(needsGeocodingFilter);

          if (remaining.length > 0) {
            setUploadState("geocoding");
            // Loops in batches (the relay caps unique names per request) so
            // a large import — more unique place names than one batch can
            // cover — doesn't leave a chunk permanently stuck ungeocoded.
            while (remaining.length > 0) {
              setUploadStatusMessage(
                `Geocoding ${remaining.length} new places…`,
              );
              const { appliedCount } = await geocodeBatchAndApply(
                remaining,
                accessToken,
              );
              if (appliedCount === 0) break;
              const refreshed = await fetchReviewableCandidates(userId);
              setCandidates(refreshed);
              remaining = refreshed.filter(needsGeocodingFilter);
            }
          }

          setUploadState("done");
          setUploadStatusMessage(`${parsed.length} candidates ready to review`);
        })
        .catch((err: Error) => {
          setUploadState("error");
          setUploadError(err.message);
        });
    },
    [userId, accessToken, refreshProgress],
  );

  const approve = useCallback(
    async (id: string) => {
      const { error } = await approveCandidate(id);
      if (error) {
        setUploadError(error);
        return;
      }
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      refreshProgress();
    },
    [refreshProgress],
  );

  const reject = useCallback(
    async (id: string) => {
      await rejectCandidate(id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      refreshProgress();
    },
    [refreshProgress],
  );

  const defer = useCallback(
    async (id: string) => {
      await deferCandidate(id);
      setCandidates((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "later" } : c)),
      );
      refreshProgress();
    },
    [refreshProgress],
  );

  const updateCandidate = useCallback(
    async (id: string, updates: CandidateFieldUpdate) => {
      setCandidates((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );
      await updateCandidateFields(id, updates);
    },
    [],
  );

  const split = useCallback(
    async (candidate: ImportCandidate, parts: SplitPart[]) => {
      if (userId === null) return;
      const children = await splitCandidate(userId, candidate, parts);
      if (children.length === 0) return;
      setCandidates((prev) =>
        prev.filter((c) => c.id !== candidate.id).concat(children),
      );
      refreshProgress();
    },
    [userId, refreshProgress],
  );

  const merge = useCallback(
    async (survivorId: string, loserIds: string[]) => {
      if (userId === null || loserIds.length === 0) return;
      await mergeCandidates(userId, survivorId, loserIds);
      const loserIdSet = new Set(loserIds);
      setCandidates((prev) => prev.filter((c) => !loserIdSet.has(c.id)));
      refreshProgress();
    },
    [userId, refreshProgress],
  );

  const bulkApproveHighConfidence = useCallback(async () => {
    const targets = candidates.filter((c) => c.geocodeConfidence === "high");
    if (targets.length === 0) return;
    const results = await Promise.all(
      targets.map(async (c) => ({
        id: c.id,
        result: await approveCandidate(c.id),
      })),
    );
    const approvedIds = new Set(
      results.filter((r) => r.result.error === null).map((r) => r.id),
    );
    const firstError = results.find((r) => r.result.error !== null)?.result
      .error;
    if (firstError) setUploadError(firstError);
    setCandidates((prev) => prev.filter((c) => !approvedIds.has(c.id)));
    refreshProgress();
  }, [candidates, refreshProgress]);

  const geocodeRemaining = useCallback(async () => {
    if (userId === null || accessToken === null) return;
    if (isGeocodingRemaining) return;
    setIsGeocodingRemaining(true);
    try {
      let remaining = candidates.filter(needsGeocodingFilter);
      while (remaining.length > 0) {
        const { appliedCount } = await geocodeBatchAndApply(
          remaining,
          accessToken,
        );
        if (appliedCount === 0) break;
        const refreshed = await fetchReviewableCandidates(userId);
        setCandidates(refreshed);
        remaining = refreshed.filter(needsGeocodingFilter);
      }
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsGeocodingRemaining(false);
      refreshProgress();
    }
  }, [userId, accessToken, candidates, isGeocodingRemaining, refreshProgress]);

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
    order,
    setOrder,
    progress,
    split,
    merge,
    bulkApproveHighConfidence,
    geocodeRemaining,
    isGeocodingRemaining,
  };
}

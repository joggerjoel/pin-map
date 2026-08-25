import { useCallback, useEffect, useRef, useState } from "react";
import { useUnsortedPhotos } from "../hooks/useUnsortedPhotos";
import { unsortedPhotoUrl } from "../lib/photosRepository";
import type { UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PinPlaceResult } from "../hooks/useGeocoder";
import { DEFAULT_TAG } from "./TagPicker";
import type { PinTag } from "./TagPicker";

const NOTICE_DISMISS_MS = 2500;
const MAX_MATCHES = 8;

export interface UnsortedPhotosPanelProps {
  userId: string;
  pinnedPlaces: PinnedPlace[];
  canCreatePin: boolean;
  onPinPlace: (query: string, tag: PinTag) => Promise<PinPlaceResult>;
  onOpenLightbox: (url: string, alt: string) => void;
  onAssigned: () => void;
  onEmpty: () => void;
  onClose: () => void;
}

export function UnsortedPhotosPanel({
  userId,
  pinnedPlaces,
  canCreatePin,
  onPinPlace,
  onOpenLightbox,
  onAssigned,
  onEmpty,
  onClose,
}: UnsortedPhotosPanelProps) {
  const unsorted = useUnsortedPhotos(userId);
  const [expandedPhotoId, setExpandedPhotoId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [isAssigning, setIsAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const isAssigningRef = useRef(false);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyNotifiedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimeoutRef.current !== null) {
        clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const isConfirmedEmpty =
    unsorted.photos.length === 0 &&
    !unsorted.hasMore &&
    !unsorted.isInitialLoading &&
    !unsorted.photosLoadError;

  useEffect(() => {
    if (isConfirmedEmpty && !emptyNotifiedRef.current) {
      emptyNotifiedRef.current = true;
      onEmpty();
    }
    if (!isConfirmedEmpty) {
      emptyNotifiedRef.current = false;
    }
  }, [isConfirmedEmpty, onEmpty]);

  const showNotice = useCallback((message: string) => {
    if (noticeTimeoutRef.current !== null) {
      clearTimeout(noticeTimeoutRef.current);
    }
    setNotice(message);
    noticeTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setNotice(null);
      }
    }, NOTICE_DISMISS_MS);
  }, []);

  const collapseRow = useCallback((photoId: string) => {
    setExpandedPhotoId((current) => (current === photoId ? null : current));
    setAssignErrors((prev) => {
      if (!(photoId in prev)) return prev;
      const next = { ...prev };
      delete next[photoId];
      return next;
    });
  }, []);

  const resolveAssignment = useCallback(
    async (photo: UnsortedPhoto, placeQuery: string) => {
      isAssigningRef.current = true;
      setIsAssigning(true);
      const result = await unsorted.assign(photo, placeQuery);
      if (!mountedRef.current) return;
      isAssigningRef.current = false;
      setIsAssigning(false);
      if (result === "ok" || result === "conflict") {
        onAssigned();
        collapseRow(photo.id);
        showNotice(result === "ok" ? "Saved" : "Already assigned elsewhere");
      } else {
        setAssignErrors((prev) => ({
          ...prev,
          [photo.id]: "Couldn't save — try again.",
        }));
      }
    },
    [unsorted, onAssigned, collapseRow, showNotice],
  );

  const handleSelectExisting = useCallback(
    (photo: UnsortedPhoto, query: string) => {
      void resolveAssignment(photo, query);
    },
    [resolveAssignment],
  );

  const handleCreateNew = useCallback(
    async (photo: UnsortedPhoto, text: string) => {
      isAssigningRef.current = true;
      setIsAssigning(true);
      const result = await onPinPlace(text, DEFAULT_TAG);
      if (!mountedRef.current) return;
      if (result.status !== "ok") {
        isAssigningRef.current = false;
        setIsAssigning(false);
        setAssignErrors((prev) => ({
          ...prev,
          [photo.id]: "Couldn't create that pin — try again.",
        }));
        return;
      }
      await resolveAssignment(photo, result.query);
    },
    [onPinPlace, resolveAssignment],
  );

  function toggleExpand(photoId: string) {
    if (isAssigningRef.current && expandedPhotoId !== photoId) {
      return; // an assign is in flight on the currently-expanded row
    }
    setExpandedPhotoId((current) => {
      if (current === photoId) return null;
      setSearchText("");
      return photoId;
    });
  }

  const matches =
    expandedPhotoId !== null
      ? pinnedPlaces
          .filter((place) =>
            place.query.toLowerCase().includes(searchText.trim().toLowerCase()),
          )
          .slice(0, MAX_MATCHES)
      : [];

  return (
    <div className="unsorted-photos-panel">
      <button
        type="button"
        className="unsorted-photos-panel__back"
        onClick={onClose}
      >
        ‹ Back to places
      </button>

      {notice !== null && (
        <div
          className="unsorted-photos-panel__notice"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}

      {unsorted.isInitialLoading && (
        <p className="unsorted-photos-panel__loading">Loading…</p>
      )}

      {!unsorted.isInitialLoading && unsorted.photosLoadError && (
        <div className="unsorted-photos-panel__error">
          <p>Couldn't load unsorted photos.</p>
          <button type="button" onClick={unsorted.retry}>
            Try again
          </button>
        </div>
      )}

      {!unsorted.isInitialLoading &&
        !unsorted.photosLoadError &&
        unsorted.photos.length === 0 &&
        unsorted.hasMore && (
          <div className="unsorted-photos-panel__refilling">
            {unsorted.isLoadingMore ? (
              <p>Loading…</p>
            ) : unsorted.loadMoreError ? (
              <>
                <p>Couldn't load more — tap to retry.</p>
                <button type="button" onClick={unsorted.loadMore}>
                  Retry
                </button>
              </>
            ) : null}
          </div>
        )}

      {isConfirmedEmpty && (
        <p className="unsorted-photos-panel__empty">
          All caught up — nothing left to triage.
        </p>
      )}

      {!unsorted.isInitialLoading &&
        !unsorted.photosLoadError &&
        unsorted.photos.length > 0 && (
          <>
            <ul className="unsorted-photos-panel__grid">
              {unsorted.photos.map((photo) => {
                const expanded = expandedPhotoId === photo.id;
                const alt = photo.storagePath.split("/").pop() ?? "";
                const assignError = assignErrors[photo.id];
                return (
                  <li key={photo.id} className="unsorted-photos-panel__card">
                    {photo.kind === "image" ? (
                      <>
                        <button
                          type="button"
                          className="unsorted-photos-panel__preview"
                          aria-label={`Preview unsorted photo`}
                          onClick={() =>
                            onOpenLightbox(unsortedPhotoUrl(photo, "full"), alt)
                          }
                        >
                          <img
                            src={unsortedPhotoUrl(photo, "thumbnail")}
                            alt=""
                            loading="lazy"
                          />
                        </button>
                        <button
                          type="button"
                          className="unsorted-photos-panel__assign-toggle"
                          aria-label={`Assign unsorted photo to a place`}
                          disabled={isAssigning && !expanded}
                          onClick={() => toggleExpand(photo.id)}
                        >
                          Assign
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="unsorted-photos-panel__assign-toggle"
                        aria-label={`Assign unsorted video to a place`}
                        disabled={isAssigning && !expanded}
                        onClick={() => toggleExpand(photo.id)}
                      >
                        <video
                          src={unsortedPhotoUrl(photo, "full")}
                          preload="metadata"
                          muted
                        />
                        <span>Assign</span>
                      </button>
                    )}

                    {expanded && (
                      <div className="unsorted-photos-panel__assign-row">
                        <input
                          type="text"
                          value={searchText}
                          onChange={(event) =>
                            setSearchText(event.target.value)
                          }
                          placeholder="Place name"
                          disabled={isAssigning}
                        />
                        {matches.map((place) => (
                          <button
                            key={place.query}
                            type="button"
                            disabled={isAssigning}
                            onClick={() =>
                              handleSelectExisting(photo, place.query)
                            }
                          >
                            {place.query}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={
                            isAssigning ||
                            searchText.trim() === "" ||
                            !canCreatePin
                          }
                          title={
                            !canCreatePin
                              ? "Connect a Mapbox token to create new pins"
                              : undefined
                          }
                          onClick={() =>
                            void handleCreateNew(photo, searchText.trim())
                          }
                        >
                          Create new pin: "{searchText.trim()}"
                        </button>
                        {assignError !== undefined && (
                          <p className="unsorted-photos-panel__row-error">
                            {assignError}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {unsorted.hasMore && (
              <button
                type="button"
                className="unsorted-photos-panel__load-more"
                disabled={unsorted.isLoadingMore}
                onClick={unsorted.loadMore}
              >
                {unsorted.isLoadingMore
                  ? "Loading…"
                  : unsorted.loadMoreError
                    ? "Couldn't load more — tap to retry"
                    : "Load more"}
              </button>
            )}
          </>
        )}
    </div>
  );
}

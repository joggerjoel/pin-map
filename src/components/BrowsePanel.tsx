import { useCallback, useEffect, useRef, useState } from "react";
import { useAllPhotos } from "../hooks/useAllPhotos";
import { useSelection } from "../hooks/useSelection";
import { useMassActions } from "../hooks/useMassActions";
import { useSimilarPhotos } from "../hooks/useSimilarPhotos";
import { walkAllPages } from "../lib/pagination";
import {
  PHOTO_TAG_TAXONOMY,
  fetchAllPhotos,
  fetchAllPhotosCount,
  fetchGroups,
} from "../lib/photosRepository";
import type {
  PhotoGroup,
  PhotoTagFilter,
  UnsortedPhoto,
} from "../lib/photosRepository";
import type { PinnedPlace, PinPlaceResult } from "../hooks/useGeocoder";
import type { PinTag } from "./TagPicker";
import { DEFAULT_TAG } from "./TagPicker";
import { PhotoGrid } from "./PhotoGrid";
import { MassActionToolbar } from "./MassActionToolbar";

const PAGE_SIZE = 60;

const TAG_CHIPS: { value: PhotoTagFilter; label: string }[] = [
  ...PHOTO_TAG_TAXONOMY.map((tag) => ({ value: tag, label: tag })),
  { value: "untagged", label: "Untagged" },
];

export interface BrowsePanelProps {
  userId: string;
  pinnedPlaces: PinnedPlace[];
  canCreatePin: boolean;
  onPinPlace: (query: string, tag: PinTag) => Promise<PinPlaceResult>;
  onOpenLightbox: (url: string, alt: string) => void;
  onClose: () => void;
}

export function BrowsePanel({
  userId,
  pinnedPlaces,
  canCreatePin,
  onPinPlace,
  onOpenLightbox,
  onClose,
}: BrowsePanelProps) {
  const [tagFilter, setTagFilter] = useState<PhotoTagFilter | undefined>(
    undefined,
  );
  const [groupFilter, setGroupFilter] = useState<string | undefined>(undefined);
  const all = useAllPhotos(userId, { tag: tagFilter, groupId: groupFilter });
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimeoutRef.current !== null) {
        clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    if (noticeTimeoutRef.current !== null) {
      clearTimeout(noticeTimeoutRef.current);
    }
    setNotice(message);
    noticeTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setNotice(null);
    }, 2500);
  }, []);

  const refetchGroups = useCallback(() => {
    fetchGroups(userId).then((result) => {
      if (mountedRef.current && result !== null) setGroups(result);
    });
  }, [userId]);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  useEffect(() => {
    fetchAllPhotosCount(userId, { tag: tagFilter, groupId: groupFilter }).then(
      (count) => {
        if (mountedRef.current) setTotalCount(count);
      },
    );
  }, [userId, tagFilter, groupFilter]);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const selection = useSelection();
  const [walkedSelection, setWalkedSelection] = useState<
    UnsortedPhoto[] | null
  >(null);
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const massActions = useMassActions();
  const similar = useSimilarPhotos();

  const clearSelection = useCallback(() => {
    selection.clear();
    setWalkedSelection(null);
    massActions.clearSummary();
  }, [selection, massActions]);

  useEffect(() => {
    if (loadMoreSentinelRef.current === null) return;
    if (!all.hasMore || all.isLoadingMore || all.loadMoreError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          all.loadMore();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
  }, [all.hasMore, all.isLoadingMore, all.loadMoreError, all.loadMore]);

  function handleTagFilterChange(next: PhotoTagFilter | undefined) {
    if (next === tagFilter) return;
    setTagFilter(next);
    clearSelection();
  }

  function handleGroupFilterChange(next: string | undefined) {
    if (next === groupFilter) return;
    setGroupFilter(next);
    clearSelection();
  }

  const selectedRows: UnsortedPhoto[] =
    walkedSelection ??
    all.photos.filter((photo) => selection.isSelected(photo.id));

  const handleToggleSelect = useCallback(
    (photoId: string) => {
      setWalkedSelection(null);
      selection.toggle(photoId);
    },
    [selection],
  );

  const handleSelectAllRequest = useCallback(async () => {
    setIsSelectingAll(true);
    const rows = await walkAllPages(
      (after) =>
        fetchAllPhotos(userId, {
          limit: PAGE_SIZE,
          after,
          tag: tagFilter,
          groupId: groupFilter,
        }),
      PAGE_SIZE,
    );
    if (!mountedRef.current) return;
    setIsSelectingAll(false);
    if (rows === null) {
      showNotice("Couldn't select all — try again.");
      return;
    }
    selection.selectAll(rows.map((row) => row.id));
    setWalkedSelection(rows);
  }, [userId, tagFilter, groupFilter, selection, showNotice]);

  const afterBatch = useCallback(() => {
    selection.clear();
    setWalkedSelection(null);
    all.retry();
    refetchGroups();
    fetchAllPhotosCount(userId, { tag: tagFilter, groupId: groupFilter }).then(
      (count) => {
        if (mountedRef.current) setTotalCount(count);
      },
    );
  }, [selection, all, refetchGroups, userId, tagFilter, groupFilter]);

  const handleAddToGroup = useCallback(
    (groupId: string) => {
      void massActions
        .runAddToGroup(
          groupId,
          selectedRows.map((row) => row.id),
        )
        .then(afterBatch);
    },
    [massActions, selectedRows, afterBatch],
  );

  return (
    <div className="browse-panel">
      <button type="button" className="browse-panel__back" onClick={onClose}>
        ‹ Back to places
      </button>
      <h2>Browse</h2>

      {notice !== null && (
        <div className="browse-panel__notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {similar.isActive ? (
        <>
          <button type="button" onClick={similar.exit}>
            ‹ Back
          </button>
          <p>
            Showing {similar.results.length} of {similar.totalReturned} similar
            photos
          </p>
          {similar.isLoading ? (
            <p>Loading…</p>
          ) : (
            <PhotoGrid
              photos={similar.results}
              isSelectMode={false}
              isSelected={() => false}
              onToggleSelect={() => {}}
              onOpenLightbox={onOpenLightbox}
              onMoreLikeThis={similar.enter}
              showRemoveButton={false}
            />
          )}
        </>
      ) : (
        <>
          <div
            className="browse-panel__filters"
            role="group"
            aria-label="Filter by tag"
          >
            <button
              type="button"
              className={
                tagFilter === undefined
                  ? "browse-panel__tag-chip browse-panel__tag-chip--active"
                  : "browse-panel__tag-chip"
              }
              onClick={() => handleTagFilterChange(undefined)}
            >
              All
            </button>
            {TAG_CHIPS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={
                  tagFilter === value
                    ? "browse-panel__tag-chip browse-panel__tag-chip--active"
                    : "browse-panel__tag-chip"
                }
                onClick={() => handleTagFilterChange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {groups.length > 0 && (
            <select
              aria-label="Filter by group"
              value={groupFilter ?? ""}
              onChange={(event) =>
                handleGroupFilterChange(
                  event.target.value === "" ? undefined : event.target.value,
                )
              }
            >
              <option value="">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            aria-pressed={isSelectMode}
            onClick={() => {
              setIsSelectMode((v) => !v);
              clearSelection();
            }}
          >
            {isSelectMode ? "Done selecting" : "Select"}
          </button>

          {isSelectMode &&
            (selectedRows.length > 0 || massActions.summary !== null) && (
              <MassActionToolbar
                selectedRows={selectedRows.map((row) => ({
                  id: row.id,
                  placeQuery: row.placeQuery,
                  skippedAt: row.skippedAt,
                }))}
                onClearSelection={clearSelection}
                totalMatchingCount={totalCount}
                onSelectAllRequest={() => void handleSelectAllRequest()}
                isSelectingAll={isSelectingAll}
                groups={groups}
                showRemoveFromGroup={false}
                onAddToGroup={handleAddToGroup}
                onCreateGroupAndAdd={() => {}}
                onRemoveFromGroup={() => {}}
                pinnedPlaces={pinnedPlaces}
                canCreatePin={canCreatePin}
                onCreatePin={(query) => onPinPlace(query, DEFAULT_TAG)}
                onMassAssign={() => {}}
                onMassSkip={() => {}}
                onMassUnskip={() => {}}
                onMassUnassign={() => {}}
                isRunning={massActions.isRunning}
                summary={massActions.summary}
                failedCount={massActions.failedRows.length}
                onRetryFailed={() => {}}
                onDismissSummary={massActions.clearSummary}
              />
            )}

          {all.isInitialLoading && <p>Loading…</p>}
          {!all.isInitialLoading && all.photosLoadError && (
            <div>
              <p>Couldn't load photos.</p>
              <button type="button" onClick={all.retry}>
                Try again
              </button>
            </div>
          )}
          {!all.isInitialLoading &&
            !all.photosLoadError &&
            all.photos.length === 0 && (
              <p>
                {tagFilter !== undefined || groupFilter !== undefined
                  ? "No photos match this filter."
                  : "No photos yet."}
              </p>
            )}
          {!all.isInitialLoading &&
            !all.photosLoadError &&
            all.photos.length > 0 && (
              <>
                <PhotoGrid
                  photos={all.photos}
                  isSelectMode={isSelectMode}
                  isSelected={selection.isSelected}
                  onToggleSelect={handleToggleSelect}
                  onOpenLightbox={onOpenLightbox}
                  onMoreLikeThis={similar.enter}
                  showRemoveButton={false}
                />
                {all.hasMore && <div ref={loadMoreSentinelRef} />}
              </>
            )}
        </>
      )}
    </div>
  );
}

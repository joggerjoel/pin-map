import { useCallback, useEffect, useRef, useState } from "react";
import { useUnsortedPhotos } from "../hooks/useUnsortedPhotos";
import { useSelection } from "../hooks/useSelection";
import { useMassActions } from "../hooks/useMassActions";
import { useSimilarPhotos } from "../hooks/useSimilarPhotos";
import { PhotoGrid } from "./PhotoGrid";
import { walkAllPages } from "../lib/pagination";
import {
  PHOTO_LABEL_MAX_LENGTH,
  PHOTO_TAG_TAXONOMY,
  assignPhotoPlace,
  createGroup as createGroupRepo,
  fetchGroups,
  fetchUnsortedPhotoCount,
  fetchUnsortedPhotos,
  skipPhoto,
  unassignPhoto,
  unskipPhoto,
  unsortedPhotoUrl,
} from "../lib/photosRepository";
import type {
  PhotoGroup,
  PhotoTagFilter,
  PhotoTriageStatus,
  UnsortedPhoto,
} from "../lib/photosRepository";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PinPlaceResult } from "../hooks/useGeocoder";
import { DEFAULT_TAG } from "./TagPicker";
import type { PinTag } from "./TagPicker";
import { MassActionToolbar } from "./MassActionToolbar";

const NOTICE_DISMISS_MS = 2500;
const MAX_MATCHES = 8;
const PAGE_SIZE = 60;

const TABS: { status: PhotoTriageStatus; label: string }[] = [
  { status: "unassigned", label: "Unassigned" },
  { status: "skipped", label: "Skipped" },
  { status: "assigned", label: "Assigned" },
];

const TAG_CHIPS: { value: PhotoTagFilter; label: string }[] = [
  ...PHOTO_TAG_TAXONOMY.map((tag) => ({ value: tag, label: tag })),
  { value: "untagged", label: "Untagged" },
];

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
  const [activeTab, setActiveTab] = useState<PhotoTriageStatus>("unassigned");
  const [tagFilter, setTagFilter] = useState<PhotoTagFilter | undefined>(
    undefined,
  );
  const unsorted = useUnsortedPhotos(userId, activeTab, tagFilter);
  const [expandedPhotoId, setExpandedPhotoId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [isAssigning, setIsAssigning] = useState(false);
  const [skippingIds, setSkippingIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [tabCounts, setTabCounts] = useState<
    Record<PhotoTriageStatus, number | null>
  >({ unassigned: null, skipped: null, assigned: null });

  const [isSelectMode, setIsSelectMode] = useState(false);
  const selection = useSelection();
  const [walkedSelection, setWalkedSelection] = useState<
    UnsortedPhoto[] | null
  >(null);
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const massActions = useMassActions();
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  // Filters "more like this" results to the current tab's status, the same
  // way every other status-scoped part of this panel works -- results
  // outside the active tab exist (the RPC isn't status-aware) but aren't
  // shown here.
  const similar = useSimilarPhotos((candidate) => {
    if (activeTab === "unassigned") {
      return candidate.placeQuery === null && candidate.skippedAt === null;
    }
    if (activeTab === "skipped") {
      return candidate.placeQuery === null && candidate.skippedAt !== null;
    }
    return candidate.placeQuery !== null;
  });
  // Which looped action last ran, so "Retry N failed" replays the exact
  // same action rather than guessing one from the current tab -- Assign
  // and Skip are both valid on an all-Unassigned selection, so the tab
  // alone can't disambiguate which of the two actually produced the
  // failures being retried.
  const lastLoopedActionRef = useRef<
    | { kind: "assign"; placeQuery: string }
    | { kind: "skip" }
    | { kind: "unskip" }
    | { kind: "unassign" }
    | null
  >(null);

  const mountedRef = useRef(true);
  const isAssigningRef = useRef(false);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyNotifiedRef = useRef(false);
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

  // Tab counts are their own fetch, independent of the sidebar's
  // "Unsorted (N)" badge (useUnsortedPhotoCount) — that hook only ever
  // tracks the unassigned count and has its own refetch-on-focus timing.
  // Reflects the active tag filter too, so a tab's own badge and the
  // "Select all N" control (which uses this same count) never disagree.
  const refetchTabCounts = useCallback(() => {
    TABS.forEach(({ status }) => {
      fetchUnsortedPhotoCount(userId, status, tagFilter).then((count) => {
        if (!mountedRef.current) return;
        setTabCounts((prev) => ({ ...prev, [status]: count }));
      });
    });
  }, [userId, tagFilter]);

  useEffect(() => {
    refetchTabCounts();
  }, [refetchTabCounts]);

  const refetchGroups = useCallback(() => {
    fetchGroups(userId).then((result) => {
      if (!mountedRef.current || result === null) return;
      setGroups(result);
    });
  }, [userId]);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  const isCurrentTabEmpty =
    unsorted.photos.length === 0 &&
    !unsorted.hasMore &&
    !unsorted.isInitialLoading &&
    !unsorted.photosLoadError;

  // Only the Unassigned tab drives the sidebar badge — the Skipped/Assigned
  // tabs going empty says nothing about whether triage work remains.
  const isConfirmedEmpty = activeTab === "unassigned" && isCurrentTabEmpty;

  useEffect(() => {
    if (isConfirmedEmpty && !emptyNotifiedRef.current) {
      emptyNotifiedRef.current = true;
      onEmpty();
    }
    if (!isConfirmedEmpty) {
      emptyNotifiedRef.current = false;
    }
  }, [isConfirmedEmpty, onEmpty]);

  // Auto-load the next page as the sentinel below the grid nears the
  // viewport, instead of relying on a manual button — at real-world scale
  // (thousands of tiny thumbnails) a "Load more" button ends up thousands of
  // pixels below the fold and is never discovered.
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      sentinel === null ||
      !unsorted.hasMore ||
      unsorted.isLoadingMore ||
      unsorted.loadMoreError
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          unsorted.loadMore();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    unsorted.hasMore,
    unsorted.isLoadingMore,
    unsorted.loadMoreError,
    unsorted.loadMore,
  ]);

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

  const handleCopyId = useCallback(
    async (photoId: string) => {
      try {
        await navigator.clipboard.writeText(photoId);
        showNotice(`Copied ${photoId.slice(0, 8)}`);
      } catch {
        showNotice("Couldn't copy — select and copy the label text instead.");
      }
    },
    [showNotice],
  );

  const startEditingLabel = useCallback((photo: UnsortedPhoto) => {
    setEditingLabelId(photo.id);
    setLabelDraft(photo.label ?? "");
  }, []);

  const cancelEditingLabel = useCallback(() => {
    setEditingLabelId(null);
    setLabelDraft("");
  }, []);

  const saveLabel = useCallback(
    async (photo: UnsortedPhoto) => {
      setIsSavingLabel(true);
      const result = await unsorted.setLabel(photo, labelDraft);
      if (!mountedRef.current) return;
      setIsSavingLabel(false);
      if (result === "ok") {
        setEditingLabelId(null);
        setLabelDraft("");
        showNotice("Renamed");
      } else {
        showNotice("Couldn't rename — try again.");
      }
    },
    [unsorted, labelDraft, showNotice],
  );

  const handleSkip = useCallback(
    async (photo: UnsortedPhoto) => {
      setSkippingIds((prev) => new Set(prev).add(photo.id));
      const result = await unsorted.skip(photo);
      if (!mountedRef.current) return;
      setSkippingIds((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
      if (result === "ok" || result === "conflict") {
        collapseRow(photo.id);
        showNotice(result === "ok" ? "Skipped" : "Already handled elsewhere");
        refetchTabCounts();
      } else {
        showNotice("Couldn't skip — try again.");
      }
    },
    [unsorted, collapseRow, showNotice, refetchTabCounts],
  );

  const handleUnskip = useCallback(
    async (photo: UnsortedPhoto) => {
      setSkippingIds((prev) => new Set(prev).add(photo.id));
      const result = await unsorted.unskip(photo);
      if (!mountedRef.current) return;
      setSkippingIds((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
      if (result === "ok" || result === "conflict") {
        showNotice(
          result === "ok"
            ? "Moved back to Unassigned"
            : "Already handled elsewhere",
        );
        refetchTabCounts();
      } else {
        showNotice("Couldn't unskip — try again.");
      }
    },
    [unsorted, showNotice, refetchTabCounts],
  );

  const handleUnassign = useCallback(
    async (photo: UnsortedPhoto) => {
      setSkippingIds((prev) => new Set(prev).add(photo.id));
      const result = await unsorted.unassign(photo);
      if (!mountedRef.current) return;
      setSkippingIds((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
      if (result === "ok" || result === "conflict") {
        showNotice(
          result === "ok"
            ? "Moved back to Unassigned"
            : "Already handled elsewhere",
        );
        refetchTabCounts();
      } else {
        showNotice("Couldn't unassign — try again.");
      }
    },
    [unsorted, showNotice, refetchTabCounts],
  );

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
        refetchTabCounts();
      } else {
        setAssignErrors((prev) => ({
          ...prev,
          [photo.id]: "Couldn't save — try again.",
        }));
      }
    },
    [unsorted, onAssigned, collapseRow, showNotice, refetchTabCounts],
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

  const clearSelection = useCallback(() => {
    selection.clear();
    setWalkedSelection(null);
    massActions.clearSummary();
  }, [selection, massActions]);

  function handleTabChange(status: PhotoTriageStatus) {
    if (status === activeTab) return;
    setActiveTab(status);
    setExpandedPhotoId(null);
    setSearchText("");
    setAssignErrors({});
    setEditingLabelId(null);
    setLabelDraft("");
    clearSelection();
    similar.exit();
  }

  function handleTagFilterChange(next: PhotoTagFilter | undefined) {
    if (next === tagFilter) return;
    setTagFilter(next);
    clearSelection();
  }

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

  // Manual selection is always drawn from what's on screen -- a checkbox
  // can only ever be next to a rendered card. "Select all N" is the one
  // case that can exceed the current page, so its walked full-row result
  // takes precedence over deriving rows from `unsorted.photos` whenever
  // it's present. Cleared by any manual toggle, by a tab/tag change, or
  // once a batch completes.
  const selectedRows: UnsortedPhoto[] =
    walkedSelection ??
    unsorted.photos.filter((photo) => selection.isSelected(photo.id));

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
        fetchUnsortedPhotos(userId, {
          limit: PAGE_SIZE,
          after,
          status: activeTab,
          tag: tagFilter,
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
  }, [userId, activeTab, tagFilter, selection, showNotice]);

  // Deliberately does NOT clear massActions.summary/failedRows -- doing so
  // here would hide "Retry N failed" the instant the batch that produced
  // it finishes, before the user ever sees it. Only the (now-stale)
  // checkbox selection is cleared; the summary stays until the user
  // dismisses it or retries.
  const afterMassActionBatch = useCallback(() => {
    selection.clear();
    setWalkedSelection(null);
    unsorted.retry();
    refetchTabCounts();
    refetchGroups();
  }, [selection, unsorted, refetchTabCounts, refetchGroups]);

  const handleMassAssign = useCallback(
    (placeQuery: string) => {
      lastLoopedActionRef.current = { kind: "assign", placeQuery };
      void massActions
        .runLooped(selectedRows, (row) => assignPhotoPlace(row.id, placeQuery))
        .then(afterMassActionBatch);
    },
    [massActions, selectedRows, afterMassActionBatch],
  );

  const handleMassSkip = useCallback(() => {
    lastLoopedActionRef.current = { kind: "skip" };
    void massActions
      .runLooped(selectedRows, (row) => skipPhoto(row.id))
      .then(afterMassActionBatch);
  }, [massActions, selectedRows, afterMassActionBatch]);

  const handleMassUnskip = useCallback(() => {
    lastLoopedActionRef.current = { kind: "unskip" };
    void massActions
      .runLooped(selectedRows, (row) => unskipPhoto(row.id))
      .then(afterMassActionBatch);
  }, [massActions, selectedRows, afterMassActionBatch]);

  const handleMassUnassign = useCallback(() => {
    lastLoopedActionRef.current = { kind: "unassign" };
    void massActions
      .runLooped(selectedRows, (row) => unassignPhoto(row.id))
      .then(afterMassActionBatch);
  }, [massActions, selectedRows, afterMassActionBatch]);

  const handleAddToGroup = useCallback(
    (groupId: string) => {
      void massActions
        .runAddToGroup(
          groupId,
          selectedRows.map((row) => row.id),
        )
        .then(afterMassActionBatch);
    },
    [massActions, selectedRows, afterMassActionBatch],
  );

  const handleCreateGroupAndAdd = useCallback(
    async (name: string) => {
      const result = await createGroupRepo(userId, name);
      if (!mountedRef.current) return;
      if (result === "invalid") {
        showNotice("Group name can't be blank or over 100 characters.");
        return;
      }
      if (result === "limit") {
        showNotice("Group limit reached (200 per account).");
        return;
      }
      if (result === "error") {
        showNotice("Couldn't create group — try again.");
        return;
      }
      handleAddToGroup(result.id);
    },
    [userId, handleAddToGroup, showNotice],
  );

  // Replays the exact action that produced these failures -- tracked
  // explicitly in lastLoopedActionRef, not guessed from the active tab
  // (Assign and Skip are both valid on an all-Unassigned selection, so the
  // tab alone can't tell them apart).
  const handleRetryFailed = useCallback(() => {
    const rows = massActions.failedRows as UnsortedPhoto[];
    const lastAction = lastLoopedActionRef.current;
    if (lastAction === null) return;
    if (lastAction.kind === "assign") {
      const { placeQuery } = lastAction;
      void massActions
        .runLooped(rows, (row) => assignPhotoPlace(row.id, placeQuery))
        .then(afterMassActionBatch);
    } else if (lastAction.kind === "skip") {
      void massActions
        .runLooped(rows, (row) => skipPhoto(row.id))
        .then(afterMassActionBatch);
    } else if (lastAction.kind === "unskip") {
      void massActions
        .runLooped(rows, (row) => unskipPhoto(row.id))
        .then(afterMassActionBatch);
    } else {
      void massActions
        .runLooped(rows, (row) => unassignPhoto(row.id))
        .then(afterMassActionBatch);
    }
  }, [massActions, afterMassActionBatch]);

  if (similar.isActive) {
    const backLabel = `‹ Back to ${TABS.find((t) => t.status === activeTab)?.label ?? "Unassigned"}`;
    return (
      <div className="unsorted-photos-panel">
        <button type="button" onClick={similar.exit}>
          {backLabel}
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
      </div>
    );
  }

  return (
    <div className="unsorted-photos-panel">
      <button
        type="button"
        className="unsorted-photos-panel__back"
        onClick={onClose}
      >
        ‹ Back to places
      </button>

      <div className="unsorted-photos-panel__tabs" role="tablist">
        {TABS.map(({ status, label }) => {
          const count = tabCounts[status];
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={activeTab === status}
              className={
                activeTab === status
                  ? "unsorted-photos-panel__tab unsorted-photos-panel__tab--active"
                  : "unsorted-photos-panel__tab"
              }
              onClick={() => handleTabChange(status)}
            >
              {label}
              {count !== null && (
                <span className="unsorted-photos-panel__tab-count">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="unsorted-photos-panel__tag-chips"
        role="group"
        aria-label="Filter by tag"
      >
        <button
          type="button"
          className={
            tagFilter === undefined
              ? "unsorted-photos-panel__tag-chip unsorted-photos-panel__tag-chip--active"
              : "unsorted-photos-panel__tag-chip"
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
                ? "unsorted-photos-panel__tag-chip unsorted-photos-panel__tag-chip--active"
                : "unsorted-photos-panel__tag-chip"
            }
            onClick={() => handleTagFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="unsorted-photos-panel__select-toggle"
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
            totalMatchingCount={tabCounts[activeTab]}
            onSelectAllRequest={() => void handleSelectAllRequest()}
            isSelectingAll={isSelectingAll}
            groups={groups}
            showRemoveFromGroup={false}
            onAddToGroup={handleAddToGroup}
            onCreateGroupAndAdd={(name) => void handleCreateGroupAndAdd(name)}
            onRemoveFromGroup={() => {}}
            pinnedPlaces={pinnedPlaces}
            canCreatePin={canCreatePin}
            onCreatePin={(query) => onPinPlace(query, DEFAULT_TAG)}
            onMassAssign={handleMassAssign}
            onMassSkip={handleMassSkip}
            onMassUnskip={handleMassUnskip}
            onMassUnassign={handleMassUnassign}
            isRunning={massActions.isRunning}
            summary={massActions.summary}
            failedCount={massActions.failedRows.length}
            onRetryFailed={handleRetryFailed}
            onDismissSummary={massActions.clearSummary}
          />
        )}

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

      {isCurrentTabEmpty && (
        <p className="unsorted-photos-panel__empty">
          {activeTab === "unassigned" &&
            "All caught up — nothing left to triage."}
          {activeTab === "skipped" && "No skipped photos."}
          {activeTab === "assigned" && "No assigned photos yet."}
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
                const showAssignSkip = activeTab === "unassigned";
                const showUnskip = activeTab === "skipped";
                const showUnassign = activeTab === "assigned";
                // Assigned photos are immutable via label_own's RLS (scoped
                // to place_query is null) — editing here would silently
                // no-op against a real backend rejection, so hide the entry
                // point rather than let the "Renamed" notice lie.
                const canEditLabel = activeTab !== "assigned";
                return (
                  <li key={photo.id} className="unsorted-photos-panel__card">
                    {isSelectMode && (
                      <input
                        type="checkbox"
                        className="unsorted-photos-panel__card-checkbox"
                        aria-label={`Select photo ${photo.id.slice(0, 8)}`}
                        checked={selection.isSelected(photo.id)}
                        onChange={() => handleToggleSelect(photo.id)}
                      />
                    )}
                    {editingLabelId === photo.id ? (
                      <input
                        type="text"
                        className="unsorted-photos-panel__card-label-input"
                        value={labelDraft}
                        autoFocus
                        maxLength={PHOTO_LABEL_MAX_LENGTH}
                        disabled={isSavingLabel}
                        onChange={(event) => setLabelDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void saveLabel(photo);
                          } else if (event.key === "Escape") {
                            cancelEditingLabel();
                          }
                        }}
                        onBlur={() => {
                          if (!isSavingLabel) cancelEditingLabel();
                        }}
                      />
                    ) : (
                      <div className="unsorted-photos-panel__card-label-row">
                        <button
                          type="button"
                          className="unsorted-photos-panel__card-label"
                          title={photo.id}
                          aria-label={`Copy photo ID ${photo.id}`}
                          onClick={() => void handleCopyId(photo.id)}
                        >
                          {photo.label ?? photo.id.slice(0, 8)}
                        </button>
                        {canEditLabel && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__card-label-edit"
                            aria-label={`Rename photo ${photo.id.slice(0, 8)}`}
                            onClick={() => startEditingLabel(photo)}
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    )}
                    {photo.placeQuery !== null && (
                      <p className="unsorted-photos-panel__card-place">
                        {photo.placeQuery}
                      </p>
                    )}
                    {photo.caption !== null && (
                      <button
                        type="button"
                        className="unsorted-photos-panel__more-like-this"
                        onClick={() => similar.enter(photo)}
                      >
                        More like this
                      </button>
                    )}
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
                        {showAssignSkip && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__assign-toggle"
                            aria-label={`Assign unsorted photo to a place`}
                            disabled={isAssigning && !expanded}
                            onClick={() => toggleExpand(photo.id)}
                          >
                            Assign
                          </button>
                        )}
                        {showAssignSkip && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__skip"
                            aria-label={`Skip unsorted photo for now`}
                            disabled={
                              (expanded && isAssigning) ||
                              skippingIds.has(photo.id)
                            }
                            onClick={() => void handleSkip(photo)}
                          >
                            Skip
                          </button>
                        )}
                        {showUnskip && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__unskip"
                            aria-label={`Move unsorted photo back to Unassigned`}
                            disabled={skippingIds.has(photo.id)}
                            onClick={() => void handleUnskip(photo)}
                          >
                            Unskip
                          </button>
                        )}
                        {showUnassign && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__unassign"
                            aria-label={`Unassign photo, moving it back to Unassigned`}
                            disabled={skippingIds.has(photo.id)}
                            onClick={() => void handleUnassign(photo)}
                          >
                            Unassign
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {showAssignSkip ? (
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
                        ) : (
                          <button
                            type="button"
                            className="unsorted-photos-panel__preview"
                            aria-label={`Preview unsorted video`}
                            onClick={() =>
                              onOpenLightbox(
                                unsortedPhotoUrl(photo, "full"),
                                alt,
                              )
                            }
                          >
                            <video
                              src={unsortedPhotoUrl(photo, "full")}
                              preload="metadata"
                              muted
                            />
                          </button>
                        )}
                        {showAssignSkip && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__skip"
                            aria-label={`Skip unsorted video for now`}
                            disabled={
                              (expanded && isAssigning) ||
                              skippingIds.has(photo.id)
                            }
                            onClick={() => void handleSkip(photo)}
                          >
                            Skip
                          </button>
                        )}
                        {showUnskip && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__unskip"
                            aria-label={`Move unsorted video back to Unassigned`}
                            disabled={skippingIds.has(photo.id)}
                            onClick={() => void handleUnskip(photo)}
                          >
                            Unskip
                          </button>
                        )}
                        {showUnassign && (
                          <button
                            type="button"
                            className="unsorted-photos-panel__unassign"
                            aria-label={`Unassign video, moving it back to Unassigned`}
                            disabled={skippingIds.has(photo.id)}
                            onClick={() => void handleUnassign(photo)}
                          >
                            Unassign
                          </button>
                        )}
                      </>
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
              <div
                ref={loadMoreSentinelRef}
                className="unsorted-photos-panel__load-more-sentinel"
              />
            )}
            {unsorted.hasMore &&
              (unsorted.isLoadingMore || unsorted.loadMoreError) && (
                <button
                  type="button"
                  className="unsorted-photos-panel__load-more"
                  disabled={unsorted.isLoadingMore}
                  onClick={unsorted.loadMore}
                >
                  {unsorted.isLoadingMore
                    ? "Loading…"
                    : "Couldn't load more — tap to retry"}
                </button>
              )}
          </>
        )}
    </div>
  );
}

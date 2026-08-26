import { useCallback, useEffect, useRef, useState } from "react";
import { useAllPhotos } from "../hooks/useAllPhotos";
import { useSelection } from "../hooks/useSelection";
import { useMassActions } from "../hooks/useMassActions";
import { useSimilarPhotos } from "../hooks/useSimilarPhotos";
import { walkAllPages } from "../lib/pagination";
import {
  createGroup,
  deleteGroup,
  fetchAllPhotos,
  fetchAllPhotosCount,
  fetchGroups,
} from "../lib/photosRepository";
import type { PhotoGroup, UnsortedPhoto } from "../lib/photosRepository";
import type { PinnedPlace, PinPlaceResult } from "../hooks/useGeocoder";
import type { PinTag } from "./TagPicker";
import { DEFAULT_TAG } from "./TagPicker";
import { PhotoGrid } from "./PhotoGrid";
import { MassActionToolbar } from "./MassActionToolbar";

const NOTICE_DISMISS_MS = 2500;
const PAGE_SIZE = 60;

export interface GroupsPanelProps {
  userId: string;
  pinnedPlaces: PinnedPlace[];
  canCreatePin: boolean;
  onPinPlace: (query: string, tag: PinTag) => Promise<PinPlaceResult>;
  onOpenLightbox: (url: string, alt: string) => void;
  onClose: () => void;
}

export function GroupsPanel({
  userId,
  pinnedPlaces,
  canCreatePin,
  onPinPlace,
  onOpenLightbox,
  onClose,
}: GroupsPanelProps) {
  const [groups, setGroups] = useState<PhotoGroup[] | null>(null);
  const [groupsLoadError, setGroupsLoadError] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
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
    }, NOTICE_DISMISS_MS);
  }, []);

  const refetchGroups = useCallback(() => {
    setGroupsLoadError(false);
    fetchGroups(userId).then((result) => {
      if (!mountedRef.current) return;
      if (result === null) {
        setGroupsLoadError(true);
        return;
      }
      setGroups(result);
    });
  }, [userId]);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  const activeGroup = groups?.find((g) => g.id === activeGroupId) ?? null;

  const members = useAllPhotos(userId, {
    groupId: activeGroupId ?? undefined,
  });
  const [memberCount, setMemberCount] = useState<number | null>(null);
  useEffect(() => {
    if (activeGroupId === null) return;
    fetchAllPhotosCount(userId, { groupId: activeGroupId }).then((count) => {
      if (mountedRef.current) setMemberCount(count);
    });
  }, [userId, activeGroupId, members.photos.length]);

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
    if (!members.hasMore || members.isLoadingMore || members.loadMoreError) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          members.loadMore();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
  }, [
    members.hasMore,
    members.isLoadingMore,
    members.loadMoreError,
    members.loadMore,
  ]);

  async function handleCreateGroup(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    const result = await createGroup(userId, newGroupName);
    if (!mountedRef.current) return;
    setIsCreating(false);
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
    setNewGroupName("");
    refetchGroups();
  }

  async function handleDeleteGroup(group: PhotoGroup) {
    const result = await deleteGroup(group.id);
    if (!mountedRef.current) return;
    if (result === "error") {
      showNotice("Couldn't delete group — try again.");
      return;
    }
    showNotice(`Deleted "${group.name}"`);
    refetchGroups();
    if (activeGroupId === group.id) {
      setActiveGroupId(null);
    }
  }

  function openGroup(groupId: string) {
    setActiveGroupId(groupId);
    setIsSelectMode(false);
    clearSelection();
    similar.exit();
  }

  function backToList() {
    setActiveGroupId(null);
    setIsSelectMode(false);
    clearSelection();
    similar.exit();
  }

  const selectedRows: UnsortedPhoto[] =
    walkedSelection ??
    members.photos.filter((photo) => selection.isSelected(photo.id));

  const handleToggleSelect = useCallback(
    (photoId: string) => {
      setWalkedSelection(null);
      selection.toggle(photoId);
    },
    [selection],
  );

  const handleSelectAllRequest = useCallback(async () => {
    if (activeGroupId === null) return;
    setIsSelectingAll(true);
    const rows = await walkAllPages(
      (after) =>
        fetchAllPhotos(userId, {
          limit: PAGE_SIZE,
          after,
          groupId: activeGroupId,
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
  }, [userId, activeGroupId, selection, showNotice]);

  const afterBatch = useCallback(() => {
    selection.clear();
    setWalkedSelection(null);
    members.retry();
    refetchGroups();
  }, [selection, members, refetchGroups]);

  const handleRemoveFromGroup = useCallback(() => {
    if (activeGroupId === null) return;
    void massActions
      .runRemoveFromGroup(
        activeGroupId,
        selectedRows.map((row) => row.id),
      )
      .then(afterBatch);
  }, [massActions, activeGroupId, selectedRows, afterBatch]);

  const handleRemoveOne = useCallback(
    (photo: UnsortedPhoto) => {
      if (activeGroupId === null) return;
      void massActions
        .runRemoveFromGroup(activeGroupId, [photo.id])
        .then(afterBatch);
    },
    [massActions, activeGroupId, afterBatch],
  );

  if (activeGroupId !== null) {
    return (
      <div className="groups-panel">
        <button
          type="button"
          className="groups-panel__back"
          onClick={backToList}
        >
          ‹ My Groups
        </button>
        <h2>{activeGroup?.name ?? "Group"}</h2>

        {notice !== null && (
          <div
            className="groups-panel__notice"
            role="status"
            aria-live="polite"
          >
            {notice}
          </div>
        )}

        {similar.isActive ? (
          <>
            <button type="button" onClick={similar.exit}>
              ‹ Back
            </button>
            <p>
              Showing {similar.results.length} of {similar.totalReturned}{" "}
              similar photos
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
                  totalMatchingCount={memberCount}
                  onSelectAllRequest={() => void handleSelectAllRequest()}
                  isSelectingAll={isSelectingAll}
                  groups={[]}
                  showRemoveFromGroup={true}
                  onAddToGroup={() => {}}
                  onCreateGroupAndAdd={() => {}}
                  onRemoveFromGroup={handleRemoveFromGroup}
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

            {members.isInitialLoading && <p>Loading…</p>}
            {!members.isInitialLoading && members.photosLoadError && (
              <div>
                <p>Couldn't load this group's members.</p>
                <button type="button" onClick={members.retry}>
                  Try again
                </button>
              </div>
            )}
            {!members.isInitialLoading &&
              !members.photosLoadError &&
              members.photos.length === 0 && (
                <p>No photos in this group yet.</p>
              )}
            {!members.isInitialLoading &&
              !members.photosLoadError &&
              members.photos.length > 0 && (
                <>
                  <PhotoGrid
                    photos={members.photos}
                    isSelectMode={isSelectMode}
                    isSelected={selection.isSelected}
                    onToggleSelect={handleToggleSelect}
                    onOpenLightbox={onOpenLightbox}
                    onMoreLikeThis={similar.enter}
                    showRemoveButton={!isSelectMode}
                    onRemove={handleRemoveOne}
                  />
                  {members.hasMore && <div ref={loadMoreSentinelRef} />}
                </>
              )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="groups-panel">
      <button type="button" className="groups-panel__back" onClick={onClose}>
        ‹ Back to places
      </button>
      <h2>My Groups</h2>

      {notice !== null && (
        <div className="groups-panel__notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      <form onSubmit={(event) => void handleCreateGroup(event)}>
        <input
          type="text"
          value={newGroupName}
          placeholder="New group name"
          maxLength={100}
          disabled={isCreating}
          onChange={(event) => setNewGroupName(event.target.value)}
        />
        <button
          type="submit"
          disabled={isCreating || newGroupName.trim() === ""}
        >
          Create group
        </button>
      </form>

      {groups === null && !groupsLoadError && <p>Loading…</p>}
      {groupsLoadError && (
        <div>
          <p>Couldn't load groups.</p>
          <button type="button" onClick={refetchGroups}>
            Try again
          </button>
        </div>
      )}
      {groups !== null && groups.length === 0 && (
        <p>No groups yet — create one above.</p>
      )}
      {groups !== null && groups.length > 0 && (
        <ul className="groups-panel__list">
          {groups.map((group) => (
            <li key={group.id}>
              <button type="button" onClick={() => openGroup(group.id)}>
                {group.name} ({group.memberCount})
              </button>
              <button
                type="button"
                aria-label={`Delete group ${group.name}`}
                onClick={() => void handleDeleteGroup(group)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

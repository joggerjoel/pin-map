import { useState } from "react";
import type { PhotoGroup } from "../lib/photosRepository";
import type { MassActionSummary } from "../hooks/useMassActions";
import type { PinnedPlace } from "../hooks/useGeocoder";
import type { PinPlaceResult } from "../hooks/useGeocoder";

const MAX_MATCHES = 8;

export interface MassActionSelectedRow {
  id: string;
  placeQuery: string | null;
  skippedAt: string | null;
}

export interface MassActionToolbarProps {
  selectedRows: MassActionSelectedRow[];
  onClearSelection: () => void;
  // "Select all N" -- N is the badge count (may legitimately drift from
  // the walk's own real count; see image-group-plan.md, "Mass actions").
  totalMatchingCount: number | null;
  onSelectAllRequest: () => void;
  isSelectingAll: boolean;
  // Group context: present only in a group's member view (enables "Remove
  // from group") and/or when groups exist at all (enables "Add to group").
  groups: PhotoGroup[];
  showRemoveFromGroup: boolean;
  onAddToGroup: (groupId: string) => void;
  onCreateGroupAndAdd: (name: string) => void;
  onRemoveFromGroup: () => void;
  // Mass Assign reuses the same place-search UX as the single-photo assign
  // row, resolved once for the whole batch.
  pinnedPlaces: PinnedPlace[];
  canCreatePin: boolean;
  onCreatePin: (query: string) => Promise<PinPlaceResult>;
  onMassAssign: (placeQuery: string) => void;
  onMassSkip: () => void;
  onMassUnskip: () => void;
  onMassUnassign: () => void;
  isRunning: boolean;
  summary: MassActionSummary | null;
  failedCount: number;
  onRetryFailed: () => void;
  onDismissSummary: () => void;
}

function statusOf(
  row: MassActionSelectedRow,
): "unassigned" | "skipped" | "assigned" {
  if (row.placeQuery !== null) return "assigned";
  if (row.skippedAt !== null) return "skipped";
  return "unassigned";
}

function summaryText(summary: MassActionSummary): string {
  switch (summary.kind) {
    case "looped":
      return `${summary.ok} ok, ${summary.conflict} already handled elsewhere, ${summary.error} failed`;
    case "bulk-add":
      return `${summary.added} added`;
    case "bulk-remove":
      return `${summary.removed} removed`;
    case "group-not-found":
      return "This group no longer exists.";
  }
}

export function MassActionToolbar({
  selectedRows,
  onClearSelection,
  totalMatchingCount,
  onSelectAllRequest,
  isSelectingAll,
  groups,
  showRemoveFromGroup,
  onAddToGroup,
  onCreateGroupAndAdd,
  onRemoveFromGroup,
  pinnedPlaces,
  canCreatePin,
  onCreatePin,
  onMassAssign,
  onMassSkip,
  onMassUnskip,
  onMassUnassign,
  isRunning,
  summary,
  failedCount,
  onRetryFailed,
  onDismissSummary,
}: MassActionToolbarProps) {
  const [isAssigning, setIsAssigning] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isResolvingPin, setIsResolvingPin] = useState(false);

  const statuses = new Set(selectedRows.map(statusOf));
  const homogeneousStatus = statuses.size === 1 ? [...statuses][0] : null;

  const matches =
    isAssigning && searchText.trim() !== ""
      ? pinnedPlaces
          .filter((place) =>
            place.query.toLowerCase().includes(searchText.trim().toLowerCase()),
          )
          .slice(0, MAX_MATCHES)
      : [];

  async function handleCreateNewPin() {
    const query = searchText.trim();
    if (query === "" || !canCreatePin) return;
    setIsResolvingPin(true);
    const result = await onCreatePin(query);
    setIsResolvingPin(false);
    if (result.status === "ok") {
      setIsAssigning(false);
      setSearchText("");
      onMassAssign(result.query);
    }
  }

  return (
    <div className="mass-action-toolbar" role="toolbar">
      <div className="mass-action-toolbar__header">
        <span className="mass-action-toolbar__count">
          {selectedRows.length} selected
        </span>
        {totalMatchingCount !== null &&
          totalMatchingCount > selectedRows.length && (
            <button
              type="button"
              disabled={isSelectingAll || isRunning}
              onClick={onSelectAllRequest}
            >
              {isSelectingAll
                ? "Selecting…"
                : `Select all ${totalMatchingCount}`}
            </button>
          )}
        <button type="button" onClick={onClearSelection} disabled={isRunning}>
          Clear
        </button>
      </div>

      {selectedRows.length > 0 && (
        <div className="mass-action-toolbar__actions">
          {homogeneousStatus === "unassigned" && (
            <>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setIsAssigning((v) => !v)}
              >
                Assign
              </button>
              <button type="button" disabled={isRunning} onClick={onMassSkip}>
                Skip
              </button>
            </>
          )}
          {homogeneousStatus === "skipped" && (
            <button type="button" disabled={isRunning} onClick={onMassUnskip}>
              Unskip
            </button>
          )}
          {homogeneousStatus === "assigned" && (
            <button type="button" disabled={isRunning} onClick={onMassUnassign}>
              Unassign
            </button>
          )}

          {groups.length > 0 && (
            <select
              aria-label="Add to group"
              disabled={isRunning}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value !== "") {
                  onAddToGroup(event.target.value);
                  event.target.value = "";
                }
              }}
            >
              <option value="" disabled>
                Add to group…
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.memberCount})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={isRunning}
            onClick={() => setIsAddingGroup((v) => !v)}
          >
            + New group
          </button>
          {showRemoveFromGroup && (
            <button
              type="button"
              disabled={isRunning}
              onClick={onRemoveFromGroup}
            >
              Remove from group
            </button>
          )}
        </div>
      )}

      {isAddingGroup && (
        <div className="mass-action-toolbar__new-group">
          <input
            type="text"
            value={newGroupName}
            placeholder="New group name"
            maxLength={100}
            onChange={(event) => setNewGroupName(event.target.value)}
          />
          <button
            type="button"
            disabled={newGroupName.trim() === "" || isRunning}
            onClick={() => {
              onCreateGroupAndAdd(newGroupName.trim());
              setNewGroupName("");
              setIsAddingGroup(false);
            }}
          >
            Create and add
          </button>
        </div>
      )}

      {isAssigning && (
        <div className="mass-action-toolbar__assign-row">
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Place name"
            disabled={isResolvingPin}
          />
          {matches.map((place) => (
            <button
              key={place.query}
              type="button"
              disabled={isResolvingPin}
              onClick={() => {
                setIsAssigning(false);
                setSearchText("");
                onMassAssign(place.query);
              }}
            >
              {place.query}
            </button>
          ))}
          <button
            type="button"
            disabled={
              isResolvingPin || searchText.trim() === "" || !canCreatePin
            }
            title={
              !canCreatePin
                ? "Connect a Mapbox token to create new pins"
                : undefined
            }
            onClick={() => void handleCreateNewPin()}
          >
            Create new pin: "{searchText.trim()}"
          </button>
        </div>
      )}

      {summary !== null && (
        <div
          className="mass-action-toolbar__summary"
          role="status"
          aria-live="polite"
        >
          <span>{summaryText(summary)}</span>
          {summary.kind === "looped" && failedCount > 0 && (
            <button type="button" disabled={isRunning} onClick={onRetryFailed}>
              Retry {failedCount} failed
            </button>
          )}
          <button type="button" onClick={onDismissSummary}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

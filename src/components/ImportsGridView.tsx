import { useState } from "react";
import { ImportCandidateCard } from "./ImportCandidateCard";
import { groupByYear, sortCandidates } from "../lib/importCandidateOrder";
import type { ReviewOrder } from "../lib/importCandidateOrder";
import type {
  ImportCandidate,
  SplitPart,
} from "../lib/importCandidatesRepository";

export interface ImportsGridViewProps {
  /** Already triaged into buckets by the caller (see triageCandidates) —
   * this component only orders/groups/renders, it doesn't decide who goes
   * where. */
  highConfidence: ImportCandidate[];
  needsReview: ImportCandidate[];
  stillGeocoding: ImportCandidate[];
  order: ReviewOrder;
  mapboxToken: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDefer: (id: string) => void;
  onUpdate: (
    id: string,
    updates: Partial<{
      placeName: string;
      suggestedLat: number;
      suggestedLng: number;
    }>,
  ) => void;
  onSplit: (candidate: ImportCandidate, parts: SplitPart[]) => void;
  onMerge: (survivorId: string, loserIds: string[]) => void;
  onBulkApproveHighConfidence: () => void;
  onGeocodeRemaining: () => void;
  isGeocodingRemaining: boolean;
}

export function ImportsGridView({
  highConfidence,
  needsReview,
  stillGeocoding,
  order,
  mapboxToken,
  onApprove,
  onReject,
  onDefer,
  onUpdate,
  onSplit,
  onMerge,
  onBulkApproveHighConfidence,
  onGeocodeRemaining,
  isGeocodingRemaining,
}: ImportsGridViewProps) {
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(
    new Set(),
  );

  function toggleMergeSelect(id: string) {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMergeSelected() {
    const ids = [...selectedForMerge];
    if (ids.length < 2) return;
    const [survivorId, ...loserIds] = ids;
    onMerge(survivorId, loserIds);
    setSelectedForMerge(new Set());
  }

  function renderCard(candidate: ImportCandidate) {
    return (
      <ImportCandidateCard
        key={candidate.id}
        candidate={candidate}
        mapboxToken={mapboxToken}
        onApprove={() => onApprove(candidate.id)}
        onReject={() => onReject(candidate.id)}
        onDefer={() => onDefer(candidate.id)}
        onUpdate={(updates) => onUpdate(candidate.id, updates)}
        onSplit={(parts) => onSplit(candidate, parts)}
        isSelectedForMerge={selectedForMerge.has(candidate.id)}
        onToggleMergeSelect={() => toggleMergeSelect(candidate.id)}
      />
    );
  }

  const orderedHighConfidence = sortCandidates(highConfidence, order);
  const yearGroups = groupByYear(sortCandidates(needsReview, order));

  return (
    <div className="imports-grid-view">
      {highConfidence.length > 0 && (
        <section className="imports-grid-view__section">
          <div className="imports-grid-view__section-header">
            <h2>{highConfidence.length} ready to approve</h2>
            <button type="button" onClick={onBulkApproveHighConfidence}>
              Approve all {highConfidence.length}
            </button>
          </div>
          <details>
            <summary>Show cards</summary>
            <ul className="imports-grid-view__cards">
              {orderedHighConfidence.map(renderCard)}
            </ul>
          </details>
        </section>
      )}

      {[...yearGroups.entries()].map(([year, yearCandidates]) => (
        <details key={year} className="imports-grid-view__year">
          <summary>
            {year} ({yearCandidates.length})
          </summary>
          <ul className="imports-grid-view__cards">
            {yearCandidates.map(renderCard)}
          </ul>
        </details>
      ))}

      {highConfidence.length === 0 &&
        needsReview.length === 0 &&
        stillGeocoding.length === 0 && (
          <p className="imports-grid-view__empty">
            No candidates to review yet.
          </p>
        )}

      {stillGeocoding.length > 0 && (
        <div className="imports-grid-view__geocoding">
          <p>{stillGeocoding.length} still geocoding…</p>
          <button
            type="button"
            onClick={onGeocodeRemaining}
            disabled={isGeocodingRemaining}
          >
            {isGeocodingRemaining
              ? "Geocoding…"
              : `Geocode remaining ${stillGeocoding.length}`}
          </button>
        </div>
      )}

      {selectedForMerge.size >= 2 && (
        <div className="imports-grid-view__merge-bar">
          <span>{selectedForMerge.size} selected</span>
          <button type="button" onClick={handleMergeSelected}>
            Merge into one pin
          </button>
        </div>
      )}
    </div>
  );
}

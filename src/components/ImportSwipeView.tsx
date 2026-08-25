import { useEffect, useState } from "react";
import { ImportSwipeCard } from "./ImportSwipeCard";
import { sortCandidates } from "../lib/importCandidateOrder";
import type { ReviewOrder } from "../lib/importCandidateOrder";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

export interface ImportSwipeViewProps {
  /** The "needs review" bucket only — swipe mode never sees high-confidence
   * (bulk-approvable) or still-geocoding candidates. */
  candidates: ImportCandidate[];
  order: ReviewOrder;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDefer: (id: string) => void;
}

/** Owns the swipe session's own queue — a real list of ids, separate from
 * `candidates` prop order, because "later" needs to push a card to the back
 * of THIS pass without disturbing the ids ahead of it (re-deriving from
 * `sortCandidates` every render would put a deferred card right back at the
 * front if its rank happens to sort first again). */
export function ImportSwipeView({
  candidates,
  order,
  onApprove,
  onReject,
  onDefer,
}: ImportSwipeViewProps) {
  const [queue, setQueue] = useState<string[]>(() =>
    sortCandidates(candidates, order).map((c) => c.id),
  );

  // Order preference change: full reshuffle/resort, not an incremental
  // adjustment — the user explicitly asked for a different pass.
  useEffect(() => {
    setQueue(sortCandidates(candidates, order).map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // Keeps the queue in sync with the underlying candidate set (approve/
  // reject/split remove a candidate entirely; new ones can arrive mid-
  // session) without reshuffling — cards already queued keep their
  // position, new ones are appended at the end.
  useEffect(() => {
    const currentIds = new Set(candidates.map((c) => c.id));
    setQueue((prev) => {
      const stillPresent = prev.filter((id) => currentIds.has(id));
      const newIds = candidates
        .map((c) => c.id)
        .filter((id) => !prev.includes(id));
      if (stillPresent.length === prev.length && newIds.length === 0) {
        return prev;
      }
      return [...stillPresent, ...newIds];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  function handleLater(id: string) {
    onDefer(id);
    setQueue((prev) => [...prev.filter((x) => x !== id), id]);
  }

  const currentId = queue[0];
  const current = candidates.find((c) => c.id === currentId) ?? null;

  if (current === null) {
    return (
      <div className="import-swipe-view import-swipe-view--empty">
        Nothing left to review here.
      </div>
    );
  }

  return (
    <div className="import-swipe-view">
      <p className="import-swipe-view__remaining">
        {queue.length} left in this pile
      </p>
      <ImportSwipeCard
        key={current.id}
        candidate={current}
        onApprove={() => onApprove(current.id)}
        onReject={() => onReject(current.id)}
        onLater={() => handleLater(current.id)}
      />
    </div>
  );
}

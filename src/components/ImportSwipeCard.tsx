import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { buildGoogleMapsSearchUrl } from "../lib/googleMaps";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

export interface ImportSwipeCardProps {
  candidate: ImportCandidate;
  onApprove: () => void;
  onReject: () => void;
  onLater: () => void;
}

const SWIPE_THRESHOLD_PX = 100;

type DragDirection = "approve" | "reject" | "later" | null;

function directionFor(offset: { x: number; y: number }): DragDirection {
  if (offset.x > SWIPE_THRESHOLD_PX) return "approve";
  if (offset.x < -SWIPE_THRESHOLD_PX) return "reject";
  if (offset.y > SWIPE_THRESHOLD_PX) return "later";
  return null;
}

/** One card from the "needs review" pile — drag (mouse, mirroring the
 * mousedown/window-mousemove/mouseup pattern used by useSidebarLayout and
 * useGeoTrayLayout elsewhere in this app) or use the on-screen buttons or
 * arrow keys: right/✓ = approve, left/✕ = reject, down/⏸ = later. No
 * editing here by design — this mode is for quick passes; grid view is
 * where a wrong/missing location gets fixed. */
export function ImportSwipeCard({
  candidate,
  onApprove,
  onReject,
  onLater,
}: ImportSwipeCardProps) {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleMouseDown(event: ReactMouseEvent) {
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragOffset({ x: 0, y: 0 });
  }

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (dragStartRef.current === null) return;
      setDragOffset({
        x: event.clientX - dragStartRef.current.x,
        y: event.clientY - dragStartRef.current.y,
      });
    }
    function handleMouseUp() {
      if (dragStartRef.current === null) return;
      dragStartRef.current = null;
      setDragOffset((offset) => {
        const direction = offset && directionFor(offset);
        if (direction === "approve") onApprove();
        else if (direction === "reject") onReject();
        else if (direction === "later") onLater();
        return null;
      });
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onApprove, onReject, onLater]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") onApprove();
      else if (event.key === "ArrowLeft") onReject();
      else if (event.key === "ArrowDown") onLater();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onReject, onLater]);

  const hasCoordinates =
    candidate.suggestedLat !== null && candidate.suggestedLng !== null;
  const visitDate = new Date(candidate.visitTime).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );
  const direction = dragOffset && directionFor(dragOffset);
  // No transition while actively dragging (would fight the 1:1 mouse
  // tracking, feeling laggy) — only on release, so a sub-threshold drag
  // eases back to center instead of jumping there instantly.
  const style = dragOffset
    ? {
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x / 20}deg)`,
        transition: "none",
      }
    : { transition: "transform 0.25s ease-out" };

  return (
    <div
      className={
        direction
          ? `import-swipe-card import-swipe-card--${direction}`
          : "import-swipe-card"
      }
      style={style}
      onMouseDown={handleMouseDown}
      role="group"
      aria-label={`Review ${candidate.placeName}`}
    >
      <div className="import-swipe-card__name">{candidate.placeName}</div>
      <div className="import-swipe-card__date">{visitDate}</div>
      <a
        className="import-swipe-card__maps-link"
        href={buildGoogleMapsSearchUrl(candidate.placeName)}
        target="_blank"
        rel="noopener noreferrer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        Open in Google Maps
      </a>
      {candidate.note && (
        <p className="import-swipe-card__note">{candidate.note}</p>
      )}
      {!hasCoordinates && (
        <p className="import-swipe-card__status">
          no location found — switch to list view to fix
        </p>
      )}
      <div className="import-swipe-card__actions">
        <button
          type="button"
          className="import-swipe-card__reject"
          onClick={onReject}
          aria-label="Reject"
        >
          ✕
        </button>
        <button
          type="button"
          className="import-swipe-card__later"
          onClick={onLater}
          aria-label="Later"
        >
          ⏸
        </button>
        <button
          type="button"
          className="import-swipe-card__approve"
          onClick={onApprove}
          disabled={!hasCoordinates}
          aria-label="Approve"
        >
          ✓
        </button>
      </div>
    </div>
  );
}

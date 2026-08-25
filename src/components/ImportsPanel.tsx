import { useState, type ChangeEvent } from "react";
import { useImportCandidates } from "../hooks/useImportCandidates";
import { ImportsGridView } from "./ImportsGridView";
import { ImportSwipeView } from "./ImportSwipeView";
import { OrderPicker } from "./OrderPicker";
import { triageCandidates } from "../lib/importCandidateOrder";
import { ErrorBanner } from "./ErrorBanner";

export interface ImportsPanelProps {
  mapboxToken: string;
  userId: string;
  accessToken: string;
  onClose: () => void;
}

type ViewMode = "grid" | "swipe";

const BUSY_STATES = new Set(["uploading", "parsing", "geocoding"]);

export function ImportsPanel({
  mapboxToken,
  userId,
  accessToken,
  onClose,
}: ImportsPanelProps) {
  const imports = useImportCandidates(userId, accessToken);
  const isBusy = BUSY_STATES.has(imports.uploadState);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) imports.startUpload(file);
  }

  const { highConfidence, needsReview, stillGeocoding } = triageCandidates(
    imports.candidates,
  );

  return (
    <div className="imports-panel">
      <header className="imports-panel__header">
        <button type="button" className="imports-panel__back" onClick={onClose}>
          ← Back to map
        </button>
        <h1>Import from Facebook</h1>
      </header>

      <div className="imports-panel__upload">
        <label className="imports-panel__upload-label">
          <input
            type="file"
            accept=".zip"
            onChange={handleFileChange}
            disabled={isBusy}
          />
          Upload export .zip
        </label>
        {imports.uploadStatusMessage && (
          <p className="imports-panel__status">{imports.uploadStatusMessage}</p>
        )}
        {imports.uploadProgress !== null && (
          <progress
            className="imports-panel__progress"
            value={imports.uploadProgress}
            max={1}
          />
        )}
        {imports.uploadError !== null && (
          <ErrorBanner
            message={imports.uploadError}
            onRetry={imports.refresh}
          />
        )}
      </div>

      {imports.isLoadingCandidates ? (
        <p>Loading…</p>
      ) : imports.candidates.length === 0 ? (
        <p className="imports-panel__empty">
          No candidates to review yet — upload an export above to get started.
        </p>
      ) : (
        <>
          <div className="imports-panel__toolbar">
            {imports.progress.total > 0 && (
              <p className="imports-panel__progress-count">
                {imports.progress.reviewed} of {imports.progress.total} reviewed
              </p>
            )}
            <OrderPicker order={imports.order} onChange={imports.setOrder} />
            <div
              className="imports-panel__view-toggle"
              role="group"
              aria-label="Review layout"
            >
              <button
                type="button"
                className={
                  viewMode === "grid"
                    ? "imports-panel__view-toggle-button imports-panel__view-toggle-button--active"
                    : "imports-panel__view-toggle-button"
                }
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
              >
                List
              </button>
              <button
                type="button"
                className={
                  viewMode === "swipe"
                    ? "imports-panel__view-toggle-button imports-panel__view-toggle-button--active"
                    : "imports-panel__view-toggle-button"
                }
                aria-pressed={viewMode === "swipe"}
                onClick={() => setViewMode("swipe")}
              >
                Swipe
              </button>
            </div>
          </div>

          {viewMode === "grid" ? (
            <ImportsGridView
              highConfidence={highConfidence}
              needsReview={needsReview}
              stillGeocoding={stillGeocoding}
              order={imports.order}
              mapboxToken={mapboxToken}
              onApprove={(id) => void imports.approve(id)}
              onReject={(id) => void imports.reject(id)}
              onDefer={(id) => void imports.defer(id)}
              onUpdate={(id, updates) =>
                void imports.updateCandidate(id, updates)
              }
              onSplit={(candidate, parts) =>
                void imports.split(candidate, parts)
              }
              onMerge={(survivorId, loserIds) =>
                void imports.merge(survivorId, loserIds)
              }
              onBulkApproveHighConfidence={() =>
                void imports.bulkApproveHighConfidence()
              }
              onGeocodeRemaining={() => void imports.geocodeRemaining()}
              isGeocodingRemaining={imports.isGeocodingRemaining}
            />
          ) : (
            <ImportSwipeView
              candidates={needsReview}
              order={imports.order}
              onApprove={(id) => void imports.approve(id)}
              onReject={(id) => void imports.reject(id)}
              onDefer={(id) => void imports.defer(id)}
            />
          )}
        </>
      )}
    </div>
  );
}

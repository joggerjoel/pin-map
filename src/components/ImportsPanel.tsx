import type { ChangeEvent } from "react";
import { useImportCandidates } from "../hooks/useImportCandidates";
import { ImportCandidateCard } from "./ImportCandidateCard";
import { ErrorBanner } from "./ErrorBanner";

export interface ImportsPanelProps {
  mapboxToken: string;
  userId: string;
  accessToken: string;
  onClose: () => void;
}

const BUSY_STATES = new Set(["uploading", "parsing", "geocoding"]);

export function ImportsPanel({
  mapboxToken,
  userId,
  accessToken,
  onClose,
}: ImportsPanelProps) {
  const imports = useImportCandidates(userId, accessToken);
  const isBusy = BUSY_STATES.has(imports.uploadState);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) imports.startUpload(file);
  }

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
        <ul className="imports-panel__list">
          {imports.candidates.map((candidate) => (
            <ImportCandidateCard
              key={candidate.id}
              candidate={candidate}
              mapboxToken={mapboxToken}
              onApprove={() => void imports.approve(candidate.id)}
              onReject={() => void imports.reject(candidate.id)}
              onDefer={() => void imports.defer(candidate.id)}
              onUpdate={(updates) =>
                void imports.updateCandidate(candidate.id, updates)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

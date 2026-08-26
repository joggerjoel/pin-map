import type { UnsortedPhoto } from "../lib/photosRepository";
import { unsortedPhotoUrl } from "../lib/photosRepository";

// Shared, simplified photo grid for the Browse view and a group's member
// view -- neither needs the triage tabs' per-card assign/skip/rename UI
// (image-group-plan.md never asks for it on these surfaces), which is what
// makes a genuinely shared grid component practical without refactoring
// UnsortedPhotosPanel's more complex card.
export interface PhotoGridProps {
  photos: UnsortedPhoto[];
  isSelectMode: boolean;
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onOpenLightbox: (url: string, alt: string) => void;
  onMoreLikeThis: (photo: UnsortedPhoto) => void;
  showRemoveButton: boolean;
  onRemove?: (photo: UnsortedPhoto) => void;
}

export function PhotoGrid({
  photos,
  isSelectMode,
  isSelected,
  onToggleSelect,
  onOpenLightbox,
  onMoreLikeThis,
  showRemoveButton,
  onRemove,
}: PhotoGridProps) {
  return (
    <ul className="photo-grid">
      {photos.map((photo) => {
        const alt = photo.storagePath.split("/").pop() ?? "";
        return (
          <li key={photo.id} className="photo-grid__card">
            {isSelectMode && (
              <input
                type="checkbox"
                className="photo-grid__checkbox"
                aria-label={`Select photo ${photo.id.slice(0, 8)}`}
                checked={isSelected(photo.id)}
                onChange={() => onToggleSelect(photo.id)}
              />
            )}
            {showRemoveButton && (
              <button
                type="button"
                className="photo-grid__remove"
                aria-label={`Remove photo ${photo.id.slice(0, 8)} from group`}
                onClick={() => onRemove?.(photo)}
              >
                ×
              </button>
            )}
            {photo.kind === "image" ? (
              <button
                type="button"
                className="photo-grid__preview"
                aria-label="Preview photo"
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
            ) : (
              <button
                type="button"
                className="photo-grid__preview"
                aria-label="Preview video"
                onClick={() =>
                  onOpenLightbox(unsortedPhotoUrl(photo, "full"), alt)
                }
              >
                <video
                  src={unsortedPhotoUrl(photo, "full")}
                  preload="metadata"
                  muted
                />
              </button>
            )}
            <p className="photo-grid__label">
              {photo.label ?? photo.id.slice(0, 8)}
            </p>
            {photo.placeQuery !== null && (
              <p className="photo-grid__place">{photo.placeQuery}</p>
            )}
            {photo.caption !== null && (
              <button
                type="button"
                className="photo-grid__more-like-this"
                onClick={() => onMoreLikeThis(photo)}
              >
                More like this
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

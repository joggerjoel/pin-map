import { useEffect, useState } from "react";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";
import { displayName } from "../lib/rosterName";

export interface PersonPhotoModalProps {
  person: RosterPerson;
  photos: RosterPersonPhoto[];
  onAddPhoto: (file: File, year: number | null) => void;
  onClose: () => void;
}

export function PersonPhotoModal({
  person,
  photos,
  onAddPhoto,
  onClose,
}: PersonPhotoModalProps) {
  const [yearText, setYearText] = useState("");
  const name = displayName(person);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return (
    <div
      className="person-photo-modal__backdrop"
      onClick={onClose}
      role="dialog"
      aria-label={`Photos of ${name}`}
    >
      <div
        className="person-photo-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="person-photo-modal__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <img
          className="person-photo-modal__avatar"
          src={person.imageUrl}
          alt={name}
        />
        <h2>{name}</h2>
        {photos.length > 0 && (
          <ul className="person-photo-modal__gallery">
            {photos.map((photo) => (
              <li key={photo.id}>
                <img
                  src={photo.url}
                  alt={photo.year !== null ? `${name}, ${photo.year}` : name}
                />
                {photo.year !== null && <span>{photo.year}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="person-photo-modal__actions">
          <label className="person-photo-modal__upload">
            Add recent photo
            <input
              type="file"
              accept="image/*"
              aria-label="Add a recent photo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onAddPhoto(file, null);
                }
                event.target.value = "";
              }}
            />
          </label>
          <div className="person-photo-modal__dated">
            <input
              type="number"
              aria-label="Year"
              placeholder="Year"
              value={yearText}
              onChange={(event) => setYearText(event.target.value)}
            />
            <label className="person-photo-modal__upload">
              Add dated photo
              <input
                type="file"
                accept="image/*"
                aria-label="Add a dated photo"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  const trimmed = yearText.trim();
                  const year = trimmed === "" ? null : Number(trimmed);
                  if (file) {
                    onAddPhoto(file, year);
                  }
                  event.target.value = "";
                  setYearText("");
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

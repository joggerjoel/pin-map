import { useState } from "react";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";

export type PinTag =
  | { kind: "category"; value: PlaceCategory }
  | { kind: "icon"; value: PlaceIcon }
  | { kind: "custom"; value: CustomTag };

interface TagOption {
  tag: PinTag;
  label: string;
  color: string;
}

export const TAG_OPTIONS: TagOption[] = [
  {
    tag: { kind: "category", value: "visited" },
    label: "Visited",
    color: "#3b82f6",
  },
  {
    tag: { kind: "category", value: "lived" },
    label: "Lived",
    color: "#f97316",
  },
  {
    tag: { kind: "category", value: "hometown" },
    label: "Hometown",
    color: "#eab308",
  },
  {
    tag: { kind: "icon", value: "triathlete" },
    label: "Ironman",
    color: "#dc2626",
  },
];

function tagsEqual(a: PinTag, b: PinTag): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "custom" && b.kind === "custom") {
    return a.value.id === b.value.id;
  }
  if (a.kind === "custom" || b.kind === "custom") return false;
  return a.value === b.value;
}

export interface TagPickerProps {
  selectedTag: PinTag | null;
  onSelect: (tag: PinTag) => void;
  customTags: CustomTag[];
  onCreateCustomTag: (label: string, color: string) => void;
}

export function TagPicker({
  selectedTag,
  onSelect,
  customTags,
  onCreateCustomTag,
}: TagPickerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#8b5cf6");

  return (
    <div className="tag-picker" role="radiogroup" aria-label="Pin icon">
      {TAG_OPTIONS.map((option) => {
        const isSelected =
          selectedTag !== null && tagsEqual(option.tag, selectedTag);
        return (
          <button
            type="button"
            key={option.label}
            aria-label={option.label}
            aria-pressed={isSelected}
            className={
              isSelected
                ? "tag-picker__swatch tag-picker__swatch--selected"
                : "tag-picker__swatch"
            }
            style={{ backgroundColor: option.color }}
            onClick={() => onSelect(option.tag)}
          >
            {option.tag.kind === "icon" &&
              option.tag.value === "triathlete" && (
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <circle
                    cx={TRIATHLETE_ICON_HEAD.cx}
                    cy={TRIATHLETE_ICON_HEAD.cy}
                    r={TRIATHLETE_ICON_HEAD.r}
                    fill="#ffffff"
                  />
                  <path d={TRIATHLETE_ICON_BODY_PATH} fill="#ffffff" />
                </svg>
              )}
            {option.tag.kind === "category" &&
              option.tag.value === "hometown" && (
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d={HOUSE_ICON_PATH} fill="#ffffff" />
                </svg>
              )}
          </button>
        );
      })}
      {customTags.map((tag) => {
        const pinTag: PinTag = { kind: "custom", value: tag };
        const isSelected =
          selectedTag !== null && tagsEqual(pinTag, selectedTag);
        return (
          <button
            type="button"
            key={tag.id}
            aria-label={tag.label}
            aria-pressed={isSelected}
            className={
              isSelected
                ? "tag-picker__swatch tag-picker__swatch--selected"
                : "tag-picker__swatch"
            }
            style={{ backgroundColor: tag.color }}
            onClick={() => onSelect(pinTag)}
          />
        );
      })}
      {!isCreating ? (
        <button
          type="button"
          className="tag-picker__add"
          aria-label="Create a custom pin type"
          onClick={() => setIsCreating(true)}
        >
          +
        </button>
      ) : (
        <div className="tag-picker__create">
          <input
            type="text"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="Name"
            aria-label="New pin type name"
          />
          <input
            type="color"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            aria-label="New pin type color"
          />
          <button
            type="button"
            onClick={() => {
              if (newLabel.trim() === "") return;
              onCreateCustomTag(newLabel, newColor);
              setNewLabel("");
              setNewColor("#8b5cf6");
              setIsCreating(false);
            }}
          >
            Create
          </button>
          <button type="button" onClick={() => setIsCreating(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

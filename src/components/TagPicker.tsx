import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";

export type PinTag =
  | { kind: "category"; value: PlaceCategory }
  | { kind: "icon"; value: PlaceIcon };

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
  return a.kind === b.kind && a.value === b.value;
}

export interface TagPickerProps {
  selectedTag: PinTag | null;
  onSelect: (tag: PinTag) => void;
}

export function TagPicker({ selectedTag, onSelect }: TagPickerProps) {
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
    </div>
  );
}

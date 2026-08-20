import { useMemo, useRef, useState } from "react";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "../lib/iconShapes";
import { getTagOrder, saveTagOrder } from "../lib/tagOrder";

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

function tagKey(tag: PinTag): string {
  if (tag.kind === "custom") {
    return `custom:${tag.value.id}`;
  }
  return `${tag.kind}:${tag.value}`;
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
  const [order, setOrder] = useState<string[]>(() => getTagOrder());

  const allOptions = useMemo(() => {
    const customOptions = customTags.map((tag) => ({
      tag: { kind: "custom" as const, value: tag },
      label: tag.label,
      color: tag.color,
    }));
    return [...TAG_OPTIONS, ...customOptions];
  }, [customTags]);

  const orderedOptions = useMemo(() => {
    const byKey = new Map(
      allOptions.map((option) => [tagKey(option.tag), option]),
    );
    const ordered = order
      .map((key) => byKey.get(key))
      .filter(
        (option): option is (typeof allOptions)[number] => option !== undefined,
      );
    const orderedKeySet = new Set(ordered.map((option) => tagKey(option.tag)));
    const remaining = allOptions.filter(
      (option) => !orderedKeySet.has(tagKey(option.tag)),
    );
    return [...ordered, ...remaining];
  }, [allOptions, order]);

  const draggedKeyRef = useRef<string | null>(null);

  function handleDrop(targetKey: string) {
    const draggedKey = draggedKeyRef.current;
    draggedKeyRef.current = null;
    if (draggedKey === null || draggedKey === targetKey) {
      return;
    }
    const currentKeys = orderedOptions.map((option) => tagKey(option.tag));
    const fromIndex = currentKeys.indexOf(draggedKey);
    const toIndex = currentKeys.indexOf(targetKey);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }
    const newOrder = [...currentKeys];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    setOrder(newOrder);
    saveTagOrder(newOrder);
  }

  return (
    <div className="tag-picker" role="radiogroup" aria-label="Pin icon">
      {orderedOptions.map((option) => {
        const key = tagKey(option.tag);
        const isSelected =
          selectedTag !== null && tagsEqual(option.tag, selectedTag);
        return (
          <button
            type="button"
            key={key}
            draggable
            aria-label={option.label}
            aria-pressed={isSelected}
            className={
              isSelected
                ? "tag-picker__swatch tag-picker__swatch--selected"
                : "tag-picker__swatch"
            }
            style={{ backgroundColor: option.color }}
            onClick={() => onSelect(option.tag)}
            onDragStart={() => {
              draggedKeyRef.current = key;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(key)}
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

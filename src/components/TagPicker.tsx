import { useMemo, useRef, useState } from "react";
import type { PlaceCategory } from "../lib/checklist";
import type { PlaceIcon } from "../lib/placeTags";
import type { CustomTag } from "../lib/customTags";
import {
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
  AIRPLANE_ICON_PATH,
} from "../lib/iconShapes";
import { getTagOrder, saveTagOrder } from "../lib/tagOrder";
import { BUILTIN_TAG_KEYS, BUILTIN_TAG_LABELS } from "../lib/tagAppearance";
import type {
  BuiltinTagKey,
  IconShape,
  TagAppearance,
} from "../lib/tagAppearance";

export type PinTag =
  | { kind: "category"; value: PlaceCategory }
  | { kind: "icon"; value: PlaceIcon }
  | { kind: "custom"; value: CustomTag };

// "Hometown"/"Ironman"/"Airport" are represented as `icon` values on a
// place, "Visited"/"Lived"/"Hometown" as `category` values (hometown can be
// reached either way, depending on whether it came from checklist
// auto-detection or a free-text "(home)" tag) — this maps each conceptual
// built-in tag to the PinTag it assigns when selected.
const BUILTIN_TAGS: Record<BuiltinTagKey, PinTag> = {
  visited: { kind: "category", value: "visited" },
  lived: { kind: "category", value: "lived" },
  hometown: { kind: "category", value: "hometown" },
  ironman: { kind: "icon", value: "triathlete" },
  airport: { kind: "icon", value: "airplane" },
};

export const DEFAULT_TAG: PinTag = BUILTIN_TAGS.visited;

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

interface TagOption {
  key: string;
  tag: PinTag;
  label: string;
  color: string;
  iconShape: IconShape;
  builtinKey: BuiltinTagKey | null;
  customTagId: string | null;
}

export interface TagPickerProps {
  selectedTag: PinTag | null;
  onSelect: (tag: PinTag) => void;
  customTags: CustomTag[];
  onCreateCustomTag: (
    label: string,
    color: string,
    iconShape: IconShape,
  ) => void;
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>;
  onEditBuiltinTag: (key: BuiltinTagKey, appearance: TagAppearance) => void;
  onEditCustomTag: (
    id: string,
    updates: { label: string; color: string; iconShape: IconShape },
  ) => void;
}

function renderIconGlyph(shape: IconShape) {
  if (shape === "house") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d={HOUSE_ICON_PATH} fill="#ffffff" />
      </svg>
    );
  }
  if (shape === "triathlete") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <circle
          cx={TRIATHLETE_ICON_HEAD.cx}
          cy={TRIATHLETE_ICON_HEAD.cy}
          r={TRIATHLETE_ICON_HEAD.r}
          fill="#ffffff"
        />
        <path d={TRIATHLETE_ICON_BODY_PATH} fill="#ffffff" />
      </svg>
    );
  }
  if (shape === "airplane") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d={AIRPLANE_ICON_PATH} fill="#ffffff" />
      </svg>
    );
  }
  return null;
}

export function TagPicker({
  selectedTag,
  onSelect,
  customTags,
  onCreateCustomTag,
  builtinAppearance,
  onEditBuiltinTag,
  onEditCustomTag,
}: TagPickerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#8b5cf6");
  const [newIconShape, setNewIconShape] = useState<IconShape>("none");
  const [order, setOrder] = useState<string[]>(() => getTagOrder());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("#000000");
  const [editIconShape, setEditIconShape] = useState<IconShape>("none");

  const allOptions = useMemo<TagOption[]>(() => {
    const builtinOptions: TagOption[] = BUILTIN_TAG_KEYS.map((builtinKey) => ({
      key: tagKey(BUILTIN_TAGS[builtinKey]),
      tag: BUILTIN_TAGS[builtinKey],
      label: BUILTIN_TAG_LABELS[builtinKey],
      color: builtinAppearance[builtinKey].color,
      iconShape: builtinAppearance[builtinKey].iconShape,
      builtinKey,
      customTagId: null,
    }));
    const customOptions: TagOption[] = customTags.map((tag) => ({
      key: tagKey({ kind: "custom", value: tag }),
      tag: { kind: "custom" as const, value: tag },
      label: tag.label,
      color: tag.color,
      iconShape: tag.iconShape,
      builtinKey: null,
      customTagId: tag.id,
    }));
    return [...builtinOptions, ...customOptions];
  }, [builtinAppearance, customTags]);

  const orderedOptions = useMemo(() => {
    const byKey = new Map(allOptions.map((option) => [option.key, option]));
    const ordered = order
      .map((key) => byKey.get(key))
      .filter((option): option is TagOption => option !== undefined);
    const orderedKeySet = new Set(ordered.map((option) => option.key));
    const remaining = allOptions.filter(
      (option) => !orderedKeySet.has(option.key),
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
    const currentKeys = orderedOptions.map((option) => option.key);
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

  function startEditing(option: TagOption) {
    setEditingKey(option.key);
    setEditLabel(option.label);
    setEditColor(option.color);
    setEditIconShape(option.iconShape);
  }

  function saveEdit(option: TagOption) {
    if (option.builtinKey !== null) {
      onEditBuiltinTag(option.builtinKey, {
        color: editColor,
        iconShape: editIconShape,
      });
    } else if (option.customTagId !== null) {
      onEditCustomTag(option.customTagId, {
        label: editLabel,
        color: editColor,
        iconShape: editIconShape,
      });
    }
    setEditingKey(null);
  }

  return (
    <div className="tag-picker" role="radiogroup" aria-label="Pin icon">
      {orderedOptions.map((option) => {
        const isSelected =
          selectedTag !== null && tagsEqual(option.tag, selectedTag);
        return (
          <div className="tag-picker__option" key={option.key}>
            <button
              type="button"
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
                draggedKeyRef.current = option.key;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(option.key)}
            >
              {renderIconGlyph(option.iconShape)}
            </button>
            <button
              type="button"
              className="tag-picker__edit"
              aria-label={`Edit ${option.label}`}
              onClick={() => startEditing(option)}
            >
              ✎
            </button>
            {editingKey === option.key && (
              <div className="tag-picker__edit-form">
                <input
                  type="text"
                  value={editLabel}
                  onChange={(event) => setEditLabel(event.target.value)}
                  aria-label={`${option.label} name`}
                  disabled={option.builtinKey !== null}
                />
                <input
                  type="color"
                  value={editColor}
                  onChange={(event) => setEditColor(event.target.value)}
                  aria-label={`${option.label} color`}
                />
                <select
                  value={editIconShape}
                  onChange={(event) =>
                    setEditIconShape(event.target.value as IconShape)
                  }
                  aria-label={`${option.label} icon shape`}
                >
                  <option value="none">None</option>
                  <option value="house">House</option>
                  <option value="triathlete">Triathlete</option>
                  <option value="airplane">Airplane</option>
                </select>
                <button type="button" onClick={() => saveEdit(option)}>
                  Save
                </button>
                <button type="button" onClick={() => setEditingKey(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
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
          <select
            value={newIconShape}
            onChange={(event) =>
              setNewIconShape(event.target.value as IconShape)
            }
            aria-label="New pin type icon shape"
          >
            <option value="none">None</option>
            <option value="house">House</option>
            <option value="triathlete">Triathlete</option>
            <option value="airplane">Airplane</option>
          </select>
          <button
            type="button"
            onClick={() => {
              if (newLabel.trim() === "") return;
              onCreateCustomTag(newLabel, newColor, newIconShape);
              setNewLabel("");
              setNewColor("#8b5cf6");
              setNewIconShape("none");
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

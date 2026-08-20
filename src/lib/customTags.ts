import type { IconShape } from "./tagAppearance";

export interface CustomTag {
  id: string;
  label: string;
  color: string;
  iconShape: IconShape;
}

const STORAGE_KEY = "pin-map:custom-tags";

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isIconShape(value: unknown): value is IconShape {
  return (
    value === "house" ||
    value === "triathlete" ||
    value === "airplane" ||
    value === "none"
  );
}

export function getCustomTags(): CustomTag[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is Record<string, unknown> => {
        if (typeof item !== "object" || item === null) return false;
        const candidate = item as Record<string, unknown>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.label === "string" &&
          typeof candidate.color === "string"
        );
      })
      .map((candidate) => ({
        id: candidate.id as string,
        label: candidate.label as string,
        color: candidate.color as string,
        iconShape: isIconShape(candidate.iconShape)
          ? candidate.iconShape
          : "none",
      }));
  } catch {
    return [];
  }
}

function saveCustomTags(tags: CustomTag[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
}

export function addCustomTag(
  label: string,
  color: string,
  iconShape: IconShape = "none",
): CustomTag[] {
  const trimmed = label.trim();
  const id = slugify(trimmed);
  const existing = getCustomTags();
  if (id === "" || existing.some((tag) => tag.id === id)) {
    return existing;
  }
  const updated = [...existing, { id, label: trimmed, color, iconShape }];
  saveCustomTags(updated);
  return updated;
}

export function updateCustomTag(
  id: string,
  updates: { label: string; color: string; iconShape: IconShape },
): CustomTag[] {
  const existing = getCustomTags();
  const updated = existing.map((tag) =>
    tag.id === id
      ? {
          ...tag,
          label: updates.label.trim() === "" ? tag.label : updates.label.trim(),
          color: updates.color,
          iconShape: updates.iconShape,
        }
      : tag,
  );
  saveCustomTags(updated);
  return updated;
}

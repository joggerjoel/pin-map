export interface CustomTag {
  id: string;
  label: string;
  color: string;
}

const STORAGE_KEY = "pin-map:custom-tags";

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    return parsed.filter((item): item is CustomTag => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.label === "string" &&
        typeof candidate.color === "string"
      );
    });
  } catch {
    return [];
  }
}

function saveCustomTags(tags: CustomTag[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
}

export function addCustomTag(label: string, color: string): CustomTag[] {
  const trimmed = label.trim();
  const id = slugify(trimmed);
  const existing = getCustomTags();
  if (id === "" || existing.some((tag) => tag.id === id)) {
    return existing;
  }
  const updated = [...existing, { id, label: trimmed, color }];
  saveCustomTags(updated);
  return updated;
}

const STORAGE_KEY = "pin-map:tag-order";

export function getTagOrder(): string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function saveTagOrder(order: string[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

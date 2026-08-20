export type IconShape =
  "house" | "triathlete" | "airplane" | "ski" | "run" | "none";

export interface TagAppearance {
  color: string;
  iconShape: IconShape;
}

export type BuiltinTagKey =
  | "visited"
  | "lived"
  | "hometown"
  | "ironman"
  | "airport"
  | "current"
  | "ski"
  | "run";

export const BUILTIN_TAG_KEYS: BuiltinTagKey[] = [
  "visited",
  "lived",
  "hometown",
  "ironman",
  "airport",
  "current",
  "ski",
  "run",
];

export const BUILTIN_TAG_LABELS: Record<BuiltinTagKey, string> = {
  visited: "Visited",
  lived: "Lived",
  hometown: "Hometown",
  ironman: "Ironman",
  airport: "Airport",
  current: "Current",
  ski: "Ski",
  run: "Run",
};

export const BUILTIN_APPEARANCE_DEFAULTS: Record<BuiltinTagKey, TagAppearance> =
  {
    visited: { color: "#3b82f6", iconShape: "none" },
    lived: { color: "#f97316", iconShape: "house" },
    hometown: { color: "#eab308", iconShape: "house" },
    ironman: { color: "#dc2626", iconShape: "triathlete" },
    airport: { color: "#0891b2", iconShape: "airplane" },
    current: { color: "#16a34a", iconShape: "house" },
    ski: { color: "#0ea5e9", iconShape: "ski" },
    run: { color: "#f43f5e", iconShape: "run" },
  };

const STORAGE_KEY = "pin-map:tag-appearance-overrides";

function isIconShape(value: unknown): value is IconShape {
  return (
    value === "house" ||
    value === "triathlete" ||
    value === "airplane" ||
    value === "ski" ||
    value === "run" ||
    value === "none"
  );
}

function readOverrides(): Partial<Record<BuiltinTagKey, TagAppearance>> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const result: Partial<Record<BuiltinTagKey, TagAppearance>> = {};
    for (const key of BUILTIN_TAG_KEYS) {
      const candidate = (parsed as Record<string, unknown>)[key];
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as Record<string, unknown>).color === "string" &&
        isIconShape((candidate as Record<string, unknown>).iconShape)
      ) {
        result[key] = candidate as TagAppearance;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function getResolvedBuiltinAppearance(): Record<
  BuiltinTagKey,
  TagAppearance
> {
  const overrides = readOverrides();
  const resolved = {} as Record<BuiltinTagKey, TagAppearance>;
  for (const key of BUILTIN_TAG_KEYS) {
    resolved[key] = overrides[key] ?? BUILTIN_APPEARANCE_DEFAULTS[key];
  }
  return resolved;
}

export function saveTagAppearanceOverride(
  key: BuiltinTagKey,
  appearance: TagAppearance,
): void {
  const overrides = readOverrides();
  overrides[key] = appearance;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

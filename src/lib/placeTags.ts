export type PlaceIcon = "triathlete" | "house";

const TAG_ICONS: Record<string, PlaceIcon> = {
  ironman: "triathlete",
  home: "house",
};

export interface ParsedTag {
  query: string;
  icon: PlaceIcon | undefined;
}

export function extractPlaceIcon(rawLine: string): ParsedTag {
  const match = rawLine.match(/\(([^)]+)\)/);
  if (match === null) {
    return { query: rawLine.trim(), icon: undefined };
  }

  const tag = match[1].trim().toLowerCase();
  const icon = TAG_ICONS[tag];
  if (icon === undefined) {
    return { query: rawLine.trim(), icon: undefined };
  }

  const query = rawLine.replace(match[0], "").trim().replace(/,\s*$/, "");
  return { query, icon };
}

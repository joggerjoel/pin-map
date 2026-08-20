import { extractPlaceIcon } from "./placeTags";
import type { PlaceIcon } from "./placeTags";
import { extractExplicitCoords } from "./explicitCoords";

export interface PlainLineResult {
  name: string;
  icon: PlaceIcon | undefined;
  explicitCoords: { lat: number; lng: number } | undefined;
}

export function resolvePlainLineName(line: string): PlainLineResult {
  const { query, icon } = extractPlaceIcon(line);
  const explicit = extractExplicitCoords(query);
  if (explicit !== null) {
    return {
      name: explicit.name,
      icon,
      explicitCoords: { lat: explicit.lat, lng: explicit.lng },
    };
  }
  return { name: query, icon, explicitCoords: undefined };
}

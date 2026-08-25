import type { PinnedPlace } from "../hooks/useGeocoder";
import {
  BUILTIN_TAG_LABELS,
  type BuiltinTagKey,
  type IconShape,
  type TagAppearance,
} from "./tagAppearance";

/** Which builtin tag (if any) a place's `icon`/`category` fields resolve
 * to. Shared by MapView's legend and the geo browse tray's per-item
 * dominant-tag icon, so both use exactly the same classification. */
export function resolveBuiltinKey(
  place: PinnedPlace,
): BuiltinTagKey | undefined {
  if (place.icon === "triathlete") return "ironman";
  if (place.icon === "house-home") return "hometown";
  if (place.icon === "house-live") return "lived";
  if (place.icon === "house-current") return "current";
  if (place.icon === "house-future") return "future";
  if (place.icon === "airplane") return "airport";
  if (place.icon === "ski") return "ski";
  if (place.icon === "run") return "run";
  if (place.category) return place.category;
  return undefined;
}

export interface PlaceAppearance {
  legendKey: string;
  label: string;
  color: string;
  iconShape: IconShape;
}

/** A place's full visual classification — its custom tag if it has one,
 * otherwise its resolved builtin tag, otherwise undefined (an untagged
 * place contributes to no legend entry and no dominant-tag icon). */
export function classifyPlace(
  place: PinnedPlace,
  builtinAppearance: Record<BuiltinTagKey, TagAppearance>,
): PlaceAppearance | undefined {
  if (place.customTag) {
    return {
      legendKey: `custom:${place.customTag.id}`,
      label: place.customTag.label,
      color: place.customTag.color,
      iconShape: place.customTag.iconShape,
    };
  }
  const builtinKey = resolveBuiltinKey(place);
  if (builtinKey === undefined) return undefined;
  return {
    legendKey: builtinKey,
    label: BUILTIN_TAG_LABELS[builtinKey],
    color: builtinAppearance[builtinKey].color,
    iconShape: builtinAppearance[builtinKey].iconShape,
  };
}

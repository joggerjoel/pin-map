import type { IconShape } from "./tagAppearance";
import {
  AIRPLANE_ICON_PATH,
  HOUSE_ICON_PATH,
  RUN_ICON_PATH,
  SKI_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
  TRIATHLETE_ICON_HEAD,
} from "./iconShapes";

/** Renders the small white glyph used inside a colored tag swatch —
 * shared by TagPicker's tag list and MapView's legend, so the icon SVGs
 * are defined in exactly one place. */
export function renderIconGlyph(shape: IconShape) {
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
  if (shape === "ski") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d={SKI_ICON_PATH} fill="#ffffff" />
      </svg>
    );
  }
  if (shape === "run") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d={RUN_ICON_PATH} fill="#ffffff" />
      </svg>
    );
  }
  return null;
}

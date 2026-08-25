const COLLAPSED_KEY = "pin-map:geo-tray-collapsed";
const HEIGHT_KEY = "pin-map:geo-tray-height";

export const DEFAULT_GEO_TRAY_HEIGHT = 160;
export const MIN_GEO_TRAY_HEIGHT = 90;
// The maximum is dynamic (a quarter of the viewport height, see
// useGeoTrayLayout) — there's no fixed max constant here, unlike the
// sidebar's width.

export function getGeoTrayCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

export function saveGeoTrayCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
}

export function getGeoTrayHeight(): number {
  const raw = window.localStorage.getItem(HEIGHT_KEY);
  if (raw === null) return DEFAULT_GEO_TRAY_HEIGHT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_GEO_TRAY_HEIGHT;
  return Math.max(MIN_GEO_TRAY_HEIGHT, parsed);
}

export function saveGeoTrayHeight(height: number): void {
  window.localStorage.setItem(HEIGHT_KEY, String(height));
}

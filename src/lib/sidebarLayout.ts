const WIDTH_KEY = "pin-map:sidebar-width";
const COLLAPSED_KEY = "pin-map:sidebar-collapsed";

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 640;

export function getSidebarWidth(): number {
  const raw = window.localStorage.getItem(WIDTH_KEY);
  if (raw === null) return DEFAULT_SIDEBAR_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
}

export function saveSidebarWidth(width: number): void {
  window.localStorage.setItem(WIDTH_KEY, String(width));
}

export function getSidebarCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
}

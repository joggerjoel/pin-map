const COLLAPSED_KEY = "pin-map:legend-collapsed";

export function getLegendCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

export function saveLegendCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
}

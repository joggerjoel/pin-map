const STORAGE_KEY = "pin-map:declutter-enabled";

export function getDeclutterEnabled(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function saveDeclutterEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

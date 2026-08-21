const STORAGE_KEY = "pin-map:declutter-enabled";

export function getDeclutterEnabled(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function saveDeclutterEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

// Separate key from the travel map's — the class-reunion avatar clusters
// (classmates from the same city) are dense enough that Spider should
// default to on there, without changing the travel map's own default or
// having the two toggles interfere with each other.
const CLASS_STORAGE_KEY = "pin-map:class-declutter-enabled";

export function getClassDeclutterEnabled(): boolean {
  const stored = window.localStorage.getItem(CLASS_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export function saveClassDeclutterEnabled(enabled: boolean): void {
  window.localStorage.setItem(CLASS_STORAGE_KEY, String(enabled));
}

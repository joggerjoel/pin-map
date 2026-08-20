const STORAGE_KEY = "pin-map:mapbox-token";

export function getMapboxToken(): string | null {
  const envToken = import.meta.env.VITE_MAPBOX_TOKEN;
  if (envToken) {
    return envToken;
  }
  return window.localStorage.getItem(STORAGE_KEY);
}

// Unlike getMapboxToken, ignores the bundled env token entirely — used to
// resolve the token for an account that's been forced off the shared token
// (see tokenUsage.ts), where only a token the user personally entered counts.
export function getPersonalMapboxToken(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setMapboxToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearMapboxToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

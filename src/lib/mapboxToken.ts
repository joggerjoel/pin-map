const STORAGE_KEY = "pin-map:mapbox-token";

export function getMapboxToken(): string | null {
  const envToken = import.meta.env.VITE_MAPBOX_TOKEN;
  if (envToken) {
    return envToken;
  }
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setMapboxToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

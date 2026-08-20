import { parseGoogleMapsUrl, parseLatLngPair } from "./googleMaps";

export function resolveLocationInput(
  query: string,
  text: string,
  onRelocate: (query: string, searchText: string) => void,
  onSetLocation: (query: string, lat: number, lng: number) => void,
): void {
  const fromUrl = parseGoogleMapsUrl(text);
  if (fromUrl) {
    onSetLocation(query, fromUrl.lat, fromUrl.lng);
    return;
  }
  const fromPair = parseLatLngPair(text);
  if (fromPair) {
    onSetLocation(query, fromPair.lat, fromPair.lng);
    return;
  }
  onRelocate(query, text);
}

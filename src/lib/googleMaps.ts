export function buildGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function parseGoogleMapsUrl(
  url: string,
): { lat: number; lng: number } | null {
  const preciseMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (preciseMatch) {
    return {
      lat: parseFloat(preciseMatch[1]),
      lng: parseFloat(preciseMatch[2]),
    };
  }

  const queryMatch = url.match(/[?&]query=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (queryMatch) {
    return { lat: parseFloat(queryMatch[1]), lng: parseFloat(queryMatch[2]) };
  }

  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  return null;
}

export function parseLatLngPair(
  text: string,
): { lat: number; lng: number } | null {
  const match = text.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (match === null) {
    return null;
  }
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return { lat, lng };
}

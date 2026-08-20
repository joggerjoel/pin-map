export interface ExplicitCoords {
  name: string;
  lat: number;
  lng: number;
}

const EXPLICIT_COORDS_PATTERN =
  /,\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*(?:,\s*)?$/;

export function extractExplicitCoords(line: string): ExplicitCoords | null {
  const match = line.match(EXPLICIT_COORDS_PATTERN);
  if (match === null) {
    return null;
  }
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  const name = line.slice(0, match.index).trim().replace(/,\s*$/, "");
  if (name === "") {
    return null;
  }
  return { name, lat, lng };
}

export interface GeocodeResult {
  query: string;
  name: string;
  lng: number;
  lat: number;
}

export interface GeocodeBatchResult {
  pinned: GeocodeResult[];
  failed: string[];
}

export function parseLines(raw: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

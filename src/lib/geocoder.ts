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

export async function geocodeLine(
  query: string,
  token: string,
): Promise<GeocodeResult | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query,
  )}.json?access_token=${encodeURIComponent(token)}&limit=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox geocoding request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    features?: Array<{ place_name: string; center: [number, number] }>;
  };

  const feature = data.features?.[0];
  if (feature === undefined) {
    return null;
  }

  return {
    query,
    name: feature.place_name,
    lng: feature.center[0],
    lat: feature.center[1],
  };
}

export async function geocodeBatch(
  queries: string[],
  token: string,
): Promise<GeocodeBatchResult> {
  const settled = await Promise.allSettled(
    queries.map((query) => geocodeLine(query, token)),
  );

  const pinned: GeocodeResult[] = [];
  const failed: string[] = [];
  let rejectedCount = 0;

  settled.forEach((result, index) => {
    const query = queries[index];
    if (result.status === "fulfilled" && result.value !== null) {
      pinned.push(result.value);
      return;
    }
    failed.push(query);
    if (result.status === "rejected") {
      rejectedCount += 1;
    }
  });

  if (queries.length > 0 && rejectedCount === queries.length) {
    throw new Error("All geocoding requests failed");
  }

  return { pinned, failed };
}

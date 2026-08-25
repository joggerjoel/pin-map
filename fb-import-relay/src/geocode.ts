// Geocodes place names via Mapbox — the only step in this service that
// spends money, so every property here exists to keep that spend bounded
// and non-redundant: in-batch coalescing (three requests for the same
// normalized name become one Mapbox call), a hard per-request cap, and
// bounded concurrency rather than firing every call at once or fully
// sequentially.

export type GeocodeConfidence = "high" | "low" | "failed";

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  confidence: GeocodeConfidence;
}

export interface GeocodeInput {
  externalKey: string;
  placeName: string;
}

export interface GeocodeBatchResult {
  results: Record<string, GeocodeResult>; // keyed by externalKey
  truncated: boolean;
}

export interface GeocodeConfig {
  mapboxToken: string;
  maxUniqueNamesPerRequest?: number;
  concurrency?: number;
  highConfidenceThreshold?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_UNIQUE_NAMES = 50;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8;

export function normalizePlaceNameForGeocoding(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodeOneName(
  name: string,
  config: GeocodeConfig,
): Promise<GeocodeResult> {
  const doFetch = config.fetchImpl ?? fetch;
  const threshold =
    config.highConfidenceThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(name)}.json?access_token=${encodeURIComponent(config.mapboxToken)}&limit=1`;
    const res = await doFetch(url);
    if (!res.ok) return { lat: null, lng: null, confidence: "failed" };

    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number]; relevance?: number }>;
    };
    const feature = data.features?.[0];
    if (!feature?.center) return { lat: null, lng: null, confidence: "failed" };

    const [lng, lat] = feature.center;
    const relevance = feature.relevance ?? 0;
    return {
      lat,
      lng,
      confidence: relevance >= threshold ? "high" : "low",
    };
  } catch {
    return { lat: null, lng: null, confidence: "failed" };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runOne),
  );
  return results;
}

export async function geocodeBatch(
  inputs: GeocodeInput[],
  config: GeocodeConfig,
): Promise<GeocodeBatchResult> {
  const maxUniqueNames =
    config.maxUniqueNamesPerRequest ?? DEFAULT_MAX_UNIQUE_NAMES;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

  const byNormalizedName = new Map<string, GeocodeInput[]>();
  for (const input of inputs) {
    const key = normalizePlaceNameForGeocoding(input.placeName);
    const group = byNormalizedName.get(key);
    if (group) group.push(input);
    else byNormalizedName.set(key, [input]);
  }

  const uniqueNames = [...byNormalizedName.keys()];
  const truncated = uniqueNames.length > maxUniqueNames;
  const namesToGeocode = truncated
    ? uniqueNames.slice(0, maxUniqueNames)
    : uniqueNames;

  const geocoded = await runWithConcurrency(
    namesToGeocode,
    concurrency,
    (normalizedName) => geocodeOneName(normalizedName, config),
  );

  const results: Record<string, GeocodeResult> = {};
  namesToGeocode.forEach((normalizedName, i) => {
    const result = geocoded[i];
    for (const input of byNormalizedName.get(normalizedName) ?? []) {
      results[input.externalKey] = result;
    }
  });

  return { results, truncated };
}

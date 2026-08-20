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

/** Thrown by geocodeLine on a non-ok HTTP response; keeps the status code
 * around so callers can distinguish an auth failure from other failures. */
export class GeocodeRequestError extends Error {
  status: number;

  constructor(status: number) {
    super(`Mapbox geocoding request failed: ${status}`);
    this.name = "GeocodeRequestError";
    this.status = status;
  }
}

/** Thrown by geocodeBatch when every query failed. `isAuthError` is true
 * only when every failure was a 401/403 GeocodeRequestError, letting
 * callers show a "bad token" message instead of a generic connectivity one. */
export class GeocodeAllFailedError extends Error {
  isAuthError: boolean;

  constructor(isAuthError: boolean) {
    super("All geocoding requests failed");
    this.name = "GeocodeAllFailedError";
    this.isAuthError = isAuthError;
  }
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
    throw new GeocodeRequestError(response.status);
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
  const rejectedReasons: unknown[] = [];

  settled.forEach((result, index) => {
    const query = queries[index];
    if (result.status === "fulfilled" && result.value !== null) {
      pinned.push(result.value);
      return;
    }
    failed.push(query);
    if (result.status === "rejected") {
      rejectedReasons.push(result.reason);
    }
  });

  if (queries.length > 0 && rejectedReasons.length === queries.length) {
    const isAuthError = rejectedReasons.every(
      (reason) =>
        reason instanceof GeocodeRequestError &&
        (reason.status === 401 || reason.status === 403),
    );
    throw new GeocodeAllFailedError(isAuthError);
  }

  return { pinned, failed };
}

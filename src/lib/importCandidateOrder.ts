import type { ImportCandidate } from "./importCandidatesRepository";

export type ReviewOrder = "newest" | "oldest" | "random";

/** Deterministic shuffle keyed by candidate id (not Math.random()) — the
 * same set of ids always produces the same order within a review session,
 * so switching away from "random" and back (or a re-render triggered by an
 * unrelated state change) doesn't reshuffle mid-review. A cheap string hash
 * feeding a small LCG is enough entropy for "shuffled draw, not truly
 * cryptographic" — this is a review queue, not a lottery. */
function hashSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function randomRank(id: string): number {
  const seed = hashSeed(id);
  // One LCG step decorrelates similar ids (e.g. sequential UUIDs) from
  // producing a similar rank.
  return (seed * 1103515245 + 12345) >>> 0;
}

export function sortCandidates(
  candidates: ImportCandidate[],
  order: ReviewOrder,
): ImportCandidate[] {
  const sorted = [...candidates];
  if (order === "newest") {
    sorted.sort((a, b) => b.visitTime.localeCompare(a.visitTime));
  } else if (order === "oldest") {
    sorted.sort((a, b) => a.visitTime.localeCompare(b.visitTime));
  } else {
    sorted.sort((a, b) => randomRank(a.id) - randomRank(b.id));
  }
  return sorted;
}

export type TriageBucket = "high-confidence" | "needs-review" | "geocoding";

export function triageBucketFor(candidate: ImportCandidate): TriageBucket {
  if (candidate.geocodeConfidence === null) return "geocoding";
  if (candidate.geocodeConfidence === "high") return "high-confidence";
  return "needs-review";
}

export interface TriagedCandidates {
  highConfidence: ImportCandidate[];
  needsReview: ImportCandidate[];
  stillGeocoding: ImportCandidate[];
}

/** Splits on what's actually computed (geocode_confidence) — never an
 * automatic "no conflicts" classification, per the design decision in
 * facebook-import-layout-plan.md: a human decides ambiguous cases via
 * Split/Merge, not a pre-detection step. */
export function triageCandidates(
  candidates: ImportCandidate[],
): TriagedCandidates {
  const highConfidence: ImportCandidate[] = [];
  const needsReview: ImportCandidate[] = [];
  const stillGeocoding: ImportCandidate[] = [];
  for (const candidate of candidates) {
    const bucket = triageBucketFor(candidate);
    if (bucket === "high-confidence") highConfidence.push(candidate);
    else if (bucket === "needs-review") needsReview.push(candidate);
    else stillGeocoding.push(candidate);
  }
  return { highConfidence, needsReview, stillGeocoding };
}

/** Groups already-ordered candidates by the year of their visit — order is
 * preserved within each year's bucket, and the Map's key insertion order
 * follows the input order (so iterating it after sortCandidates(newest)
 * yields years newest-first without a second sort). */
export function groupByYear(
  candidates: ImportCandidate[],
): Map<number, ImportCandidate[]> {
  const groups = new Map<number, ImportCandidate[]>();
  for (const candidate of candidates) {
    // getUTCFullYear, not getFullYear — visitTime is a UTC ISO timestamp,
    // and a local-timezone read would push a Jan 1 UTC midnight visit into
    // the previous year for anyone west of UTC.
    const year = new Date(candidate.visitTime).getUTCFullYear();
    const existing = groups.get(year);
    if (existing) existing.push(candidate);
    else groups.set(year, [candidate]);
  }
  return groups;
}

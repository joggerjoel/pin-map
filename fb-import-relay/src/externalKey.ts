// Deterministic dedupe key for a check-in, computed server-side (not by
// the browser) so a client can't influence which rows collide on
// pinmap_import_candidates' unique(user_id, external_key) constraint. See
// facebook-import-layout-plan.md's red-team finding on this.

import { createHash } from "node:crypto";

function normalizePlaceName(placeName: string): string {
  return placeName.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeExternalKey(placeName: string, visitTime: Date): string {
  const normalized = normalizePlaceName(placeName);
  const input = `${normalized}|${visitTime.toISOString()}`;
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

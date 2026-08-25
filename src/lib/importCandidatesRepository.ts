import { supabase } from "./supabaseClient";

export type ImportCandidateStatus =
  "pending" | "later" | "approved" | "rejected" | "split" | "merged";

export type GeocodeConfidence = "high" | "low" | "failed";

export interface ImportCandidate {
  id: string;
  externalKey: string;
  placeName: string;
  suggestedLat: number | null;
  suggestedLng: number | null;
  geocodeConfidence: GeocodeConfidence | null;
  visitTime: string;
  note: string | null;
  status: ImportCandidateStatus;
}

interface CandidateRow {
  id: string;
  external_key: string;
  place_name: string;
  suggested_lat: number | null;
  suggested_lng: number | null;
  geocode_confidence: GeocodeConfidence | null;
  visit_time: string;
  note: string | null;
  status: ImportCandidateStatus;
}

function fromRow(row: CandidateRow): ImportCandidate {
  return {
    id: row.id,
    externalKey: row.external_key,
    placeName: row.place_name,
    suggestedLat: row.suggested_lat,
    suggestedLng: row.suggested_lng,
    geocodeConfidence: row.geocode_confidence,
    visitTime: row.visit_time,
    note: row.note,
    status: row.status,
  };
}

const CANDIDATE_COLUMNS =
  "id, external_key, place_name, suggested_lat, suggested_lng, geocode_confidence, visit_time, note, status";

export async function fetchReviewableCandidates(
  userId: string,
): Promise<ImportCandidate[]> {
  try {
    const { data, error } = await supabase
      .from("pinmap_import_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("user_id", userId)
      .in("status", ["pending", "later"])
      .order("visit_time", { ascending: false });
    if (error || data === null) return [];
    return (data as CandidateRow[]).map(fromRow);
  } catch {
    return [];
  }
}

export interface NewCandidateInput {
  externalKey: string;
  placeName: string;
  visitTime: string;
  note: string | null;
}

/** Insert parsed candidates, silently skipping any external_key already
 * present for this user — the server-computed external_key is the
 * dedupe key, so a re-import of the same export is always safe to retry. */
export async function insertCandidates(
  userId: string,
  candidates: NewCandidateInput[],
): Promise<void> {
  if (candidates.length === 0) return;
  const rows = candidates.map((c) => ({
    user_id: userId,
    external_key: c.externalKey,
    place_name: c.placeName,
    visit_time: c.visitTime,
    note: c.note,
  }));
  try {
    await supabase
      .from("pinmap_import_candidates")
      .upsert(rows, {
        onConflict: "user_id,external_key",
        ignoreDuplicates: true,
      });
  } catch {
    // Best-effort — a partial insert failure is recoverable by re-running
    // the import, which is idempotent by design.
  }
}

export async function updateCandidateGeocode(
  id: string,
  update: {
    suggestedLat: number | null;
    suggestedLng: number | null;
    geocodeConfidence: GeocodeConfidence;
  },
): Promise<void> {
  try {
    await supabase
      .from("pinmap_import_candidates")
      .update({
        suggested_lat: update.suggestedLat,
        suggested_lng: update.suggestedLng,
        geocode_confidence: update.geocodeConfidence,
      })
      .eq("id", id);
  } catch {
    // Fire-and-forget — see pinsRepository.upsertPins for the same pattern.
  }
}

export async function updateCandidateFields(
  id: string,
  updates: Partial<{
    placeName: string;
    suggestedLat: number;
    suggestedLng: number;
    note: string;
  }>,
): Promise<void> {
  try {
    await supabase
      .from("pinmap_import_candidates")
      .update({
        ...(updates.placeName !== undefined && {
          place_name: updates.placeName,
        }),
        ...(updates.suggestedLat !== undefined && {
          suggested_lat: updates.suggestedLat,
        }),
        ...(updates.suggestedLng !== undefined && {
          suggested_lng: updates.suggestedLng,
        }),
        ...(updates.note !== undefined && { note: updates.note }),
      })
      .eq("id", id);
  } catch {
    // See updateCandidateGeocode.
  }
}

export async function rejectCandidate(id: string): Promise<void> {
  try {
    await supabase
      .from("pinmap_import_candidates")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    // See updateCandidateGeocode.
  }
}

export async function deferCandidate(id: string): Promise<void> {
  try {
    await supabase
      .from("pinmap_import_candidates")
      .update({ status: "later" })
      .eq("id", id);
  } catch {
    // See updateCandidateGeocode.
  }
}

export interface ApproveResult {
  pinId: string | null;
  error: string | null;
}

export async function approveCandidate(id: string): Promise<ApproveResult> {
  try {
    const { data, error } = await supabase.rpc("approve_import_candidate", {
      p_candidate_id: id,
    });
    if (error) return { pinId: null, error: error.message };
    return { pinId: data as string, error: null };
  } catch (err) {
    return { pinId: null, error: (err as Error).message };
  }
}

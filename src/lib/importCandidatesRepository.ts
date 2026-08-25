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
    await supabase.from("pinmap_import_candidates").upsert(rows, {
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

export interface CandidateFieldUpdate {
  placeName?: string;
  suggestedLat?: number;
  suggestedLng?: number;
  geocodeConfidence?: GeocodeConfidence;
  note?: string;
}

export async function updateCandidateFields(
  id: string,
  updates: CandidateFieldUpdate,
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
        ...(updates.geocodeConfidence !== undefined && {
          geocode_confidence: updates.geocodeConfidence,
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

/** Photos aren't storage-copied, just re-referenced under a new
 * candidate_id — the underlying object in "import-staging" stays put, so
 * removing a photo from one child/survivor's thumbnail strip never affects
 * the others. A no-op today (the /parse pipeline doesn't attach photos
 * yet), but split/merge need to be correct once it does. */
async function duplicatePhotosOnto(
  sourceCandidateId: string,
  targetCandidateIds: string[],
  userId: string,
): Promise<void> {
  if (targetCandidateIds.length === 0) return;
  try {
    const { data } = await supabase
      .from("pinmap_import_candidate_photos")
      .select("storage_path")
      .eq("candidate_id", sourceCandidateId);
    const photos = (data ?? []) as { storage_path: string }[];
    if (photos.length === 0) return;
    const rows = targetCandidateIds.flatMap((candidateId) =>
      photos.map((photo) => ({
        user_id: userId,
        candidate_id: candidateId,
        storage_path: photo.storage_path,
      })),
    );
    await supabase.from("pinmap_import_candidate_photos").insert(rows);
  } catch {
    // Best-effort — see updateCandidateGeocode.
  }
}

export interface SplitPart {
  placeName: string;
}

/** One Facebook entry that actually covers multiple real locations (e.g. a
 * race weekend with a start line, checkpoint, and finish line all in one
 * grouped note) becomes N independent candidates, each with its own
 * search/pin/approve flow. The parent is kept at status='split' (not
 * deleted) — re-importing the same export produces the same external_key
 * again, and the dedupe insert finds it already resolved and skips it. */
export async function splitCandidate(
  userId: string,
  candidate: ImportCandidate,
  parts: SplitPart[],
): Promise<ImportCandidate[]> {
  if (parts.length < 2) return [];
  try {
    const childRows = parts.map((part, index) => ({
      user_id: userId,
      external_key: `${candidate.externalKey}::split-${index + 1}`,
      place_name: part.placeName,
      visit_time: candidate.visitTime,
      note: candidate.note,
    }));
    const { data, error } = await supabase
      .from("pinmap_import_candidates")
      .insert(childRows)
      .select(CANDIDATE_COLUMNS);
    if (error || data === null) return [];
    const children = (data as CandidateRow[]).map(fromRow);

    await duplicatePhotosOnto(
      candidate.id,
      children.map((child) => child.id),
      userId,
    );

    await supabase
      .from("pinmap_import_candidates")
      .update({ status: "split", resolved_at: new Date().toISOString() })
      .eq("id", candidate.id);

    return children;
  } catch {
    return [];
  }
}

/** Consolidates `loserIds` into `survivorId`: the survivor absorbs the
 * losers' photos (re-referenced, same approach as split), and each loser is
 * marked status='merged' with related_candidate_id pointing at the
 * survivor — kept, not deleted, for the same re-import-dedupe reason as
 * split. Note text isn't auto-merged (a human reviewing both cards can
 * already edit the survivor's note directly). */
export async function mergeCandidates(
  userId: string,
  survivorId: string,
  loserIds: string[],
): Promise<void> {
  if (loserIds.length === 0) return;
  try {
    for (const loserId of loserIds) {
      await duplicatePhotosOnto(loserId, [survivorId], userId);
    }
    await supabase
      .from("pinmap_import_candidates")
      .update({
        status: "merged",
        related_candidate_id: survivorId,
        resolved_at: new Date().toISOString(),
      })
      .in("id", loserIds);
  } catch {
    // Best-effort — see updateCandidateGeocode.
  }
}

export interface ProgressCounts {
  total: number;
  reviewed: number;
}

/** "N of M reviewed" — M is every candidate ever inserted for this user
 * (any status), N is every one whose status is no longer 'pending'
 * (later/approved/rejected/split/merged all count as "looked at"). Two
 * head:true/count:'exact' queries so no row data crosses the wire just to
 * count. */
export async function fetchProgressCounts(
  userId: string,
): Promise<ProgressCounts> {
  try {
    const [totalRes, reviewedRes] = await Promise.all([
      supabase
        .from("pinmap_import_candidates")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("pinmap_import_candidates")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("status", "pending"),
    ]);
    return {
      total: totalRes.count ?? 0,
      reviewed: reviewedRes.count ?? 0,
    };
  } catch {
    return { total: 0, reviewed: 0 };
  }
}

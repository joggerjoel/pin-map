import * as tus from "tus-js-client";

const UPLOAD_URL = import.meta.env.VITE_FB_IMPORT_UPLOAD_URL as
  string | undefined;
const RELAY_URL = import.meta.env.VITE_FB_IMPORT_RELAY_URL as
  string | undefined;

export interface UploadProgress {
  bytesUploaded: number;
  bytesTotal: number;
}

export type ClaimUploadError = "invalid_id" | "not_found" | "already_claimed";

/** Claims ownership of a tusd upload -- see facebook-import-multi-tenant.md
 * item 2. Called from uploadExportFile's onAfterResponse as soon as tusd
 * assigns the upload ID, before any bytes are sent, not after the upload
 * completes -- this is what keeps the creation-to-claim window as small as
 * possible. */
export async function claimUpload(
  tusUploadId: string,
  accessToken: string,
): Promise<void> {
  if (!RELAY_URL) {
    throw new Error("VITE_FB_IMPORT_RELAY_URL is not set");
  }
  const res = await fetch(`${RELAY_URL}/claim-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ tusUploadId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: ClaimUploadError;
    };
    throw new Error(
      `claim-upload failed (${res.status}): ${data.error ?? "unknown"}`,
    );
  }
}

/** Resumable upload of the export zip via tus-js-client. Resolves with the
 * tusd upload ID once the transfer completes — tus-js-client owns
 * chunking, retry-with-backoff, and resuming from the last committed byte
 * offset on reconnect (verified live against the deployed tusd instance;
 * see facebook-import-layout-todo.md). Claims the upload (see
 * claimUpload()) as soon as tusd assigns its ID, before any bytes are
 * sent -- a thrown error from onAfterResponse propagates through
 * tus-js-client's own "failed to create upload" -> onError path (verified
 * against tus-js-client's source: onAfterResponse is plain-awaited with no
 * swallowing try/catch), so a claim rejection (e.g. someone else already
 * claimed this ID -- see the hijack case in the spec) aborts the upload
 * rather than letting bytes land under a binding that isn't ours. */
export function uploadExportFile(
  file: File,
  accessToken: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  if (!UPLOAD_URL) {
    return Promise.reject(new Error("VITE_FB_IMPORT_UPLOAD_URL is not set"));
  }

  return new Promise((resolve, reject) => {
    let claimed = false;

    const upload = new tus.Upload(file, {
      endpoint: `${UPLOAD_URL}/files/`,
      retryDelays: [0, 1000, 3000, 5000],
      headers: { Authorization: `Bearer ${accessToken}` },
      metadata: { filename: file.name, filetype: file.type },
      onError: (error) => reject(error),
      onAfterResponse: async (req, res) => {
        if (claimed || req.getMethod() !== "POST") return;
        claimed = true;
        const location = res.getHeader("Location");
        const uploadId = location?.split("/").filter(Boolean).pop();
        if (!uploadId) {
          throw new Error("upload created but no upload id was returned");
        }
        await claimUpload(uploadId, accessToken);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.({ bytesUploaded, bytesTotal });
      },
      onSuccess: () => {
        const uploadUrl = upload.url;
        const uploadId = uploadUrl?.split("/").pop();
        if (!uploadId) {
          reject(new Error("upload succeeded but no upload ID was returned"));
          return;
        }
        resolve(uploadId);
      },
    });

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  });
}

/** Thrown specifically for /geocode's 429 (shared Mapbox-token quota
 * exceeded, see src/tokenUsageGate.ts on the relay) so callers can react
 * distinctly from a generic failure -- e.g. telling the user to switch to
 * their own Mapbox token, rather than just "import failed." */
export class QuotaExceededError extends Error {
  constructor() {
    super(
      "You've used up the shared Mapbox token's quota for this account. " +
        "Add your own Mapbox token (see the app's setup screen) to keep geocoding.",
    );
    this.name = "QuotaExceededError";
  }
}

async function callRelay<T>(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<T> {
  if (!RELAY_URL) {
    throw new Error("VITE_FB_IMPORT_RELAY_URL is not set");
  }
  const res = await fetch(`${RELAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new QuotaExceededError();
    }
    const text = await res.text().catch(() => "");
    throw new Error(`${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface ParsedCandidate {
  externalKey: string;
  placeName: string;
  visitTime: string;
  note: string | null;
  photos: string[];
}

export async function parseExport(
  tusUploadId: string,
  accessToken: string,
): Promise<ParsedCandidate[]> {
  const data = await callRelay<{ candidates: ParsedCandidate[] }>(
    "/parse",
    accessToken,
    { tusUploadId },
  );
  return data.candidates;
}

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  confidence: "high" | "low" | "failed";
}

export interface GeocodeBatchResult {
  results: Record<string, GeocodeResult>;
  truncated: boolean;
}

export async function geocodeCandidates(
  inputs: { externalKey: string; placeName: string }[],
  accessToken: string,
): Promise<GeocodeBatchResult> {
  if (inputs.length === 0) return { results: {}, truncated: false };
  return callRelay<GeocodeBatchResult>("/geocode", accessToken, { inputs });
}

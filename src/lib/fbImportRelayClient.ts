import * as tus from "tus-js-client";

const UPLOAD_URL = import.meta.env.VITE_FB_IMPORT_UPLOAD_URL as
  string | undefined;
const RELAY_URL = import.meta.env.VITE_FB_IMPORT_RELAY_URL as
  string | undefined;

export interface UploadProgress {
  bytesUploaded: number;
  bytesTotal: number;
}

/** Resumable upload of the export zip via tus-js-client. Resolves with the
 * tusd upload ID once the transfer completes — tus-js-client owns
 * chunking, retry-with-backoff, and resuming from the last committed byte
 * offset on reconnect (verified live against the deployed tusd instance;
 * see facebook-import-layout-todo.md). */
export function uploadExportFile(
  file: File,
  accessToken: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  if (!UPLOAD_URL) {
    return Promise.reject(new Error("VITE_FB_IMPORT_UPLOAD_URL is not set"));
  }

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${UPLOAD_URL}/files/`,
      retryDelays: [0, 1000, 3000, 5000],
      headers: { Authorization: `Bearer ${accessToken}` },
      metadata: { filename: file.name, filetype: file.type },
      onError: (error) => reject(error),
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

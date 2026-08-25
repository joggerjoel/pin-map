import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImportCandidates } from "./useImportCandidates";
import * as repository from "../lib/importCandidatesRepository";
import * as relayClient from "../lib/fbImportRelayClient";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

vi.mock("../lib/importCandidatesRepository", () => ({
  fetchReviewableCandidates: vi.fn(),
  insertCandidates: vi.fn(),
  updateCandidateGeocode: vi.fn(),
  updateCandidateFields: vi.fn(),
  rejectCandidate: vi.fn(),
  deferCandidate: vi.fn(),
  approveCandidate: vi.fn(),
}));

vi.mock("../lib/fbImportRelayClient", () => ({
  uploadExportFile: vi.fn(),
  parseExport: vi.fn(),
  geocodeCandidates: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const pendingCandidate: ImportCandidate = {
  id: "c1",
  externalKey: "key1",
  placeName: "Singapore, Singapore",
  suggestedLat: 1.35,
  suggestedLng: 103.82,
  geocodeConfidence: "high",
  visitTime: "2011-03-28T08:22:52.000Z",
  note: null,
  status: "pending",
};

describe("useImportCandidates", () => {
  it("loads reviewable candidates for the given userId", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
      pendingCandidate,
    ]);

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));

    await waitFor(() => {
      expect(result.current.candidates).toEqual([pendingCandidate]);
    });
    expect(repository.fetchReviewableCandidates).toHaveBeenCalledWith("user-1");
  });

  it("stays empty with no userId", async () => {
    const { result } = renderHook(() => useImportCandidates(null, null));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.candidates).toEqual([]);
    expect(repository.fetchReviewableCandidates).not.toHaveBeenCalled();
  });

  it("runs the full upload → parse → insert → geocode pipeline", async () => {
    vi.mocked(repository.fetchReviewableCandidates)
      .mockResolvedValueOnce([]) // initial mount fetch
      .mockResolvedValueOnce([
        {
          ...pendingCandidate,
          suggestedLat: null,
          suggestedLng: null,
          geocodeConfidence: null,
        },
      ]) // after insert
      .mockResolvedValueOnce([pendingCandidate]); // after geocode

    vi.mocked(relayClient.uploadExportFile).mockImplementation(
      async (_file, _token, onProgress) => {
        onProgress?.({ bytesUploaded: 100, bytesTotal: 100 });
        return "tus-upload-1";
      },
    );
    vi.mocked(relayClient.parseExport).mockResolvedValue([
      {
        externalKey: "key1",
        placeName: "Singapore, Singapore",
        visitTime: "2011-03-28T08:22:52.000Z",
        note: null,
        photos: [],
      },
    ]);
    vi.mocked(relayClient.geocodeCandidates).mockResolvedValue({
      results: {
        key1: { lat: 1.35, lng: 103.82, confidence: "high" },
      },
      truncated: false,
    });

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));

    await waitFor(() => expect(result.current.isLoadingCandidates).toBe(false));

    const file = new File(["zip"], "export.zip");
    act(() => {
      result.current.startUpload(file);
    });

    await waitFor(() => expect(result.current.uploadState).toBe("done"));

    expect(relayClient.uploadExportFile).toHaveBeenCalledWith(
      file,
      "token",
      expect.any(Function),
    );
    expect(relayClient.parseExport).toHaveBeenCalledWith(
      "tus-upload-1",
      "token",
    );
    expect(repository.insertCandidates).toHaveBeenCalledWith("user-1", [
      {
        externalKey: "key1",
        placeName: "Singapore, Singapore",
        visitTime: "2011-03-28T08:22:52.000Z",
        note: null,
      },
    ]);
    expect(relayClient.geocodeCandidates).toHaveBeenCalledWith(
      [{ externalKey: "key1", placeName: "Singapore, Singapore" }],
      "token",
    );
    expect(repository.updateCandidateGeocode).toHaveBeenCalledWith("c1", {
      suggestedLat: 1.35,
      suggestedLng: 103.82,
      geocodeConfidence: "high",
    });
    expect(result.current.candidates).toEqual([pendingCandidate]);
  });

  it("sets uploadState=error and captures the message on failure", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([]);
    vi.mocked(relayClient.uploadExportFile).mockRejectedValue(
      new Error("upload failed"),
    );

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.isLoadingCandidates).toBe(false));

    act(() => {
      result.current.startUpload(new File(["zip"], "export.zip"));
    });

    await waitFor(() => expect(result.current.uploadState).toBe("error"));
    expect(result.current.uploadError).toBe("upload failed");
  });

  it("skips geocoding entirely when every candidate already has coordinates", async () => {
    vi.mocked(repository.fetchReviewableCandidates)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pendingCandidate]); // already geocoded

    vi.mocked(relayClient.uploadExportFile).mockResolvedValue("tus-upload-1");
    vi.mocked(relayClient.parseExport).mockResolvedValue([
      {
        externalKey: "key1",
        placeName: "Singapore, Singapore",
        visitTime: "2011-03-28T08:22:52.000Z",
        note: null,
        photos: [],
      },
    ]);

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.isLoadingCandidates).toBe(false));

    act(() => {
      result.current.startUpload(new File(["zip"], "export.zip"));
    });

    await waitFor(() => expect(result.current.uploadState).toBe("done"));
    expect(relayClient.geocodeCandidates).not.toHaveBeenCalled();
  });

  it("approve removes the candidate from the list on success", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
      pendingCandidate,
    ]);
    vi.mocked(repository.approveCandidate).mockResolvedValue({
      pinId: "pin-1",
      error: null,
    });

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));

    await act(async () => {
      await result.current.approve("c1");
    });

    expect(result.current.candidates).toEqual([]);
  });

  it("approve keeps the candidate and surfaces the error on failure", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
      pendingCandidate,
    ]);
    vi.mocked(repository.approveCandidate).mockResolvedValue({
      pinId: null,
      error: "candidate has no coordinates",
    });

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));

    await act(async () => {
      await result.current.approve("c1");
    });

    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.uploadError).toBe("candidate has no coordinates");
  });

  it("reject and defer update local state without waiting for a refetch", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
      pendingCandidate,
    ]);

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));

    await act(async () => {
      await result.current.reject("c1");
    });
    expect(result.current.candidates).toEqual([]);
    expect(repository.rejectCandidate).toHaveBeenCalledWith("c1");
  });
});

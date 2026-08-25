import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImportCandidates } from "./useImportCandidates";
import * as repository from "../lib/importCandidatesRepository";
import * as relayClient from "../lib/fbImportRelayClient";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

vi.mock("../lib/importCandidatesRepository", () => ({
  fetchReviewableCandidates: vi.fn(),
  fetchProgressCounts: vi.fn(),
  insertCandidates: vi.fn(),
  updateCandidateGeocode: vi.fn(),
  updateCandidateFields: vi.fn(),
  rejectCandidate: vi.fn(),
  deferCandidate: vi.fn(),
  approveCandidate: vi.fn(),
  splitCandidate: vi.fn(),
  mergeCandidates: vi.fn(),
}));

vi.mock("../lib/fbImportRelayClient", () => ({
  uploadExportFile: vi.fn(),
  parseExport: vi.fn(),
  geocodeCandidates: vi.fn(),
}));

beforeEach(() => {
  // Every test in this file exercises candidate loading/mutation, which now
  // always fires a progress-count fetch alongside it — default it to a
  // harmless value so only the tests that actually care about progress need
  // to override it.
  vi.mocked(repository.fetchProgressCounts).mockResolvedValue({
    total: 0,
    reviewed: 0,
  });
  vi.mocked(repository.updateCandidateGeocode).mockResolvedValue(undefined);
});

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

  it("loads progress counts alongside candidates and refreshes them after a mutation", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
      pendingCandidate,
    ]);
    vi.mocked(repository.fetchProgressCounts)
      .mockResolvedValueOnce({ total: 157, reviewed: 54 })
      .mockResolvedValueOnce({ total: 157, reviewed: 55 });
    vi.mocked(repository.rejectCandidate).mockResolvedValue(undefined);

    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() =>
      expect(result.current.progress).toEqual({ total: 157, reviewed: 54 }),
    );

    await act(async () => {
      await result.current.reject("c1");
    });

    await waitFor(() =>
      expect(result.current.progress).toEqual({ total: 157, reviewed: 55 }),
    );
  });

  it("defaults order to newest and lets the caller change it", async () => {
    vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([]);
    const { result } = renderHook(() => useImportCandidates("user-1", "token"));
    await waitFor(() => expect(result.current.isLoadingCandidates).toBe(false));

    expect(result.current.order).toBe("newest");

    act(() => {
      result.current.setOrder("random");
    });

    expect(result.current.order).toBe("random");
  });

  describe("split", () => {
    it("replaces the parent with its children in local state", async () => {
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        pendingCandidate,
      ]);
      const child1: ImportCandidate = {
        ...pendingCandidate,
        id: "child-1",
        externalKey: "key1::split-1",
        placeName: "Start line",
      };
      const child2: ImportCandidate = {
        ...pendingCandidate,
        id: "child-2",
        externalKey: "key1::split-2",
        placeName: "Finish line",
      };
      vi.mocked(repository.splitCandidate).mockResolvedValue([child1, child2]);

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.split(pendingCandidate, [
          { placeName: "Start line" },
          { placeName: "Finish line" },
        ]);
      });

      expect(repository.splitCandidate).toHaveBeenCalledWith(
        "user-1",
        pendingCandidate,
        [{ placeName: "Start line" }, { placeName: "Finish line" }],
      );
      expect(result.current.candidates.map((c) => c.id).sort()).toEqual([
        "child-1",
        "child-2",
      ]);
    });

    it("leaves local state untouched when the repository returns no children", async () => {
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        pendingCandidate,
      ]);
      vi.mocked(repository.splitCandidate).mockResolvedValue([]);

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.split(pendingCandidate, [
          { placeName: "A" },
          { placeName: "B" },
        ]);
      });

      expect(result.current.candidates).toEqual([pendingCandidate]);
    });
  });

  describe("merge", () => {
    it("removes losers from local state and keeps the survivor", async () => {
      const survivor: ImportCandidate = { ...pendingCandidate, id: "c1" };
      const loser: ImportCandidate = {
        ...pendingCandidate,
        id: "c2",
        externalKey: "key2",
      };
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        survivor,
        loser,
      ]);
      vi.mocked(repository.mergeCandidates).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(2));

      await act(async () => {
        await result.current.merge("c1", ["c2"]);
      });

      expect(repository.mergeCandidates).toHaveBeenCalledWith("user-1", "c1", [
        "c2",
      ]);
      expect(result.current.candidates.map((c) => c.id)).toEqual(["c1"]);
    });
  });

  describe("bulkApproveHighConfidence", () => {
    it("approves every high-confidence candidate and removes only the successes", async () => {
      const high1: ImportCandidate = {
        ...pendingCandidate,
        id: "high-1",
        geocodeConfidence: "high",
      };
      const high2: ImportCandidate = {
        ...pendingCandidate,
        id: "high-2",
        geocodeConfidence: "high",
      };
      const low: ImportCandidate = {
        ...pendingCandidate,
        id: "low-1",
        geocodeConfidence: "low",
      };
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        high1,
        high2,
        low,
      ]);
      vi.mocked(repository.approveCandidate).mockImplementation(async (id) =>
        id === "high-2"
          ? { pinId: null, error: "candidate has no coordinates" }
          : { pinId: `pin-${id}`, error: null },
      );

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(3));

      await act(async () => {
        await result.current.bulkApproveHighConfidence();
      });

      expect(repository.approveCandidate).toHaveBeenCalledWith("high-1");
      expect(repository.approveCandidate).toHaveBeenCalledWith("high-2");
      expect(repository.approveCandidate).not.toHaveBeenCalledWith("low-1");
      expect(result.current.candidates.map((c) => c.id).sort()).toEqual([
        "high-2",
        "low-1",
      ]);
      expect(result.current.uploadError).toBe("candidate has no coordinates");
    });

    it("does nothing when no candidate is high-confidence", async () => {
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        pendingCandidate,
      ]);
      const lowOnly: ImportCandidate = {
        ...pendingCandidate,
        geocodeConfidence: "low",
      };
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        lowOnly,
      ]);

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.bulkApproveHighConfidence();
      });

      expect(repository.approveCandidate).not.toHaveBeenCalled();
      expect(result.current.candidates).toEqual([lowOnly]);
    });
  });

  describe("geocodeRemaining", () => {
    it("resumes geocoding for candidates still missing coordinates", async () => {
      const ungeocoded: ImportCandidate = {
        ...pendingCandidate,
        suggestedLat: null,
        suggestedLng: null,
        geocodeConfidence: null,
      };
      vi.mocked(repository.fetchReviewableCandidates)
        .mockResolvedValueOnce([ungeocoded]) // initial mount
        .mockResolvedValueOnce([pendingCandidate]); // after geocodeRemaining's refetch
      vi.mocked(relayClient.geocodeCandidates).mockResolvedValue({
        results: { key1: { lat: 1.35, lng: 103.82, confidence: "high" } },
        truncated: false,
      });

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.geocodeRemaining();
      });

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
      expect(result.current.isGeocodingRemaining).toBe(false);
    });

    it("loops across multiple batches — the relay's per-request cap can leave a batch incomplete", async () => {
      const a = {
        ...pendingCandidate,
        id: "a",
        externalKey: "key-a",
        suggestedLat: null,
        suggestedLng: null,
        geocodeConfidence: null,
      };
      const b = {
        ...pendingCandidate,
        id: "b",
        externalKey: "key-b",
        suggestedLat: null,
        suggestedLng: null,
        geocodeConfidence: null,
      };
      vi.mocked(repository.fetchReviewableCandidates)
        .mockResolvedValueOnce([a, b]) // initial mount
        .mockResolvedValueOnce([
          { ...a, suggestedLat: 1, suggestedLng: 1, geocodeConfidence: "high" },
          b, // "b" wasn't in the first batch's response — truncated
        ])
        .mockResolvedValueOnce([
          { ...a, suggestedLat: 1, suggestedLng: 1, geocodeConfidence: "high" },
          { ...b, suggestedLat: 2, suggestedLng: 2, geocodeConfidence: "high" },
        ]);
      vi.mocked(relayClient.geocodeCandidates)
        .mockResolvedValueOnce({
          results: { "key-a": { lat: 1, lng: 1, confidence: "high" } },
          truncated: true,
        })
        .mockResolvedValueOnce({
          results: { "key-b": { lat: 2, lng: 2, confidence: "high" } },
          truncated: false,
        });

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(2));

      await act(async () => {
        await result.current.geocodeRemaining();
      });

      expect(relayClient.geocodeCandidates).toHaveBeenCalledTimes(2);
      expect(
        result.current.candidates.every(
          (c) => c.suggestedLat !== null && c.suggestedLng !== null,
        ),
      ).toBe(true);
    });

    it("stops looping instead of spinning forever when a batch makes zero progress", async () => {
      const ungeocoded: ImportCandidate = {
        ...pendingCandidate,
        suggestedLat: null,
        suggestedLng: null,
        geocodeConfidence: null,
      };
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        ungeocoded,
      ]);
      // No result entry at all for "key1" — simulates a batch that made no
      // progress (e.g. every candidate got truncated away again).
      vi.mocked(relayClient.geocodeCandidates).mockResolvedValue({
        results: {},
        truncated: true,
      });

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.geocodeRemaining();
      });

      expect(relayClient.geocodeCandidates).toHaveBeenCalledTimes(1);
      expect(result.current.isGeocodingRemaining).toBe(false);
    });

    it("does nothing when every candidate already has coordinates", async () => {
      vi.mocked(repository.fetchReviewableCandidates).mockResolvedValue([
        pendingCandidate,
      ]);

      const { result } = renderHook(() =>
        useImportCandidates("user-1", "token"),
      );
      await waitFor(() => expect(result.current.candidates).toHaveLength(1));

      await act(async () => {
        await result.current.geocodeRemaining();
      });

      expect(relayClient.geocodeCandidates).not.toHaveBeenCalled();
    });
  });
});

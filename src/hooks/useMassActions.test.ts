import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMassActions } from "./useMassActions";
import * as photosRepository from "../lib/photosRepository";

vi.mock("../lib/photosRepository", () => ({
  addPhotosToGroup: vi.fn(),
  removePhotosFromGroup: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMassActions / runLooped", () => {
  it("reports ok/conflict/error counts correctly for a mixed-outcome batch", async () => {
    const { result } = renderHook(() => useMassActions());
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const action = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("conflict")
      .mockResolvedValueOnce("error");

    await act(async () => {
      await result.current.runLooped(rows, action);
    });

    expect(result.current.summary).toEqual({
      kind: "looped",
      ok: 1,
      conflict: 1,
      error: 1,
    });
    expect(result.current.failedRows).toEqual([{ id: "3" }]);
  });

  it("never runs more than 5 actions concurrently", async () => {
    const { result } = renderHook(() => useMassActions());
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `${i}` }));
    let inFlight = 0;
    let maxInFlight = 0;
    const action = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return "ok" as const;
    });

    await act(async () => {
      await result.current.runLooped(rows, action);
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(action).toHaveBeenCalledTimes(12);
    expect(result.current.summary).toEqual({
      kind: "looped",
      ok: 12,
      conflict: 0,
      error: 0,
    });
  });

  it("does not drop or double-count any row across batches", async () => {
    const { result } = renderHook(() => useMassActions());
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `${i}` }));
    const action = vi.fn(async (row: { id: string }) =>
      Number(row.id) % 3 === 0 ? "error" : "ok",
    );

    await act(async () => {
      await result.current.runLooped(rows, action);
    });

    expect(action).toHaveBeenCalledTimes(13);
    const summary = result.current.summary;
    expect(summary?.kind).toBe("looped");
    if (summary?.kind === "looped") {
      expect(summary.ok + summary.error).toBe(13);
    }
  });

  it("isRunning is true during the batch and false after", async () => {
    const { result } = renderHook(() => useMassActions());
    let resolveAction: (v: "ok") => void = () => {};
    const action = vi.fn(
      () => new Promise<"ok">((resolve) => (resolveAction = resolve)),
    );

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runLooped([{ id: "1" }], action);
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      resolveAction("ok");
      await runPromise;
    });
    expect(result.current.isRunning).toBe(false);
  });
});

describe("useMassActions / runAddToGroup", () => {
  it("reports the added count on success", async () => {
    vi.mocked(photosRepository.addPhotosToGroup).mockResolvedValue({
      added: 4,
    });
    const { result } = renderHook(() => useMassActions());

    await act(async () => {
      await result.current.runAddToGroup("group-1", ["a", "b"]);
    });

    expect(result.current.summary).toEqual({ kind: "bulk-add", added: 4 });
  });

  it("reports 'group-not-found' distinctly from a generic error", async () => {
    vi.mocked(photosRepository.addPhotosToGroup).mockResolvedValue(
      "group_not_found",
    );
    const { result } = renderHook(() => useMassActions());

    await act(async () => {
      await result.current.runAddToGroup("group-1", ["a"]);
    });

    expect(result.current.summary).toEqual({ kind: "group-not-found" });
  });
});

describe("useMassActions / runRemoveFromGroup", () => {
  it("reports the removed count on success", async () => {
    vi.mocked(photosRepository.removePhotosFromGroup).mockResolvedValue({
      removed: 2,
    });
    const { result } = renderHook(() => useMassActions());

    await act(async () => {
      await result.current.runRemoveFromGroup("group-1", ["a", "b"]);
    });

    expect(result.current.summary).toEqual({
      kind: "bulk-remove",
      removed: 2,
    });
  });
});

describe("useMassActions / clearSummary", () => {
  it("clears both summary and failedRows", async () => {
    const { result } = renderHook(() => useMassActions());
    const action = vi.fn().mockResolvedValue("error");

    await act(async () => {
      await result.current.runLooped([{ id: "1" }], action);
    });
    expect(result.current.summary).not.toBeNull();

    act(() => result.current.clearSummary());
    expect(result.current.summary).toBeNull();
    expect(result.current.failedRows).toEqual([]);
  });
});

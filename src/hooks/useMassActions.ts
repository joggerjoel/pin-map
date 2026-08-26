import { useCallback, useState } from "react";
import {
  addPhotosToGroup,
  removePhotosFromGroup,
} from "../lib/photosRepository";

export type MassActionOutcome = "ok" | "conflict" | "error";

export interface MassActionRow {
  id: string;
}

export interface LoopedSummary {
  kind: "looped";
  ok: number;
  conflict: number;
  error: number;
}

export interface BulkAddSummary {
  kind: "bulk-add";
  added: number;
}

export interface BulkRemoveSummary {
  kind: "bulk-remove";
  removed: number;
}

export interface GroupNotFoundSummary {
  kind: "group-not-found";
}

export type MassActionSummary =
  LoopedSummary | BulkAddSummary | BulkRemoveSummary | GroupNotFoundSummary;

// A UX/rate-limiting tuning choice, not a correctness fork
// (image-group-plan.md, "Mass actions") -- chunking into batches of 5 never
// lets more than 5 requests be in flight at once, satisfying the cap with a
// simpler implementation than a true sliding window.
const CONCURRENCY_LIMIT = 5;

async function runConcurrencyCapped<T>(
  items: T[],
  worker: (item: T) => Promise<MassActionOutcome>,
): Promise<{ ok: T[]; conflict: T[]; error: T[] }> {
  const ok: T[] = [];
  const conflict: T[] = [];
  const error: T[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.all(
      batch.map((item) => worker(item).then((outcome) => ({ item, outcome }))),
    );
    for (const { item, outcome } of results) {
      if (outcome === "ok") ok.push(item);
      else if (outcome === "conflict") conflict.push(item);
      else error.push(item);
    }
  }
  return { ok, conflict, error };
}

export interface UseMassActionsResult {
  isRunning: boolean;
  summary: MassActionSummary | null;
  // Only `error` rows are ever retryable -- a `conflict` means the row's
  // live state already changed for an unrelated reason (someone else acted
  // on it), and retrying an unchanged conflict just conflicts again.
  failedRows: MassActionRow[];
  runLooped: <T extends MassActionRow>(
    rows: T[],
    action: (row: T) => Promise<MassActionOutcome>,
  ) => Promise<void>;
  runAddToGroup: (groupId: string, photoIds: string[]) => Promise<void>;
  runRemoveFromGroup: (groupId: string, photoIds: string[]) => Promise<void>;
  clearSummary: () => void;
}

export function useMassActions(): UseMassActionsResult {
  const [isRunning, setIsRunning] = useState(false);
  const [summary, setSummary] = useState<MassActionSummary | null>(null);
  const [failedRows, setFailedRows] = useState<MassActionRow[]>([]);

  const runLooped = useCallback(
    async <T extends MassActionRow>(
      rows: T[],
      action: (row: T) => Promise<MassActionOutcome>,
    ) => {
      setIsRunning(true);
      const { ok, conflict, error } = await runConcurrencyCapped(rows, action);
      setIsRunning(false);
      setSummary({
        kind: "looped",
        ok: ok.length,
        conflict: conflict.length,
        error: error.length,
      });
      setFailedRows(error);
    },
    [],
  );

  const runAddToGroup = useCallback(
    async (groupId: string, photoIds: string[]) => {
      setIsRunning(true);
      const result = await addPhotosToGroup(groupId, photoIds);
      setIsRunning(false);
      if (result === "group_not_found") {
        setSummary({ kind: "group-not-found" });
        return;
      }
      if (result === "error") {
        setSummary({ kind: "bulk-add", added: 0 });
        return;
      }
      setSummary({ kind: "bulk-add", added: result.added });
    },
    [],
  );

  const runRemoveFromGroup = useCallback(
    async (groupId: string, photoIds: string[]) => {
      setIsRunning(true);
      const result = await removePhotosFromGroup(groupId, photoIds);
      setIsRunning(false);
      if (result === "group_not_found") {
        setSummary({ kind: "group-not-found" });
        return;
      }
      if (result === "error") {
        setSummary({ kind: "bulk-remove", removed: 0 });
        return;
      }
      setSummary({ kind: "bulk-remove", removed: result.removed });
    },
    [],
  );

  const clearSummary = useCallback(() => {
    setSummary(null);
    setFailedRows([]);
  }, []);

  return {
    isRunning,
    summary,
    failedRows,
    runLooped,
    runAddToGroup,
    runRemoveFromGroup,
    clearSummary,
  };
}

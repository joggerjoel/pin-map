import { useCallback, useState } from "react";

// Shared selection-set state for the triage tabs, the Browse view, and a
// group's member view -- one implementation, not duplicated per surface
// (image-group-plan.md, "Mass actions").
export interface UseSelectionResult {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  size: number;
}

export function useSelection(): UseSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Replaces the whole set (not additive) -- "Select all N" is a single,
  // walked snapshot of everything matching the current filter, not a
  // union with whatever was already checked by hand.
  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    selectedIds,
    isSelected,
    toggle,
    selectAll,
    clear,
    size: selectedIds.size,
  };
}

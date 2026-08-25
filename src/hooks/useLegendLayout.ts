import { useCallback, useState } from "react";
import { getLegendCollapsed, saveLegendCollapsed } from "../lib/legendLayout";

export interface UseLegendLayoutResult {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export function useLegendLayout(): UseLegendLayoutResult {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    getLegendCollapsed(),
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveLegendCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggleCollapsed };
}

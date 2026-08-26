import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "./useSelection";

describe("useSelection", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.size).toBe(0);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("toggle adds then removes", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.size).toBe(1);
    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.size).toBe(0);
  });

  it("selectAll replaces the set, not unions it with what's already checked", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("manual-pick"));
    act(() => result.current.selectAll(["a", "b", "c"]));
    expect(result.current.selectedIds).toEqual(new Set(["a", "b", "c"]));
    expect(result.current.isSelected("manual-pick")).toBe(false);
  });

  it("clear empties the set", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectAll(["a", "b"]));
    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
  });
});

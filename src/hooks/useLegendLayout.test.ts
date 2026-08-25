import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLegendLayout } from "./useLegendLayout";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useLegendLayout", () => {
  it("starts expanded when localStorage is empty", () => {
    const { result } = renderHook(() => useLegendLayout());
    expect(result.current.collapsed).toBe(false);
  });

  it("starts collapsed when localStorage says so", () => {
    window.localStorage.setItem("pin-map:legend-collapsed", "true");
    const { result } = renderHook(() => useLegendLayout());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggleCollapsed flips collapsed and persists it", () => {
    const { result } = renderHook(() => useLegendLayout());

    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("pin-map:legend-collapsed")).toBe(
      "true",
    );

    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem("pin-map:legend-collapsed")).toBe(
      "false",
    );
  });
});

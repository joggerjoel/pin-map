import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  getSidebarCollapsed,
  getSidebarWidth,
  saveSidebarCollapsed,
  saveSidebarWidth,
} from "./sidebarLayout";

beforeEach(() => {
  window.localStorage.clear();
});

describe("getSidebarWidth", () => {
  it("returns the default width when nothing is stored", () => {
    expect(getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("returns a previously-saved value", () => {
    saveSidebarWidth(400);
    expect(getSidebarWidth()).toBe(400);
  });

  it("clamps a stored value below the minimum up to the minimum", () => {
    window.localStorage.setItem("pin-map:sidebar-width", "10");
    expect(getSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("clamps a stored value above the maximum down to the maximum", () => {
    window.localStorage.setItem("pin-map:sidebar-width", "9999");
    expect(getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("returns the default when the stored value is a non-numeric string", () => {
    window.localStorage.setItem("pin-map:sidebar-width", "not-a-number");
    expect(getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("getSidebarCollapsed", () => {
  it("returns false when nothing is stored", () => {
    expect(getSidebarCollapsed()).toBe(false);
  });

  it("round-trips true and false via saveSidebarCollapsed", () => {
    saveSidebarCollapsed(true);
    expect(getSidebarCollapsed()).toBe(true);

    saveSidebarCollapsed(false);
    expect(getSidebarCollapsed()).toBe(false);
  });
});

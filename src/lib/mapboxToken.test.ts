import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMapboxToken,
  getMapboxToken,
  setMapboxToken,
} from "./mapboxToken";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMapboxToken", () => {
  it("returns the env token when set", () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.env-token");
    expect(getMapboxToken()).toBe("pk.env-token");
  });

  it("falls back to localStorage when no env token is set", () => {
    window.localStorage.setItem("pin-map:mapbox-token", "pk.stored-token");
    expect(getMapboxToken()).toBe("pk.stored-token");
  });

  it("returns null when neither is set", () => {
    expect(getMapboxToken()).toBeNull();
  });
});

describe("setMapboxToken", () => {
  it("writes the token to localStorage", () => {
    setMapboxToken("pk.new-token");
    expect(window.localStorage.getItem("pin-map:mapbox-token")).toBe(
      "pk.new-token",
    );
  });
});

describe("clearMapboxToken", () => {
  it("removes the token from localStorage", () => {
    setMapboxToken("pk.new-token");
    clearMapboxToken();
    expect(window.localStorage.getItem("pin-map:mapbox-token")).toBeNull();
  });
});

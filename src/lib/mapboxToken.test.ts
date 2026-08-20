import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMapboxToken,
  getMapboxToken,
  getPersonalMapboxToken,
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

describe("getPersonalMapboxToken", () => {
  it("returns the stored token even when an env token is also set", () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.env-token");
    window.localStorage.setItem("pin-map:mapbox-token", "pk.stored-token");
    expect(getPersonalMapboxToken()).toBe("pk.stored-token");
  });

  it("returns null when nothing is stored, ignoring the env token", () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.env-token");
    expect(getPersonalMapboxToken()).toBeNull();
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

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMarkerDeclutter } from "./useMarkerDeclutter";
import type { DeclutterPoint } from "./useMarkerDeclutter";

class MockMarker {
  lngLat: [number, number] | undefined;
  setLngLat(lngLat: [number, number]): MockMarker {
    this.lngLat = lngLat;
    return this;
  }
}

class MockMap {
  sources = new Map<string, { data: unknown }>();
  handlers: Record<string, Array<() => void>> = {};
  isStyleLoaded(): boolean {
    return true;
  }
  once(_event: string, handler: () => void): void {
    handler();
  }
  on(event: string, handler: () => void): void {
    (this.handlers[event] ??= []).push(handler);
  }
  off(event: string, handler: () => void): void {
    this.handlers[event] = (this.handlers[event] ?? []).filter(
      (h) => h !== handler,
    );
  }
  getSource(id: string): { setData: (data: unknown) => void } | undefined {
    const record = this.sources.get(id);
    if (record === undefined) return undefined;
    return { setData: (data: unknown) => (record.data = data) };
  }
  addSource(id: string, options: { data: unknown }): void {
    this.sources.set(id, { data: options.data });
  }
  addLayer(): void {}
  // Identity projection — treat lng/lat as screen pixels directly, so
  // tests can control collisions just by picking close/far coordinates.
  project([lng, lat]: [number, number]): { x: number; y: number } {
    return { x: lng, y: lat };
  }
  unproject([x, y]: [number, number]): { lng: number; lat: number } {
    return { lng: x, lat: y };
  }
}

function setup(points: DeclutterPoint[], enabled: boolean) {
  const map = new MockMap();
  const markerA = new MockMarker();
  const markerB = new MockMarker();
  const markers = new Map<string, MockMarker>([
    ["a", markerA],
    ["b", markerB],
  ]);
  const mapRef = { current: map };
  const markersRef = { current: markers };
  const view = renderHook(
    ({ points, enabled }) =>
      useMarkerDeclutter(
        mapRef as unknown as Parameters<typeof useMarkerDeclutter>[0],
        markersRef as unknown as Parameters<typeof useMarkerDeclutter>[1],
        points,
        enabled,
      ),
    { initialProps: { points, enabled } },
  );
  return { map, markerA, markerB, view };
}

describe("useMarkerDeclutter", () => {
  it("leaves markers at their true position when disabled", () => {
    const points: DeclutterPoint[] = [
      { key: "a", lng: 10, lat: 10 },
      { key: "b", lng: 10.001, lat: 10.001 },
    ];
    const { markerA, markerB } = setup(points, false);

    expect(markerA.lngLat).toEqual([10, 10]);
    expect(markerB.lngLat).toEqual([10.001, 10.001]);
  });

  it("spreads overlapping markers apart when enabled", () => {
    const points: DeclutterPoint[] = [
      { key: "a", lng: 10, lat: 10 },
      { key: "b", lng: 10, lat: 10 },
    ];
    const { markerA, markerB, map } = setup(points, true);

    expect(markerA.lngLat).not.toEqual([10, 10]);
    expect(markerB.lngLat).not.toEqual([10, 10]);
    const lineData = map.sources.get("declutter-lines")?.data as {
      features: unknown[];
    };
    expect(lineData.features).toHaveLength(2);
  });

  it("leaves non-overlapping markers alone even when enabled", () => {
    const points: DeclutterPoint[] = [
      { key: "a", lng: 10, lat: 10 },
      { key: "b", lng: 80, lat: 80 },
    ];
    const { markerA, markerB } = setup(points, true);

    expect(markerA.lngLat).toEqual([10, 10]);
    expect(markerB.lngLat).toEqual([80, 80]);
  });

  it("snaps back to true positions when toggled off after being on", () => {
    const points: DeclutterPoint[] = [
      { key: "a", lng: 10, lat: 10 },
      { key: "b", lng: 10, lat: 10 },
    ];
    const { markerA, markerB, view } = setup(points, true);
    expect(markerA.lngLat).not.toEqual([10, 10]);

    view.rerender({ points, enabled: false });

    expect(markerA.lngLat).toEqual([10, 10]);
    expect(markerB.lngLat).toEqual([10, 10]);
  });
});

import { useEffect } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Map as MapboxMap, Marker, GeoJSONSource } from "mapbox-gl";
import { computeDeclutterOffsets } from "../lib/markerDeclutter";
import type { ScreenPoint } from "../lib/markerDeclutter";

export interface DeclutterPoint {
  key: string;
  lng: number;
  lat: number;
}

const SOURCE_ID = "declutter-lines";

// The global GeoJSON namespace isn't guaranteed available in this project's
// tsconfig — derive the feature type structurally from mapboxgl's own
// setData signature instead, same as MapView.tsx's DeclutterLineFeature.
type DeclutterLineData = Parameters<GeoJSONSource["setData"]>[0];
type DeclutterLineFeature = Extract<
  DeclutterLineData,
  { type: "FeatureCollection" }
>["features"][number];

// Spreads overlapping markers apart (with a thin connector line back to
// their true position) when `enabled`, snapping them back when it's off.
// Shared by every map view with a "Spider" toggle — see
// src/lib/markerDeclutter.ts for the pure offset math this wraps with the
// mapbox source/layer setup and move-driven recompute.
export function useMarkerDeclutter(
  mapRef: RefObject<MapboxMap | null>,
  markersRef: MutableRefObject<Map<string, Marker>>,
  points: DeclutterPoint[],
  enabled: boolean,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    function ensureSourceAndLayer(currentMap: MapboxMap) {
      if (currentMap.getSource(SOURCE_ID) !== undefined) return;
      currentMap.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      currentMap.addLayer({
        id: SOURCE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#9ca3af",
          "line-width": 1,
          "line-opacity": 0.8,
        },
      });
    }

    function clearDeclutter(currentMap: MapboxMap) {
      points.forEach((point) => {
        markersRef.current.get(point.key)?.setLngLat([point.lng, point.lat]);
      });
      const lineSource = currentMap.getSource(SOURCE_ID);
      if (lineSource !== undefined && "setData" in lineSource) {
        (lineSource as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [],
        });
      }
    }

    function updateDeclutter() {
      const currentMap = mapRef.current;
      if (currentMap === null) return;
      if (!enabled) {
        clearDeclutter(currentMap);
        return;
      }
      const screenPoints: ScreenPoint[] = points.map((point) => {
        const pixel = currentMap.project([point.lng, point.lat]);
        return { key: point.key, x: pixel.x, y: pixel.y };
      });
      const offsets = computeDeclutterOffsets(screenPoints);
      const lineFeatures: DeclutterLineFeature[] = [];
      offsets.forEach((offset) => {
        const marker = markersRef.current.get(offset.key);
        const point = points.find((p) => p.key === offset.key);
        if (marker === undefined || point === undefined) return;
        if (offset.dx === 0 && offset.dy === 0) {
          marker.setLngLat([point.lng, point.lat]);
          return;
        }
        const truePixel = currentMap.project([point.lng, point.lat]);
        const adjusted = currentMap.unproject([
          truePixel.x + offset.dx,
          truePixel.y + offset.dy,
        ]);
        marker.setLngLat([adjusted.lng, adjusted.lat]);
        lineFeatures.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [point.lng, point.lat],
              [adjusted.lng, adjusted.lat],
            ],
          },
        });
      });
      const lineSource = currentMap.getSource(SOURCE_ID);
      if (lineSource !== undefined && "setData" in lineSource) {
        (lineSource as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: lineFeatures,
        });
      }
    }

    let frame: number | null = null;
    function scheduleUpdate() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateDeclutter();
      });
    }

    if (map.isStyleLoaded()) {
      ensureSourceAndLayer(map);
      updateDeclutter();
    } else {
      map.once("load", () => {
        ensureSourceAndLayer(map);
        updateDeclutter();
      });
    }
    map.on("move", scheduleUpdate);

    return () => {
      map.off("move", scheduleUpdate);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [mapRef, markersRef, points, enabled]);
}
